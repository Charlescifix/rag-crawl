import { pages as mockPages, sampleQuery, sites as mockSites } from './mockData';
import type { CrawlRequest, PageRecord, QueryResult, SiteSummary } from '../types/domain';

const API_BASE = import.meta.env.VITE_API_BASE_URL as string | undefined;

// ── Raw backend shapes ────────────────────────────────────────────────────────

interface BackendSite {
  siteId: string;
  rootUrl: string;
  domain: string;
  status: 'QUEUED' | 'RUNNING' | 'READY' | 'FAILED';
  pageCount?: number;
  chunkCount?: number;
  lastCrawledAt?: string;
  createdAt: string;
}

interface BackendPage {
  pageId: string;
  url: string;
  title?: string;
  status: string;
  wordCount?: number;
  chunkCount?: number;
  markdownKey?: string;
  fetchedAt?: string;
}

interface BackendQueryResponse {
  answer: string;
  sources: Array<{
    chunkId: string;
    pageId: string;
    url: string;
    title?: string;
    score: number;
  }>;
}

export interface BackendJobStatus {
  jobId: string;
  siteId: string;
  status: 'QUEUED' | 'RUNNING' | 'CHECKPOINTED' | 'READY' | 'FAILED' | 'CANCELLED';
  pagesCrawled: number;
  pagesSkipped: number;
  errors: number;
}

// ── Mappers ───────────────────────────────────────────────────────────────────

const STATUS_MAP: Record<BackendSite['status'], SiteSummary['status']> = {
  QUEUED: 'queued',
  RUNNING: 'running',
  READY: 'completed',
  FAILED: 'failed',
};

function mapSite(s: BackendSite, jobId?: string): SiteSummary {
  const total = s.pageCount ?? 0;
  return {
    id: s.siteId,
    name: s.domain,
    domain: s.domain,
    seedUrl: s.rootUrl,
    status: STATUS_MAP[s.status] ?? 'idle',
    pages: total,
    chunks: s.chunkCount ?? 0,
    markdownSizeKb: Math.round((s.chunkCount ?? 0) * 350 * 5 / 1024),
    indexedPercent: s.status === 'READY' ? 100 : s.status === 'RUNNING' ? 50 : 0,
    lastCrawledAt: s.lastCrawledAt ?? s.createdAt,
    monthlyCostUsd: 0,
    activeJobId: jobId,
  };
}

function mapPageStatus(s: string): PageRecord['status'] {
  if (s === 'CRAWLED') return 'saved';
  if (s === 'FAILED') return 'failed';
  if (s.startsWith('SKIPPED')) return 'skipped';
  return 'skipped';
}

function mapPage(p: BackendPage, siteId: string): PageRecord {
  return {
    id: p.pageId,
    siteId,
    title: p.title ?? p.url,
    url: p.url,
    status: mapPageStatus(p.status),
    words: p.wordCount ?? 0,
    chunks: p.chunkCount ?? 0,
    markdownKey: p.markdownKey ?? '',
    updatedAt: p.fetchedAt ?? new Date().toISOString(),
  };
}

function mapQueryResult(r: BackendQueryResponse): QueryResult {
  return {
    answer: r.answer,
    citations: r.sources.map((s) => ({
      pageTitle: s.title ?? s.url,
      url: s.url,
      heading: '',
      score: s.score,
    })),
    latencyMs: 0,
    modelCostUsd: 0,
  };
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

// ── Mock fallback (used when VITE_API_BASE_URL is not set) ───────────────────

async function delay(ms = 420) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Public API ────────────────────────────────────────────────────────────────

export const api = {
  getSites: async (): Promise<SiteSummary[]> => {
    if (!API_BASE) {
      await delay();
      return mockSites;
    }
    const data = await get<{ sites: BackendSite[] }>('/sites');
    return data.sites.map((s) => mapSite(s));
  },

  getSite: async (siteId: string): Promise<SiteSummary> => {
    if (!API_BASE) {
      await delay();
      return mockSites[0];
    }
    const s = await get<BackendSite>(`/sites/${siteId}`);
    return mapSite(s);
  },

  getPages: async (siteId: string): Promise<PageRecord[]> => {
    if (!API_BASE) {
      await delay();
      return mockPages;
    }
    const data = await get<{ pages: BackendPage[] }>(`/sites/${siteId}/pages`);
    return data.pages.map((p) => mapPage(p, siteId));
  },

  startCrawl: async (payload: CrawlRequest): Promise<SiteSummary> => {
    if (!API_BASE) {
      await delay();
      const hostname = new URL(payload.seedUrl).hostname;
      return {
        id: `site_${Date.now()}`,
        name: hostname,
        domain: hostname,
        seedUrl: payload.seedUrl,
        status: 'queued',
        pages: 0,
        chunks: 0,
        markdownSizeKb: 0,
        indexedPercent: 0,
        lastCrawledAt: new Date().toISOString(),
        monthlyCostUsd: 0,
        activeJobId: `job_${Date.now()}`,
      };
    }

    const out = await post<{ siteId: string; jobId: string }>('/crawl', {
      url: payload.seedUrl,
      maxPages: payload.maxPages,
      respectRobotsTxt: payload.respectRobotsTxt,
      storeRawHtml: true,
    });

    const site = await get<BackendSite>(`/sites/${out.siteId}`);
    return mapSite(site, out.jobId);
  },

  pollJob: async (siteId: string, jobId: string): Promise<BackendJobStatus> => {
    if (!API_BASE) {
      await delay(200);
      return { jobId, siteId, status: 'READY', pagesCrawled: 10, pagesSkipped: 0, errors: 0 };
    }
    return get<BackendJobStatus>(`/jobs/${siteId}/${jobId}`);
  },

  querySite: async (siteId: string, question: string): Promise<QueryResult> => {
    if (!API_BASE) {
      await delay();
      return sampleQuery;
    }
    const data = await post<BackendQueryResponse>(`/sites/${siteId}/query`, {
      question,
      topK: 6,
    });
    return mapQueryResult(data);
  },

  exportMarkdown: async (siteId: string): Promise<{ url: string }> => {
    if (!API_BASE) {
      await delay();
      return { url: 'https://example.com/export.zip' };
    }
    const data = await post<{ downloadUrl: string }>(`/sites/${siteId}/export`, {
      format: 'zip',
    });
    return { url: data.downloadUrl };
  },
};
