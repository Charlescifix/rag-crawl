import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createGzip, gunzipSync } from "node:zlib";
import { Readable } from "node:stream";

const s3 = new S3Client({});
const BUCKET = process.env.DATA_BUCKET!;

export async function getS3Text(key: string): Promise<string> {
  const res = await s3.send(
    new GetObjectCommand({ Bucket: BUCKET, Key: key })
  );
  return streamToString(res.Body as Readable);
}

export async function getS3Gzip(key: string): Promise<Buffer> {
  const res = await s3.send(
    new GetObjectCommand({ Bucket: BUCKET, Key: key })
  );
  const compressed = await streamToBuffer(res.Body as Readable);
  return gunzipSync(compressed);
}

export async function putS3Text(key: string, body: string): Promise<void> {
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: "text/plain; charset=utf-8",
    })
  );
}

export async function putS3Json(key: string, data: unknown): Promise<void> {
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: JSON.stringify(data),
      ContentType: "application/json",
    })
  );
}

export async function putS3Gzip(key: string, data: Buffer | string): Promise<void> {
  const input = typeof data === "string" ? Buffer.from(data, "utf-8") : data;
  const compressed = await gzipBuffer(input);
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: compressed,
      ContentEncoding: "gzip",
    })
  );
}

export async function presignGet(
  key: string,
  expiresInSeconds = 3600
): Promise<string> {
  const command = new GetObjectCommand({ Bucket: BUCKET, Key: key });
  return getSignedUrl(s3, command, { expiresIn: expiresInSeconds });
}

export async function deleteS3Prefix(prefix: string): Promise<number> {
  let deleted = 0;
  let continuationToken: string | undefined;

  do {
    const listed = await s3.send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      })
    );
    const keys = (listed.Contents ?? [])
      .map((o) => o.Key)
      .filter((k): k is string => Boolean(k));

    if (keys.length > 0) {
      await s3.send(
        new DeleteObjectsCommand({
          Bucket: BUCKET,
          Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
        })
      );
      deleted += keys.length;
    }

    continuationToken = listed.IsTruncated
      ? listed.NextContinuationToken
      : undefined;
  } while (continuationToken);

  return deleted;
}

export function s3KeyPrefix(siteId: string): string {
  return `sites/${siteId}/`;
}

export function s3KeyMarkdown(siteId: string, pageId: string): string {
  return `sites/${siteId}/pages/${pageId}/page.md`;
}

export function s3KeyRawHtml(siteId: string, pageId: string): string {
  return `sites/${siteId}/pages/${pageId}/raw.html.gz`;
}

export function s3KeyChunks(siteId: string): string {
  return `sites/${siteId}/chunks/chunks.ndjson.gz`;
}

export function s3KeyLexicalIndex(siteId: string): string {
  return `sites/${siteId}/indexes/lexical-index.json.gz`;
}

export function s3KeyFrontier(siteId: string, jobId: string): string {
  return `sites/${siteId}/jobs/${jobId}/frontier.json`;
}

export function s3KeySeen(siteId: string, jobId: string): string {
  return `sites/${siteId}/jobs/${jobId}/seen.json`;
}

export function s3KeyErrors(siteId: string, jobId: string): string {
  return `sites/${siteId}/jobs/${jobId}/errors.ndjson`;
}

export function s3KeyExport(siteId: string, format: "zip" | "single-md", timestamp: string): string {
  return `sites/${siteId}/exports/export-${timestamp}.${format === "zip" ? "zip" : "md"}`;
}

async function streamToString(stream: Readable): Promise<string> {
  const buf = await streamToBuffer(stream);
  return buf.toString("utf-8");
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function gzipBuffer(input: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const gz = createGzip();
    const chunks: Buffer[] = [];
    gz.on("data", (c: Buffer) => chunks.push(c));
    gz.on("end", () => resolve(Buffer.concat(chunks)));
    gz.on("error", reject);
    gz.end(input);
  });
}
