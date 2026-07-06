import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from "aws-lambda";
import { listPages } from "../lib/storage/dynamo";

export const handler = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  const siteId = event.pathParameters?.siteId;
  if (!siteId) return { statusCode: 400, body: JSON.stringify({ error: "siteId required" }) };

  const pages = await listPages(siteId);

  return {
    statusCode: 200,
    body: JSON.stringify({
      pages: pages.map((p) => ({
        pageId: p.pageId,
        url: p.url,
        title: p.title,
        status: p.status,
        wordCount: p.wordCount,
        chunkCount: p.chunkCount,
        markdownKey: p.markdownKey,
        fetchedAt: p.fetchedAt,
      })),
    }),
  };
};
