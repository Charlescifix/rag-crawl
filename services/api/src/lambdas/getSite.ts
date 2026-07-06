import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from "aws-lambda";
import { getSite } from "../lib/storage/dynamo";

export const handler = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  const siteId = event.pathParameters?.siteId;
  if (!siteId) return { statusCode: 400, body: JSON.stringify({ error: "siteId required" }) };

  const site = await getSite(siteId);
  if (!site) return { statusCode: 404, body: JSON.stringify({ error: "Not found" }) };

  return { statusCode: 200, body: JSON.stringify(site) };
};
