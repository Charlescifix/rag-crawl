import { createHash, randomBytes } from "node:crypto";

export function newSiteId(): string {
  return "site_" + randomBytes(8).toString("hex");
}

export function newJobId(): string {
  return "job_" + randomBytes(8).toString("hex");
}

export function newQueryId(): string {
  return "query_" + randomBytes(8).toString("hex");
}

export function pageIdFromUrl(normalizedUrl: string): string {
  return "page_" + createHash("sha256").update(normalizedUrl).digest("hex").slice(0, 16);
}

export function newChunkId(pageId: string, index: number): string {
  return `chunk_${pageId.slice(5)}_${String(index).padStart(4, "0")}`;
}

export function contentHash(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
