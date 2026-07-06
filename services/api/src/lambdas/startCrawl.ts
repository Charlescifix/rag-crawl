import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from "aws-lambda";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import type { StartCrawlInput, StartCrawlOutput, CrawlWorkerEvent } from "@crawler/shared";
import { validateAndNormalizeUrl } from "../lib/security/validate";
import { assertSafeHost } from "../lib/security/ssrf";
import { newSiteId, newJobId } from "../lib/ids";
import { putSite, putJob } from "../lib/storage/dynamo";
import { putS3Json, s3KeyFrontier, s3KeySeen } from "../lib/storage/s3";

const lambda = new LambdaClient({});
const WORKER_FN = process.env.CRAWL_WORKER_FUNCTION_NAME!;

const DEFAULT_MAX_PAGES = 50;
const DEFAULT_MAX_DEPTH = 3;

export const handler = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  let body: StartCrawlInput;
  try {
    body = JSON.parse(event.body ?? "{}");
  } catch {
    return error(400, "Invalid JSON body");
  }

  if (!body.url) return error(400, "url is required");

  let normalizedUrl: string;
  try {
    normalizedUrl = validateAndNormalizeUrl(body.url);
    await assertSafeHost(new URL(normalizedUrl).hostname);
  } catch (err: unknown) {
    return error(400, (err as Error).message);
  }

  const siteId = newSiteId();
  const jobId = newJobId();
  const now = new Date().toISOString();
  const domain = new URL(normalizedUrl).hostname;

  const maxPages = Math.min(body.maxPages ?? DEFAULT_MAX_PAGES, 200);
  const maxDepth = Math.min(body.maxDepth ?? DEFAULT_MAX_DEPTH, 5);

  await putSite({
    PK: `SITE#${siteId}`,
    SK: "META",
    entityType: "SITE",
    siteId,
    rootUrl: normalizedUrl,
    domain,
    status: "QUEUED",
    createdAt: now,
    updatedAt: now,
  });

  await putJob({
    PK: `SITE#${siteId}`,
    SK: `JOB#${jobId}`,
    entityType: "JOB",
    jobId,
    siteId,
    status: "QUEUED",
    startedAt: now,
    maxPages,
    maxDepth,
    pagesCrawled: 0,
    pagesSkipped: 0,
    errors: 0,
    frontierKey: s3KeyFrontier(siteId, jobId),
    seenKey: s3KeySeen(siteId, jobId),
  });

  // Write initial frontier to S3
  await putS3Json(s3KeyFrontier(siteId, jobId), [
    { url: normalizedUrl, depth: 0 },
  ]);
  await putS3Json(s3KeySeen(siteId, jobId), []);

  const workerEvent: CrawlWorkerEvent = {
    jobId,
    siteId,
    maxPages,
    maxDepth,
    respectRobotsTxt: body.respectRobotsTxt !== false,
    storeRawHtml: body.storeRawHtml !== false,
    rootUrl: normalizedUrl,
  };

  // Async invoke — do not await
  await lambda.send(
    new InvokeCommand({
      FunctionName: WORKER_FN,
      InvocationType: "Event",
      Payload: Buffer.from(JSON.stringify(workerEvent)),
    })
  );

  const out: StartCrawlOutput = { siteId, jobId, status: "QUEUED" };
  return { statusCode: 202, body: JSON.stringify(out) };
};

function error(statusCode: number, message: string): APIGatewayProxyResultV2 {
  return { statusCode, body: JSON.stringify({ error: message }) };
}
