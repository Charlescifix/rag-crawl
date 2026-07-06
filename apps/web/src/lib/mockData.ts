import type { PageRecord, QueryResult, SiteSummary } from '../types/domain';

export const sites: SiteSummary[] = [
  {
    id: 'site_001',
    name: 'Acme Docs',
    domain: 'docs.acme.test',
    seedUrl: 'https://docs.acme.test',
    status: 'completed',
    pages: 84,
    chunks: 612,
    markdownSizeKb: 1390,
    indexedPercent: 100,
    lastCrawledAt: '2026-06-26T08:42:00Z',
    monthlyCostUsd: 2.18
  },
  {
    id: 'site_002',
    name: 'Launch Handbook',
    domain: 'launch.example',
    seedUrl: 'https://launch.example/handbook',
    status: 'running',
    pages: 29,
    chunks: 184,
    markdownSizeKb: 522,
    indexedPercent: 62,
    lastCrawledAt: '2026-06-26T09:18:00Z',
    monthlyCostUsd: 0.71
  }
];

export const pages: PageRecord[] = [
  {
    id: 'page_001',
    siteId: 'site_001',
    title: 'Getting Started',
    url: 'https://docs.acme.test/getting-started',
    status: 'saved',
    words: 1450,
    chunks: 8,
    markdownKey: 'sites/site_001/pages/page_001.md',
    updatedAt: '2026-06-26T08:42:00Z'
  },
  {
    id: 'page_002',
    siteId: 'site_001',
    title: 'Billing and Refunds',
    url: 'https://docs.acme.test/billing/refunds',
    status: 'changed',
    words: 2140,
    chunks: 12,
    markdownKey: 'sites/site_001/pages/page_002.md',
    updatedAt: '2026-06-26T08:39:00Z'
  },
  {
    id: 'page_003',
    siteId: 'site_001',
    title: 'API Authentication',
    url: 'https://docs.acme.test/api/authentication',
    status: 'saved',
    words: 3260,
    chunks: 19,
    markdownKey: 'sites/site_001/pages/page_003.md',
    updatedAt: '2026-06-26T08:36:00Z'
  },
  {
    id: 'page_004',
    siteId: 'site_001',
    title: 'Rate Limits',
    url: 'https://docs.acme.test/api/rate-limits',
    status: 'saved',
    words: 980,
    chunks: 5,
    markdownKey: 'sites/site_001/pages/page_004.md',
    updatedAt: '2026-06-26T08:31:00Z'
  },
  {
    id: 'page_005',
    siteId: 'site_001',
    title: 'Changelog',
    url: 'https://docs.acme.test/changelog',
    status: 'skipped',
    words: 0,
    chunks: 0,
    markdownKey: '',
    updatedAt: '2026-06-26T08:29:00Z'
  }
];

export const sampleQuery: QueryResult = {
  answer:
    'Refunds are available within 14 days for self-serve plans. Enterprise contracts require account manager approval. The crawler found this answer in the Billing and Refunds page and one related pricing page.',
  citations: [
    {
      pageTitle: 'Billing and Refunds',
      url: 'https://docs.acme.test/billing/refunds',
      heading: 'Refund window',
      score: 0.91
    },
    {
      pageTitle: 'Pricing',
      url: 'https://docs.acme.test/pricing',
      heading: 'Plan changes',
      score: 0.84
    }
  ],
  latencyMs: 1180,
  modelCostUsd: 0.0048
};
