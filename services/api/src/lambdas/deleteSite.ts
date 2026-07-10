import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from "aws-lambda";
import type { DeleteSiteResponse } from "@crawler/shared";
import { getSite, deleteSitePartition } from "../lib/storage/dynamo";
import { deleteS3Prefix, s3KeyPrefix } from "../lib/storage/s3";

export const handler = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  const siteId = event.pathParameters?.siteId;
  if (!siteId) return error(400, "siteId is required");

  const site = await getSite(siteId);
  if (!site) return error(404, "Site not found");
  if (site.status === "QUEUED" || site.status === "RUNNING") {
    return error(
      409,
      `Site has an active crawl (status: ${site.status}) — wait for it to finish before deleting`
    );
  }

  // S3 first: if this fails partway, the site record still exists and the
  // delete can simply be retried.
  const objectsDeleted = await deleteS3Prefix(s3KeyPrefix(siteId));
  const itemsDeleted = await deleteSitePartition(siteId);

  const response: DeleteSiteResponse = {
    siteId,
    deleted: true,
    objectsDeleted,
    itemsDeleted,
  };
  return ok(response);
};

function ok(data: unknown): APIGatewayProxyResultV2 {
  return { statusCode: 200, body: JSON.stringify(data) };
}

function error(statusCode: number, message: string): APIGatewayProxyResultV2 {
  return { statusCode, body: JSON.stringify({ error: message }) };
}
