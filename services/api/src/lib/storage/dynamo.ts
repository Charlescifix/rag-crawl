import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
  QueryCommand,
  BatchWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import type {
  SiteRecord,
  PageRecord,
  JobRecord,
  QueryLogRecord,
} from "@crawler/shared";

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.CRAWLER_TABLE!;

export async function putSite(site: SiteRecord): Promise<void> {
  await client.send(new PutCommand({ TableName: TABLE, Item: site }));
}

export async function getSite(siteId: string): Promise<SiteRecord | null> {
  const res = await client.send(
    new GetCommand({ TableName: TABLE, Key: { PK: `SITE#${siteId}`, SK: "META" } })
  );
  return (res.Item as SiteRecord) ?? null;
}

export async function updateSite(
  siteId: string,
  updates: Partial<SiteRecord>
): Promise<void> {
  const entries = Object.entries(updates).filter(([k]) => k !== "PK" && k !== "SK");
  if (entries.length === 0) return;

  const expr = entries.map(([k], i) => `#f${i} = :v${i}`).join(", ");
  const names = Object.fromEntries(entries.map(([k], i) => [`#f${i}`, k]));
  const values = Object.fromEntries(entries.map(([, v], i) => [`:v${i}`, v]));

  await client.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { PK: `SITE#${siteId}`, SK: "META" },
      UpdateExpression: `SET ${expr}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    })
  );
}

export async function listSites(): Promise<SiteRecord[]> {
  const res = await client.send(
    new QueryCommand({
      TableName: TABLE,
      IndexName: "EntityTypeIndex",
      KeyConditionExpression: "entityType = :et",
      ExpressionAttributeValues: { ":et": "SITE" },
      Limit: 100,
    })
  );
  return (res.Items ?? []) as SiteRecord[];
}

export async function putPage(page: PageRecord): Promise<void> {
  await client.send(new PutCommand({ TableName: TABLE, Item: page }));
}

export async function getPage(
  siteId: string,
  pageId: string
): Promise<PageRecord | null> {
  const res = await client.send(
    new GetCommand({
      TableName: TABLE,
      Key: { PK: `SITE#${siteId}`, SK: `PAGE#${pageId}` },
    })
  );
  return (res.Item as PageRecord) ?? null;
}

export async function listPages(siteId: string): Promise<PageRecord[]> {
  const res = await client.send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
      ExpressionAttributeValues: {
        ":pk": `SITE#${siteId}`,
        ":prefix": "PAGE#",
      },
    })
  );
  return (res.Items ?? []) as PageRecord[];
}

export async function putJob(job: JobRecord): Promise<void> {
  await client.send(new PutCommand({ TableName: TABLE, Item: job }));
}

export async function getJob(
  siteId: string,
  jobId: string
): Promise<JobRecord | null> {
  const res = await client.send(
    new GetCommand({
      TableName: TABLE,
      Key: { PK: `SITE#${siteId}`, SK: `JOB#${jobId}` },
    })
  );
  return (res.Item as JobRecord) ?? null;
}

export async function updateJob(
  siteId: string,
  jobId: string,
  updates: Partial<JobRecord>
): Promise<void> {
  const entries = Object.entries(updates).filter(([k]) => k !== "PK" && k !== "SK");
  if (entries.length === 0) return;

  const expr = entries.map(([k], i) => `#f${i} = :v${i}`).join(", ");
  const names = Object.fromEntries(entries.map(([k], i) => [`#f${i}`, k]));
  const values = Object.fromEntries(entries.map(([, v], i) => [`:v${i}`, v]));

  await client.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { PK: `SITE#${siteId}`, SK: `JOB#${jobId}` },
      UpdateExpression: `SET ${expr}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    })
  );
}

export async function putQueryLog(record: QueryLogRecord): Promise<void> {
  await client.send(new PutCommand({ TableName: TABLE, Item: record }));
}

/** Delete every item in a site's partition (META, pages, jobs, query logs). */
export async function deleteSitePartition(siteId: string): Promise<number> {
  const pk = `SITE#${siteId}`;
  let deleted = 0;
  let lastEvaluatedKey: Record<string, unknown> | undefined;

  do {
    const res = await client.send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: "PK = :pk",
        ExpressionAttributeValues: { ":pk": pk },
        ProjectionExpression: "PK, SK",
        ExclusiveStartKey: lastEvaluatedKey,
      })
    );

    const keys = (res.Items ?? []) as Array<{ PK: string; SK: string }>;
    // BatchWrite accepts at most 25 items per request
    for (let i = 0; i < keys.length; i += 25) {
      let requests = keys.slice(i, i + 25).map((key) => ({
        DeleteRequest: { Key: { PK: key.PK, SK: key.SK } },
      }));
      while (requests.length > 0) {
        const out = await client.send(
          new BatchWriteCommand({ RequestItems: { [TABLE]: requests } })
        );
        deleted += requests.length;
        const unprocessed = out.UnprocessedItems?.[TABLE] ?? [];
        deleted -= unprocessed.length;
        requests = unprocessed as typeof requests;
      }
    }

    lastEvaluatedKey = res.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  return deleted;
}
