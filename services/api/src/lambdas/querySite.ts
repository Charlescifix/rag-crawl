import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from "aws-lambda";
import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";
import type { ChunkRecord, QueryResponse } from "@crawler/shared";
import { getSite, putQueryLog } from "../lib/storage/dynamo";
import { getS3Gzip, s3KeyChunks } from "../lib/storage/s3";
import { searchChunks } from "../lib/search/scorer";
import { AnthropicAnswerProvider } from "../lib/ai/anthropic";
import type { AiContext } from "../lib/ai/types";
import { newQueryId } from "../lib/ids";

const ssm = new SSMClient({});

const TOP_K = 6;
const MAX_ANSWER_TOKENS = 700;
const MAX_CONTEXT_WORDS = 2500;

async function getApiKey(): Promise<string> {
  const paramName = process.env.AI_API_KEY_PARAM!;
  const res = await ssm.send(
    new GetParameterCommand({ Name: paramName, WithDecryption: true })
  );
  const value = res.Parameter?.Value;
  if (!value) throw new Error("AI API key not found in SSM");
  return value;
}

export const handler = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  const siteId = event.pathParameters?.siteId;
  if (!siteId) return error(400, "siteId is required");

  const site = await getSite(siteId);
  if (!site) return error(404, "Site not found");
  if (site.status !== "READY") {
    return error(409, `Site is not ready (status: ${site.status})`);
  }

  let body: { question?: string; topK?: number };
  try {
    body = JSON.parse(event.body ?? "{}");
  } catch {
    return error(400, "Invalid JSON body");
  }

  const question = (body.question ?? "").trim();
  if (!question) return error(400, "question is required");
  if (question.length > 1000) return error(400, "question too long");

  // Load chunks from S3
  let chunks: ChunkRecord[];
  try {
    const raw = await getS3Gzip(s3KeyChunks(siteId));
    chunks = raw
      .toString("utf-8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as ChunkRecord);
  } catch {
    return error(500, "Failed to load site chunks");
  }

  const topK = Math.min(body.topK ?? TOP_K, 10);
  const scored = searchChunks(question, chunks, topK);

  if (scored.length === 0) {
    return ok({
      answer: "The crawled pages do not contain enough information to answer this question.",
      sources: [],
    });
  }

  // Trim context to word limit
  let wordCount = 0;
  const contexts: AiContext[] = [];
  for (const { chunk, score } of scored) {
    if (wordCount >= MAX_CONTEXT_WORDS) break;
    contexts.push({
      id: chunk.chunkId,
      title: chunk.title,
      url: chunk.url,
      text: chunk.text,
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

  const response: QueryResponse = {
    answer,
    sources: scored.map(({ chunk, score }) => ({
      chunkId: chunk.chunkId,
      pageId: chunk.pageId,
      url: chunk.url,
      title: chunk.title,
      score,
    })),
  };

  const now = new Date().toISOString();
  const queryId = newQueryId();
  await putQueryLog({
    PK: `SITE#${siteId}`,
    SK: `QUERY#${now}#${queryId}`,
    entityType: "QUERY",
    queryId,
    siteId,
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
