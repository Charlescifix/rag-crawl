import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from "aws-lambda";
import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";
import type {
  ChunkRecord,
  GlobalQueryInput,
  GlobalQueryResponse,
  SiteRecord,
} from "@crawler/shared";
import { listSites, putQueryLog } from "../lib/storage/dynamo";
import { getS3Gzip, s3KeyChunks } from "../lib/storage/s3";
import { searchChunksAcrossSites } from "../lib/search/scorer";
import { AnthropicAnswerProvider } from "../lib/ai/anthropic";
import type { AiContext } from "../lib/ai/types";
import { newQueryId } from "../lib/ids";

const ssm = new SSMClient({});

const TOP_K = 8;
const MAX_TOP_K = 15;
const MAX_ANSWER_TOKENS = 1000;
const MAX_CONTEXT_WORDS = 3500;

async function getApiKey(): Promise<string> {
  const paramName = process.env.AI_API_KEY_PARAM!;
  const res = await ssm.send(
    new GetParameterCommand({ Name: paramName, WithDecryption: true })
  );
  const value = res.Parameter?.Value;
  if (!value) throw new Error("AI API key not found in SSM");
  return value;
}

async function loadSiteChunks(site: SiteRecord): Promise<ChunkRecord[]> {
  const raw = await getS3Gzip(s3KeyChunks(site.siteId));
  return raw
    .toString("utf-8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ChunkRecord);
}

export const handler = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  let body: GlobalQueryInput;
  try {
    body = JSON.parse(event.body ?? "{}");
  } catch {
    return error(400, "Invalid JSON body");
  }

  const question = (body.question ?? "").trim();
  if (!question) return error(400, "question is required");
  if (question.length > 1000) return error(400, "question too long");

  const requestedIds =
    Array.isArray(body.siteIds) && body.siteIds.length > 0
      ? new Set(body.siteIds)
      : null;

  const allSites = await listSites();
  const sites = allSites.filter(
    (s) => s.status === "READY" && (!requestedIds || requestedIds.has(s.siteId))
  );
  if (sites.length === 0) {
    return error(404, "No ready sites match the request");
  }

  // Load every site's chunk file in parallel; skip sites whose file is missing
  // rather than failing the whole query.
  const domainBySite = new Map(sites.map((s) => [s.siteId, s.domain]));
  const loads = await Promise.allSettled(sites.map(loadSiteChunks));
  const chunks: ChunkRecord[] = [];
  const sitesSearched: GlobalQueryResponse["sitesSearched"] = [];
  loads.forEach((result, i) => {
    if (result.status === "fulfilled") {
      chunks.push(...result.value);
      sitesSearched.push({ siteId: sites[i].siteId, domain: sites[i].domain });
    }
  });
  if (chunks.length === 0) {
    return error(500, "Failed to load chunks for the requested sites");
  }

  const topK = Math.min(body.topK ?? TOP_K, MAX_TOP_K);
  const scored = searchChunksAcrossSites(question, chunks, topK);

  if (scored.length === 0) {
    return ok({
      answer:
        "The crawled pages do not contain enough information to answer this question.",
      sitesSearched,
      sources: [],
    } satisfies GlobalQueryResponse);
  }

  let wordCount = 0;
  const contexts: AiContext[] = [];
  for (const { chunk } of scored) {
    if (wordCount >= MAX_CONTEXT_WORDS) break;
    contexts.push({
      id: chunk.chunkId,
      title: chunk.title,
      url: chunk.url,
      text: chunk.text,
      company: domainBySite.get(chunk.siteId) ?? chunk.siteId,
    });
    wordCount += chunk.wordCount;
  }

  const apiKey = await getApiKey();
  const provider = new AnthropicAnswerProvider(apiKey);
  const { answer } = await provider.answerWithContext({
    question,
    contexts,
    maxTokens: MAX_ANSWER_TOKENS,
  });

  const response: GlobalQueryResponse = {
    answer,
    sitesSearched,
    sources: scored.map(({ chunk, score }) => ({
      chunkId: chunk.chunkId,
      pageId: chunk.pageId,
      siteId: chunk.siteId,
      domain: domainBySite.get(chunk.siteId) ?? chunk.siteId,
      url: chunk.url,
      title: chunk.title,
      score,
    })),
  };

  const now = new Date().toISOString();
  const queryId = newQueryId();
  await putQueryLog({
    PK: "GLOBAL",
    SK: `QUERY#${now}#${queryId}`,
    entityType: "QUERY",
    queryId,
    siteId: "GLOBAL",
    question,
    answerPreview: answer.slice(0, 200),
    sourceCount: response.sources.length,
    createdAt: now,
  });

  return ok(response);
};

function ok(data: unknown): APIGatewayProxyResultV2 {
  return { statusCode: 200, body: JSON.stringify(data) };
}

function error(statusCode: number, message: string): APIGatewayProxyResultV2 {
  return { statusCode, body: JSON.stringify({ error: message }) };
}
