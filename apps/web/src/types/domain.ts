export type CrawlStatus = 'idle' | 'queued' | 'running' | 'completed' | 'failed';

export interface SiteSummary {
  id: string;
  name: string;
  domain: string;
  seedUrl: string;
  status: CrawlStatus;
  pages: number;
  chunks: number;
  markdownSizeKb: number;
  indexedPercent: number;
  lastCrawledAt: string;
  monthlyCostUsd: number;
  activeJobId?: string;
}

export interface PageRecord {
  id: string;
  siteId: string;
  title: string;
  url: string;
  status: 'saved' | 'changed' | 'failed' | 'skipped';
  words: number;
  chunks: number;
  markdownKey: string;
  updatedAt: string;
}

export interface QueryCitation {
  pageTitle: string;
  url: string;
  heading: string;
  score: number;
  /** Set on knowledge-base-wide queries to attribute the source company. */
  company?: string;
}

export interface QueryResult {
  answer: string;
  citations: QueryCitation[];
  latencyMs: number;
  modelCostUsd: number;
}

export interface CrawlRequest {
  seedUrl: string;
  maxPages: number;
  respectRobotsTxt: boolean;
  sameDomainOnly: boolean;
  renderJavascript: boolean;
}
