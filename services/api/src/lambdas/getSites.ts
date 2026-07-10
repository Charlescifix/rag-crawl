import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from "aws-lambda";
import { listSites } from "../lib/storage/dynamo";

export const handler = async (
  _event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  const sites = await listSites();

  return {
    statusCode: 200,
    body: JSON.stringify({
      sites: sites.map((s) => ({
        siteId: s.siteId,
        rootUrl: s.rootUrl,
        domain: s.domain,
        status: s.status,
        pageCount: s.pageCount,
        chunkCount: s.chunkCount,
        createdAt: s.createdAt,
        lastCrawledAt: s.lastCrawledAt,
      })),
    }),
  };
};
