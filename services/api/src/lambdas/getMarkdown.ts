import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from "aws-lambda";
import { getPage } from "../lib/storage/dynamo";
import { getS3Text } from "../lib/storage/s3";

export const handler = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  const { siteId, pageId } = event.pathParameters ?? {};
  if (!siteId || !pageId) {
    return { statusCode: 400, body: JSON.stringify({ error: "siteId and pageId required" }) };
  }

  const page = await getPage(siteId, pageId);
  if (!page) return { statusCode: 404, body: JSON.stringify({ error: "Not found" }) };
  if (!page.markdownKey) {
    return { statusCode: 404, body: JSON.stringify({ error: "Markdown not available" }) };
  }

  const markdown = await getS3Text(page.markdownKey);

  return {
    statusCode: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
    body: markdown,
  };
};
