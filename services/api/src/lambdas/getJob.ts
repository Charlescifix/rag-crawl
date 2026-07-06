import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from "aws-lambda";
import { getJob } from "../lib/storage/dynamo";

export const handler = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  const { siteId, jobId } = event.pathParameters ?? {};
  if (!siteId || !jobId) {
    return { statusCode: 400, body: JSON.stringify({ error: "siteId and jobId required" }) };
  }

  const job = await getJob(siteId, jobId);
  if (!job) return { statusCode: 404, body: JSON.stringify({ error: "Not found" }) };

  return {
    statusCode: 200,
    body: JSON.stringify({
      jobId: job.jobId,
      siteId: job.siteId,
      status: job.status,
      pagesCrawled: job.pagesCrawled,
      pagesSkipped: job.pagesSkipped,
      errors: job.errors,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
    }),
  };
};
