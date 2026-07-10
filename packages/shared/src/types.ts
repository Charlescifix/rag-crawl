export type SiteStatus = "QUEUED" | "RUNNING" | "READY" | "FAILED";

export type JobStatus =
  | "QUEUED"
  | "RUNNING"
  | "CHECKPOINTED"
  | "READY"
  | "FAILED"
  | "CANCELLED";

export type PageStatus =
  | "DISCOVERED"
  | "CRAWLED"
  | "SKIPPED_ROBOTS"
  | "SKIPPED_CONTENT_TYPE"
  | "SKIPPED_EXTERNAL_DOMAIN"
  | "SKIPPED_TOO_LARGE"
  | "FAILED"
  | "UNCHANGED";

export interface SiteRecord {
  PK: string;
  SK: "META";
  entityType: "SITE";
  siteId: string;
  rootUrl: string;
  domain: string;
  status: SiteStatus;
  createdAt: string;
  updatedAt: string;
  lastCrawledAt?: string;
  pageCount?: number;
  chunkCount?: number;
  totalWords?: number;
  chunksKey?: string;
  indexKey?: string;
}

export interface PageRecord {
  PK: string;
  SK: string;
  entityType: "PAGE";
  siteId: string;
  pageId: string;
  url: string;
  normalizedUrl: string;
  title?: string;
  status: PageStatus;
  httpStatus?: number;
  contentType?: string;
  markdownKey?: string;
  rawHtmlKey?: string;
  contentHash?: string;
  wordCount?: number;
  chunkCount?: number;
  fetchedAt?: string;
  error?: string;
}

export interface JobRecord {
  PK: string;
  SK: string;
  entityType: "JOB";
  jobId: string;
  siteId: string;
  status: JobStatus;
  startedAt: string;
  finishedAt?: string;
  maxPages: number;
  maxDepth: number;
  pagesCrawled: number;
  pagesSkipped: number;
  errors: number;
  frontierKey: string;
  seenKey: string;
}

export interface QueryLogRecord {
  PK: string;
  SK: string;
  entityType: "QUERY";
  queryId: string;
  siteId: string;
  question: string;
  answerPreview: string;
  sourceCount: number;
  createdAt: string;
}

export interface ChunkRecord {
  chunkId: string;
  siteId: string;
  pageId: string;
  url: string;
  title?: string;
  headingPath?: string[];
  text: string;
  wordCount: number;
}

export interface QueryResponse {
  answer: string;
  sources: Array<{
    chunkId: string;
    pageId: string;
    url: string;
    title?: string;
    score: number;
  }>;
}

export interface GlobalQueryInput {
  question: string;
  topK?: number;
  /** Restrict the search to these sites; omit to search every READY site. */
  siteIds?: string[];
}

export interface GlobalQueryResponse {
  answer: string;
  /** Sites whose chunks were searched, keyed for attribution in the UI. */
  sitesSearched: Array<{ siteId: string; domain: string }>;
  sources: Array<{
    chunkId: string;
    pageId: string;
    siteId: string;
    domain: string;
    url: string;
    title?: string;
    score: number;
  }>;
}

export interface DeleteSiteResponse {
  siteId: string;
  deleted: true;
  objectsDeleted: number;
  itemsDeleted: number;
}

export interface FrontierItem {
  url: string;
  depth: number;
}

export interface CrawlState {
  frontier: FrontierItem[];
  seen: string[];
  pagesCrawled: number;
  pagesSkipped: number;
  errors: number;
}

export interface StartCrawlInput {
  url: string;
  maxPages?: number;
  maxDepth?: number;
  respectRobotsTxt?: boolean;
  storeRawHtml?: boolean;
}

export interface StartCrawlOutput {
  siteId: string;
  jobId: string;
  status: "QUEUED";
}

export interface CrawlWorkerEvent {
  jobId: string;
  siteId: string;
  maxPages: number;
  maxDepth: number;
  respectRobotsTxt: boolean;
  storeRawHtml: boolean;
  rootUrl: string;
}

export interface LexicalIndex {
  siteId: string;
  chunkCount: number;
  avgDocLength: number;
  documents: Record<
    string,
    {
      pageId: string;
      url: string;
      title?: string;
      length: number;
    }
  >;
  terms: Record<
    string,
    {
      df: number;
      postings: Record<string, number>;
    }
  >;
}
