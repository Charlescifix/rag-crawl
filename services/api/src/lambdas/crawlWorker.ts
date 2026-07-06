import type { Context } from "aws-lambda";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import type {
  CrawlWorkerEvent,
  CrawlState,
  FrontierItem,
} from "@crawler/shared";
import { fetchPage, FetchError } from "../lib/crawler/fetcher";
import { fetchRobots } from "../lib/crawler/robots";
import { extractInternalLinks } from "../lib/crawler/links";
import { extractReadableContent } from "../lib/markdown/extractor";
import { toMarkdown } from "../lib/markdown/converter";
import { chunkMarkdown } from "../lib/markdown/chunker";
import { validateAndNormalizeUrl, isSameDomain } from "../lib/security/validate";
import { assertSafeHost, SsrfError } from "../lib/security/ssrf";
import { pageIdFromUrl, newChunkId } from "../lib/ids";
import {
  putS3Text,
  putS3Json,
  putS3Gzip,
  getS3Text,
  s3KeyMarkdown,
  s3KeyRawHtml,
  s3KeyChunks,
  s3KeyFrontier,
  s3KeySeen,
  s3KeyErrors,
} from "../lib/storage/s3";
import {
  getJob,
  updateJob,
  putPage,
  updateSite,
  listPages,
} from "../lib/storage/dynamo";
import type { ChunkRecord } from "@crawler/shared";

const lambda = new LambdaClient({});
const WORKER_FN = process.env.CRAWL_WORKER_FUNCTION_NAME!;
const CHECKPOINT_BUFFER_MS = 30_000;
const CRAWL_DELAY_MS = 500;

export const handler = async (
  event: CrawlWorkerEvent,
  context: Context
): Promise<void> => {
  const { jobId, siteId, maxPages, maxDepth, respectRobotsTxt, storeRawHtml, rootUrl } =
    event;

  const job = await getJob(siteId, jobId);
  if (!job || job.status === "CANCELLED" || job.status === "FAILED") return;

  await updateJob(siteId, jobId, { status: "RUNNING" });
  await updateSite(siteId, { status: "RUNNING" });

  const robotsChecker = respectRobotsTxt
    ? await fetchRobots(rootUrl)
    : { isAllowed: () => true };

  // Load state from S3
  let frontier: FrontierItem[] = JSON.parse(
    await getS3Text(s3KeyFrontier(siteId, jobId))
  );
  let seen: Set<string> = new Set(
    JSON.parse(await getS3Text(s3KeySeen(siteId, jobId)))
  );

  console.log(`[worker] starting siteId=${siteId} jobId=${jobId} frontier=${frontier.length} rootUrl=${rootUrl}`);

  let { pagesCrawled, pagesSkipped, errors } = job;
  const errorLines: string[] = [];

  while (frontier.length > 0) {
    // Checkpoint before Lambda timeout
    if (context.getRemainingTimeInMillis() < CHECKPOINT_BUFFER_MS) {
      console.log(`[worker] checkpoint — time low, reinvoking. crawled=${pagesCrawled} skipped=${pagesSkipped}`);
      await checkpoint(siteId, jobId, frontier, seen, pagesCrawled, pagesSkipped, errors);
      await reinvoke(event);
      return;
    }

    if (pagesCrawled >= maxPages) break;

    const item = frontier.shift()!;
    let url: string;

    try {
      url = validateAndNormalizeUrl(item.url);
    } catch {
      console.log(`[worker] skip invalid url: ${item.url}`);
      pagesSkipped++;
      continue;
    }

    if (seen.has(url)) continue;
    if (!isSameDomain(url, rootUrl)) {
      console.log(`[worker] skip external domain: ${url} (root=${rootUrl})`);
      pagesSkipped++;
      continue;
    }
    if (item.depth > maxDepth) {
      console.log(`[worker] skip depth exceeded: ${url} depth=${item.depth}`);
      pagesSkipped++;
      continue;
    }

    seen.add(url);

    try {
      await assertSafeHost(new URL(url).hostname);
    } catch {
      console.log(`[worker] skip ssrf blocked: ${url}`);
      pagesSkipped++;
      continue;
    }

    if (!robotsChecker.isAllowed(url)) {
      console.log(`[worker] skip robots: ${url}`);
      await putPage({
        PK: `SITE#${siteId}`,
        SK: `PAGE#${pageIdFromUrl(url)}`,
        entityType: "PAGE",
        siteId,
        pageId: pageIdFromUrl(url),
        url,
        normalizedUrl: url,
        status: "SKIPPED_ROBOTS",
        fetchedAt: new Date().toISOString(),
      });
      pagesSkipped++;
      continue;
    }

    console.log(`[worker] fetching: ${url} (depth=${item.depth})`);
    try {
      const result = await fetchPage(url);
      const pageId = pageIdFromUrl(result.finalUrl);
      const now = new Date().toISOString();
      console.log(`[worker] fetched: ${result.finalUrl} status=${result.statusCode} finalUrl=${result.finalUrl}`);

      const extracted = extractReadableContent(result.html, result.finalUrl);
      const { markdown, hash } = toMarkdown(extracted.html, {
        siteId,
        pageId,
        url: result.finalUrl,
        title: extracted.title,
        fetchedAt: now,
      });

      await putS3Text(s3KeyMarkdown(siteId, pageId), markdown);

      if (storeRawHtml) {
        await putS3Gzip(s3KeyRawHtml(siteId, pageId), result.html);
      }

      const chunks = chunkMarkdown(markdown, {
        siteId,
        pageId,
        url: result.finalUrl,
        title: extracted.title,
      });

      await putPage({
        PK: `SITE#${siteId}`,
        SK: `PAGE#${pageId}`,
        entityType: "PAGE",
        siteId,
        pageId,
        url: result.finalUrl,
        normalizedUrl: result.finalUrl,
        title: extracted.title,
        status: "CRAWLED",
        httpStatus: result.statusCode,
        contentType: result.contentType,
        markdownKey: s3KeyMarkdown(siteId, pageId),
        rawHtmlKey: storeRawHtml ? s3KeyRawHtml(siteId, pageId) : undefined,
        contentHash: hash,
        wordCount: chunks.reduce((s, c) => s + c.wordCount, 0),
        chunkCount: chunks.length,
        fetchedAt: now,
      });

      pagesCrawled++;

      const links = extractInternalLinks(result.html, result.finalUrl);
      for (const link of links) {
        if (!seen.has(link)) {
          frontier.push({ url: link, depth: item.depth + 1 });
        }
      }
    } catch (err: unknown) {
      console.log(`[worker] error fetching ${url}: ${(err as Error).message}`);
      errors++;
      errorLines.push(
        JSON.stringify({
          url,
          errorType: err instanceof FetchError ? "HTTP_STATUS" : "FETCH_ERROR",
          message: (err as Error).message,
          timestamp: new Date().toISOString(),
        })
      );

      const pageId = pageIdFromUrl(url);
      await putPage({
        PK: `SITE#${siteId}`,
        SK: `PAGE#${pageId}`,
        entityType: "PAGE",
        siteId,
        pageId,
        url,
        normalizedUrl: url,
        status: "FAILED",
        error: (err as Error).message,
        fetchedAt: new Date().toISOString(),
      });
    }

    await sleep(CRAWL_DELAY_MS);
  }

  // Persist error log
  if (errorLines.length > 0) {
    await putS3Text(s3KeyErrors(siteId, jobId), errorLines.join("\n"));
  }

  console.log(`[worker] crawl loop done. crawled=${pagesCrawled} skipped=${pagesSkipped} errors=${errors}`);

  // Rebuild chunks index
  await rebuildChunksIndex(siteId);

  const now = new Date().toISOString();
  await updateJob(siteId, jobId, {
    status: "READY",
    finishedAt: now,
    pagesCrawled,
    pagesSkipped,
    errors,
  });
  await updateSite(siteId, {
    status: "READY",
    lastCrawledAt: now,
    updatedAt: now,
    pageCount: pagesCrawled,
  });
};

async function checkpoint(
  siteId: string,
  jobId: string,
  frontier: FrontierItem[],
  seen: Set<string>,
  pagesCrawled: number,
  pagesSkipped: number,
  errors: number
): Promise<void> {
  await putS3Json(s3KeyFrontier(siteId, jobId), frontier);
  await putS3Json(s3KeySeen(siteId, jobId), [...seen]);
  await updateJob(siteId, jobId, {
    status: "CHECKPOINTED",
    pagesCrawled,
    pagesSkipped,
    errors,
  });
}

async function reinvoke(event: CrawlWorkerEvent): Promise<void> {
  await lambda.send(
    new InvokeCommand({
      FunctionName: WORKER_FN,
      InvocationType: "Event",
      Payload: Buffer.from(JSON.stringify(event)),
    })
  );
}

async function rebuildChunksIndex(siteId: string): Promise<void> {
  const pages = await listPages(siteId);
  const allChunks: ChunkRecord[] = [];

  for (const page of pages) {
    if (page.status !== "CRAWLED" || !page.markdownKey) continue;
    try {
      const markdown = await getS3Text(page.markdownKey);
      const chunks = chunkMarkdown(markdown, {
        siteId,
        pageId: page.pageId,
        url: page.url,
        title: page.title,
      });
      allChunks.push(...chunks);
    } catch {
      // Skip pages that can't be re-chunked
    }
  }

  const ndjson = allChunks.map((c) => JSON.stringify(c)).join("\n");
  await putS3Gzip(s3KeyChunks(siteId), ndjson);

  await updateSite(siteId, { chunkCount: allChunks.length });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
