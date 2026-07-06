import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from "aws-lambda";
import { createHash } from "node:crypto";
import { getSite, listPages } from "../lib/storage/dynamo";
import {
  getS3Text,
  putS3Text,
  putS3Gzip,
  presignGet,
  s3KeyExport,
} from "../lib/storage/s3";

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

  let body: { format?: string };
  try {
    body = JSON.parse(event.body ?? "{}");
  } catch {
    return error(400, "Invalid JSON body");
  }

  const format = body.format === "zip" ? "zip" : "single-md";
  const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, "-");

  const pages = await listPages(siteId);
  const crawledPages = pages.filter((p) => p.status === "CRAWLED" && p.markdownKey);

  if (format === "single-md") {
    const lines = [
      `# Export for ${site.rootUrl}`,
      ``,
      `Generated at: ${new Date().toISOString()}`,
      ``,
      `---`,
      ``,
    ];

    for (const page of crawledPages) {
      try {
        const markdown = await getS3Text(page.markdownKey!);
        // Strip YAML frontmatter before embedding
        const body = markdown.replace(/^---[\s\S]+?---\n/, "");
        lines.push(`# Page: ${page.title ?? page.url}`);
        lines.push(``);
        lines.push(`Source: ${page.url}`);
        lines.push(``);
        lines.push(body.trim());
        lines.push(``);
        lines.push(`---`);
        lines.push(``);
      } catch {
        // Skip unreadable pages
      }
    }

    const combined = lines.join("\n");
    const exportKey = s3KeyExport(siteId, "single-md", timestamp);
    await putS3Text(exportKey, combined);

    const downloadUrl = await presignGet(exportKey, 3600);
    return ok({ exportKey, downloadUrl, expiresInSeconds: 3600 });
  }

  // ZIP format: build in-memory using a minimal zip implementation
  const zipEntries: Array<{ filename: string; content: Buffer }> = [];

  for (const page of crawledPages) {
    try {
      const markdown = await getS3Text(page.markdownKey!);
      const filename = urlToFilename(page.url);
      zipEntries.push({ filename, content: Buffer.from(markdown, "utf-8") });
    } catch {
      // Skip unreadable pages
    }
  }

  const zipBuffer = buildZip(zipEntries);
  const exportKey = s3KeyExport(siteId, "zip", timestamp);
  await putS3Gzip(exportKey, zipBuffer);

  const downloadUrl = await presignGet(exportKey, 3600);
  return ok({ exportKey, downloadUrl, expiresInSeconds: 3600 });
};

function urlToFilename(url: string): string {
  const pathname = new URL(url).pathname
    .replace(/^\//, "")
    .replace(/\/$/, "")
    .replace(/\//g, "-")
    .replace(/[^a-z0-9\-_]/gi, "-")
    .toLowerCase();
  return (pathname || "index") + ".md";
}

function buildZip(
  entries: Array<{ filename: string; content: Buffer }>
): Buffer {
  // Minimal stored (no compression) ZIP file
  const localHeaders: Buffer[] = [];
  const centralDirectory: Buffer[] = [];
  let offset = 0;

  for (const { filename, content } of entries) {
    const nameBuffer = Buffer.from(filename, "utf-8");
    const crc = crc32(content);

    const localHeader = Buffer.alloc(30 + nameBuffer.length);
    localHeader.writeUInt32LE(0x04034b50, 0);  // signature
    localHeader.writeUInt16LE(20, 4);           // version
    localHeader.writeUInt16LE(0, 6);            // flags
    localHeader.writeUInt16LE(0, 8);            // compression: stored
    localHeader.writeUInt16LE(0, 10);           // mod time
    localHeader.writeUInt16LE(0, 12);           // mod date
    localHeader.writeUInt32LE(crc, 14);         // crc
    localHeader.writeUInt32LE(content.length, 18); // compressed
    localHeader.writeUInt32LE(content.length, 22); // uncompressed
    localHeader.writeUInt16LE(nameBuffer.length, 26);
    localHeader.writeUInt16LE(0, 28);
    nameBuffer.copy(localHeader, 30);

    const central = Buffer.alloc(46 + nameBuffer.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(content.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    nameBuffer.copy(central, 46);

    localHeaders.push(localHeader, content);
    centralDirectory.push(central);
    offset += localHeader.length + content.length;
  }

  const cd = Buffer.concat(centralDirectory);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localHeaders, cd, eocd]);
}

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buf) {
    crc ^= byte;
    for (let j = 0; j < 8; j++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function ok(data: unknown): APIGatewayProxyResultV2 {
  return { statusCode: 200, body: JSON.stringify(data) };
}

function error(statusCode: number, message: string): APIGatewayProxyResultV2 {
  return { statusCode, body: JSON.stringify({ error: message }) };
}
