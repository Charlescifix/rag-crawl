# Lightweight AWS Website Crawler + Markdown Export + AI Query System

This document is a build specification for a cheap, fast-to-deploy AWS MVP.

The goal is to build a lightweight website crawler that:

1. Accepts a public website URL.
2. Crawls only allowed internal pages.
3. Extracts readable page text.
4. Converts each page to Markdown.
5. Stores Markdown cheaply in S3.
6. Stores only metadata in DynamoDB.
7. Lets a user query the crawled content with AI.
8. Lets a user export Markdown files.
9. Avoids OpenSearch, ECS, RDS, Postgres, Step Functions, and expensive managed vector databases for the MVP.

---

## 1. Core Architecture

Use the cheapest practical serverless stack:

```txt
Amplify-hosted UI
  ↓
API Gateway HTTP API
  ↓
Lambda functions
  ↓
S3 for Markdown, raw HTML, chunks, exports, and lightweight indexes
  ↓
DynamoDB for metadata and crawl/query state only
  ↓
OpenAI / Anthropic / Bedrock model API for final answering
```

Do **not** use OpenSearch for the MVP.
Do **not** store full Markdown or HTML in DynamoDB.
Do **not** build a custom vector database at first.

---

## 2. Product Features

### MVP Features

- User enters a root website URL.
- Backend starts a crawl job.
- Crawler follows same-domain links only.
- Crawler respects `robots.txt`.
- Crawler extracts main readable text from HTML.
- Crawler converts content to Markdown.
- Markdown is stored in S3.
- Raw HTML is optionally stored compressed in S3 for debugging.
- Page metadata is stored in DynamoDB.
- Content is split into chunks.
- Chunks are stored as compressed NDJSON in S3.
- A lightweight lexical search index is stored in S3.
- User asks a question about the site.
- Query Lambda retrieves relevant chunks.
- LLM answers using only retrieved chunks.
- Answer includes source URLs.
- User can export all Markdown as a ZIP or one combined `.md` file.

### Non-Goals for MVP

- No OpenSearch.
- No ECS/Fargate.
- No RDS/Postgres.
- No pgvector.
- No browser rendering / Playwright by default.
- No crawling login-required pages.
- No crawling paywalled/private content.
- No crawling arbitrary external domains from discovered links.
- No infinite crawling.
- No real-time streaming required.
- No multi-tenant enterprise permissions yet, unless explicitly needed.

---

## 3. AWS Services

### Required

| Service | Purpose | Cost posture |
|---|---|---|
| AWS Amplify Hosting | Host React/Next.js frontend | Cheap for small apps |
| API Gateway HTTP API | Public API endpoints | Cheaper than REST API in many cases |
| Lambda | API, crawler, query, export functions | Very cheap under light usage |
| S3 | Store Markdown, raw HTML, chunks, indexes, exports | Very cheap |
| DynamoDB on-demand | Store metadata, jobs, page records | Cheap for low traffic |
| CloudWatch Logs | Logs/debugging | Keep retention short to control cost |
| SSM Parameter Store | Store API keys/secrets references | Cheaper than Secrets Manager for MVP |

### Optional but still cheap

| Service | Purpose |
|---|---|
| SQS | More reliable crawl queue and retry handling |
| Cognito | User accounts/authentication |
| CloudFront | Usually included/handled with Amplify hosting |

### Avoid in MVP

| Service | Reason to avoid initially |
|---|---|
| OpenSearch | Usually too expensive for this MVP |
| ECS/Fargate | More moving parts and cost than Lambda |
| RDS/Aurora | Fixed baseline cost and operational complexity |
| Step Functions | Useful later, but unnecessary for smallest version |
| Bedrock Knowledge Bases | Nice managed RAG, but not needed for cheapest custom MVP |

---

## 4. Important AWS Constraints

Design around these constraints:

1. **DynamoDB item size limit:** 400 KB per item. Therefore, store large Markdown/HTML/chunk payloads in S3 and keep only S3 keys in DynamoDB.
2. **Lambda max duration:** 15 minutes per invocation. Therefore, crawl jobs must be bounded, checkpointed, or re-invoked.
3. **API Gateway default timeout:** do not keep HTTP requests open during crawl. `POST /crawl` should return quickly with a `jobId`.
4. **Lambda environment variables:** total environment variable size is limited, so large config should live in SSM/S3 rather than environment variables.
5. **Lambda memory:** use streaming and page-by-page processing. Do not load an entire website or all raw HTML into memory.

Practical Lambda sizes:

```txt
startCrawl Lambda: 128–256 MB
crawlWorker Lambda: 512–1024 MB
query Lambda: 256–512 MB
export Lambda: 512–1024 MB
```

Keep CloudWatch log retention low, for example 7 or 14 days.

---

## 5. Storage Design

### Rule

S3 stores content.
DynamoDB stores metadata.

### S3 Layout

Use one bucket, for example:

```txt
crawler-data-{stage}-{accountId}
```

Suggested object keys:

```txt
sites/{siteId}/site.json
sites/{siteId}/robots.txt

sites/{siteId}/pages/{pageId}/page.md
sites/{siteId}/pages/{pageId}/raw.html.gz
sites/{siteId}/pages/{pageId}/meta.json

sites/{siteId}/chunks/chunks.ndjson.gz
sites/{siteId}/indexes/lexical-index.json.gz
sites/{siteId}/indexes/embeddings.ndjson.gz        # optional later

sites/{siteId}/exports/site.md
sites/{siteId}/exports/site.zip
sites/{siteId}/exports/export-{timestamp}.zip

sites/{siteId}/jobs/{jobId}/frontier.json
sites/{siteId}/jobs/{jobId}/seen.json
sites/{siteId}/jobs/{jobId}/errors.ndjson
```

### Why S3 for Text

Markdown and raw HTML can easily exceed DynamoDB's item limit. S3 is cheaper and better for blobs/files. DynamoDB items should contain pointers like:

```json
{
  "siteId": "abc123",
  "pageId": "def456",
  "url": "https://example.com/docs/pricing",
  "title": "Pricing",
  "markdownKey": "sites/abc123/pages/def456/page.md",
  "rawHtmlKey": "sites/abc123/pages/def456/raw.html.gz",
  "contentHash": "sha256...",
  "fetchedAt": "2026-06-26T12:00:00Z"
}
```

---

## 6. DynamoDB Design

For the MVP, use a single-table design to reduce overhead.

Table name:

```txt
CrawlerTable-{stage}
```

Primary key:

```txt
PK: string
SK: string
```

Recommended access patterns:

- Get site metadata.
- List all sites.
- List pages for a site.
- Get page metadata.
- Get crawl job status.
- List recent crawl jobs.
- List recent user queries.

### Entity: Site

```json
{
  "PK": "SITE#site_123",
  "SK": "META",
  "entityType": "SITE",
  "siteId": "site_123",
  "rootUrl": "https://example.com/docs",
  "domain": "example.com",
  "status": "READY",
  "createdAt": "2026-06-26T12:00:00Z",
  "updatedAt": "2026-06-26T12:10:00Z",
  "lastCrawledAt": "2026-06-26T12:10:00Z",
  "pageCount": 24,
  "chunkCount": 181,
  "totalWords": 65000,
  "indexKey": "sites/site_123/indexes/lexical-index.json.gz",
  "chunksKey": "sites/site_123/chunks/chunks.ndjson.gz"
}
```

### Entity: Page

```json
{
  "PK": "SITE#site_123",
  "SK": "PAGE#page_456",
  "entityType": "PAGE",
  "siteId": "site_123",
  "pageId": "page_456",
  "url": "https://example.com/docs/pricing",
  "normalizedUrl": "https://example.com/docs/pricing",
  "title": "Pricing",
  "status": "CRAWLED",
  "httpStatus": 200,
  "contentType": "text/html",
  "markdownKey": "sites/site_123/pages/page_456/page.md",
  "rawHtmlKey": "sites/site_123/pages/page_456/raw.html.gz",
  "contentHash": "sha256...",
  "wordCount": 2450,
  "chunkCount": 8,
  "fetchedAt": "2026-06-26T12:05:00Z"
}
```

### Entity: Crawl Job

```json
{
  "PK": "SITE#site_123",
  "SK": "JOB#job_789",
  "entityType": "JOB",
  "jobId": "job_789",
  "siteId": "site_123",
  "status": "RUNNING",
  "startedAt": "2026-06-26T12:01:00Z",
  "finishedAt": null,
  "maxPages": 50,
  "maxDepth": 3,
  "pagesCrawled": 12,
  "pagesSkipped": 4,
  "errors": 0,
  "frontierKey": "sites/site_123/jobs/job_789/frontier.json",
  "seenKey": "sites/site_123/jobs/job_789/seen.json"
}
```

### Entity: Query Log

```json
{
  "PK": "SITE#site_123",
  "SK": "QUERY#2026-06-26T12:20:00Z#query_abc",
  "entityType": "QUERY",
  "queryId": "query_abc",
  "siteId": "site_123",
  "question": "How does pricing work?",
  "answerPreview": "Pricing is based on...",
  "sourceCount": 4,
  "createdAt": "2026-06-26T12:20:00Z"
}
```

### Optional GSI

If the UI needs to list all sites across users:

```txt
GSI1PK = USER#{userId}
GSI1SK = SITE#{createdAt}#{siteId}
```

For a single-user MVP, skip auth and skip the GSI.

---

## 7. API Design

Use API Gateway HTTP API.

### `POST /crawl`

Starts a crawl job and returns immediately.

Request:

```json
{
  "url": "https://example.com/docs",
  "maxPages": 50,
  "maxDepth": 3,
  "respectRobotsTxt": true,
  "storeRawHtml": true
}
```

Response:

```json
{
  "siteId": "site_123",
  "jobId": "job_789",
  "status": "QUEUED"
}
```

Implementation:

- Validate URL.
- Normalize root URL.
- Create or update `SITE` item.
- Create `JOB` item.
- Write initial frontier to S3.
- Invoke `crawlWorker` Lambda asynchronously.
- Return quickly.

Do not do crawling inside the request/response Lambda.

---

### `GET /sites`

Lists known sites.

Response:

```json
{
  "sites": [
    {
      "siteId": "site_123",
      "rootUrl": "https://example.com/docs",
      "status": "READY",
      "pageCount": 24,
      "chunkCount": 181,
      "lastCrawledAt": "2026-06-26T12:10:00Z"
    }
  ]
}
```

---

### `GET /sites/{siteId}`

Returns site metadata.

---

### `GET /sites/{siteId}/pages`

Lists page metadata for one site.

Response:

```json
{
  "pages": [
    {
      "pageId": "page_456",
      "url": "https://example.com/docs/pricing",
      "title": "Pricing",
      "wordCount": 2450,
      "chunkCount": 8,
      "fetchedAt": "2026-06-26T12:05:00Z"
    }
  ]
}
```

---

### `GET /sites/{siteId}/pages/{pageId}/markdown`

Returns the Markdown content for preview in the UI.

Implementation:

- Look up page metadata in DynamoDB.
- Read Markdown from S3.
- Return text/plain or JSON.

---

### `POST /sites/{siteId}/query`

Queries crawled site content.

Request:

```json
{
  "question": "How does pricing work?",
  "topK": 6,
  "model": "default"
}
```

Response:

```json
{
  "answer": "Pricing works by...",
  "sources": [
    {
      "url": "https://example.com/docs/pricing",
      "title": "Pricing",
      "chunkId": "chunk_001",
      "score": 12.42
    }
  ]
}
```

---

### `POST /sites/{siteId}/export`

Creates a Markdown export.

Request:

```json
{
  "format": "zip"
}
```

Allowed formats:

```txt
zip
single-md
```

Response:

```json
{
  "exportKey": "sites/site_123/exports/export-2026-06-26.zip",
  "downloadUrl": "https://signed-s3-url...",
  "expiresInSeconds": 3600
}
```

---

### `GET /jobs/{siteId}/{jobId}`

Returns crawl job status.

Response:

```json
{
  "jobId": "job_789",
  "siteId": "site_123",
  "status": "RUNNING",
  "pagesCrawled": 12,
  "pagesSkipped": 4,
  "errors": 0
}
```

---

## 8. Lambda Functions

### `startCrawl`

Triggered by:

```txt
POST /crawl
```

Responsibilities:

- Validate URL.
- Create `siteId`.
- Create `jobId`.
- Store site/job records in DynamoDB.
- Store crawl frontier in S3.
- Async invoke `crawlWorker`.
- Return `siteId` and `jobId`.

---

### `crawlWorker`

Triggered by:

```txt
Async Lambda invocation
```

Optional later trigger:

```txt
SQS message
```

Responsibilities:

- Load job state from DynamoDB.
- Load frontier/seen state from S3.
- Fetch and parse robots.txt.
- Crawl page-by-page.
- Extract text.
- Convert to Markdown.
- Store Markdown in S3.
- Optionally store raw HTML compressed in S3.
- Update page metadata in DynamoDB.
- Split pages into chunks.
- Rebuild `chunks.ndjson.gz` and `lexical-index.json.gz`.
- Update site stats.
- Save progress before timeout.
- Reinvoke itself if frontier remains.

Important:

- Check `context.getRemainingTimeInMillis()`.
- If less than 30 seconds remains, checkpoint state and async invoke itself again.
- Stop when `maxPages` or `maxDepth` is reached.

---

### `querySite`

Triggered by:

```txt
POST /sites/{siteId}/query
```

Responsibilities:

- Load site metadata.
- Load chunks/index from S3.
- Run cheap local search.
- Select top chunks.
- Build LLM prompt.
- Call AI model.
- Return answer and sources.
- Store query log in DynamoDB.

---

### `exportMarkdown`

Triggered by:

```txt
POST /sites/{siteId}/export
```

Responsibilities:

- List pages for site from DynamoDB.
- Read Markdown files from S3.
- Generate either:
  - ZIP of individual `.md` files, or
  - one combined `site.md` file.
- Store export in S3.
- Return signed download URL.

For very small sites, generating ZIP in Lambda is fine.
For larger sites, prefer single combined Markdown first because it is simpler and cheaper.

---

## 9. Crawler Rules

### URL Rules

The crawler must:

- Accept only `http://` and `https://` URLs.
- Normalize URLs.
- Strip URL fragments.
- Remove common tracking query params:
  - `utm_source`
  - `utm_medium`
  - `utm_campaign`
  - `utm_term`
  - `utm_content`
  - `fbclid`
  - `gclid`
- Stay on the same hostname by default.
- Ignore mailto/tel/javascript links.
- Avoid duplicate URLs.
- Follow redirects only if final URL is still allowed.

### Security / SSRF Protection

Because users can submit URLs, protect against SSRF.

Block:

- `localhost`
- `127.0.0.0/8`
- `10.0.0.0/8`
- `172.16.0.0/12`
- `192.168.0.0/16`
- `169.254.0.0/16`
- `::1`
- private IPv6 ranges
- AWS metadata IP: `169.254.169.254`
- non-HTTP protocols

Implementation must:

- Resolve DNS before fetch.
- Reject private/reserved IPs.
- Re-check after redirects.
- Limit redirects, for example max 5.
- Set max response size, for example 2 MB HTML per page.
- Set request timeout, for example 10 seconds.
- Do not allow user-supplied request headers in MVP.

### Crawl Limits

Defaults:

```json
{
  "maxPages": 50,
  "maxDepth": 3,
  "maxHtmlBytes": 2000000,
  "requestTimeoutMs": 10000,
  "delayBetweenRequestsMs": 500,
  "maxRedirects": 5
}
```

These limits keep Lambda runtime predictable and costs low.

### Robots.txt

- Fetch `https://domain.com/robots.txt` once per site.
- Respect `Disallow` rules for the crawler's user agent.
- Use a clear user agent, for example:

```txt
LightweightCrawlerBot/0.1 (+https://yourdomain.com/bot)
```

### Content-Type Rules

Crawl only:

```txt
text/html
application/xhtml+xml
```

Skip:

```txt
application/pdf
image/*
video/*
audio/*
application/zip
application/octet-stream
```

PDF support can be added later, but exclude it for the cheap MVP.

---

## 10. Text Extraction and Markdown Conversion

### Recommended Node.js Libraries

For Lambda/TypeScript:

```txt
undici              # HTTP fetch
cheerio             # HTML parsing/link extraction
@mozilla/readability # main article/content extraction
jsdom               # DOM support for Readability
turndown            # HTML to Markdown
robots-parser       # robots.txt checks
pako or zlib        # gzip compression
nanoid or uuid      # ids
```

Alternative Python libraries:

```txt
httpx
beautifulsoup4
readability-lxml
markdownify
trafilatura
```

Node.js/TypeScript is a good fit if the UI and infrastructure are also TypeScript.

### Extraction Steps

For each fetched HTML page:

1. Parse HTML.
2. Extract title.
3. Remove scripts, styles, nav, footer, ads, cookie banners where possible.
4. Use Readability-style extraction to get the main content.
5. Convert extracted content to Markdown.
6. Clean excessive whitespace.
7. Add frontmatter.
8. Store Markdown in S3.

### Markdown Format

Each page Markdown should include YAML frontmatter:

```md
---
site_id: site_123
page_id: page_456
url: https://example.com/docs/pricing
title: Pricing
fetched_at: 2026-06-26T12:05:00Z
content_hash: sha256...
---

# Pricing

Markdown content here...
```

---

## 11. Chunking Strategy

Do not send entire websites to the AI.

Split Markdown into chunks.

Recommended MVP chunk settings:

```txt
chunkTargetWords: 350
chunkMaxWords: 500
chunkOverlapWords: 50
```

Chunk object format:

```json
{
  "chunkId": "chunk_001",
  "siteId": "site_123",
  "pageId": "page_456",
  "url": "https://example.com/docs/pricing",
  "title": "Pricing",
  "headingPath": ["Pricing", "Refunds"],
  "text": "Refunds are available within...",
  "wordCount": 342
}
```

Store chunks in S3 as compressed NDJSON:

```txt
sites/{siteId}/chunks/chunks.ndjson.gz
```

NDJSON example:

```jsonl
{"chunkId":"chunk_001","pageId":"page_456","url":"https://example.com/docs/pricing","title":"Pricing","text":"..."}
{"chunkId":"chunk_002","pageId":"page_456","url":"https://example.com/docs/pricing","title":"Pricing","text":"..."}
```

---

## 12. Cheap Search Without OpenSearch

For the MVP, use a lightweight local lexical search in Lambda.

### Search Mode 1: Simplest Scan

For small sites, just load `chunks.ndjson.gz` from S3 and score chunks in memory.

Good for:

```txt
<= 1,000 chunks
```

Scoring idea:

- tokenize question
- tokenize chunk title + heading + text
- score exact term matches
- boost title matches
- boost heading matches
- boost phrase matches
- return top K chunks

This has zero vector DB cost.

### Search Mode 2: Lightweight BM25-like Index

For slightly larger sites, build a small lexical index and store it in S3:

```txt
sites/{siteId}/indexes/lexical-index.json.gz
```

Index format:

```json
{
  "siteId": "site_123",
  "chunkCount": 181,
  "avgDocLength": 210,
  "documents": {
    "chunk_001": {
      "pageId": "page_456",
      "url": "https://example.com/docs/pricing",
      "title": "Pricing",
      "length": 342
    }
  },
  "terms": {
    "refund": {
      "df": 3,
      "postings": {
        "chunk_001": 4,
        "chunk_019": 2
      }
    }
  }
}
```

Query Lambda loads the index, calculates BM25-ish scores, loads top chunk texts, then sends only those chunks to the model.

Good for:

```txt
1,000–10,000 chunks, depending on compressed index size and Lambda memory
```

### Search Mode 3: Optional Embeddings Later

Embeddings improve semantic search but add model cost.

Do not use them on day one unless lexical search quality is poor.

If using embeddings later:

- Generate embeddings once per chunk after crawling.
- Store embeddings in S3 as compressed NDJSON.
- Query Lambda embeds the user question.
- Lambda loads vectors from S3 and calculates cosine similarity in memory.
- Return top K chunks.

No vector database is required for a small corpus.

Optional embedding file:

```txt
sites/{siteId}/indexes/embeddings.ndjson.gz
```

Example row:

```jsonl
{"chunkId":"chunk_001","vector":[0.0123,-0.0456,0.0789]}
```

To save space later:

- Use float32 arrays instead of JSON arrays.
- Quantize vectors.
- Shard by site or page.
- Keep lexical search as fallback.

---

## 13. Query Flow

When user asks a question:

```txt
Question
  ↓
Load chunks/index from S3
  ↓
Score chunks locally in Lambda
  ↓
Select top 4–8 chunks
  ↓
Build model prompt
  ↓
Call AI model
  ↓
Return answer + source URLs
```

### Prompt Template

```txt
You are answering questions about a crawled website.
Use only the provided context.
If the answer is not in the context, say that the crawled pages do not contain enough information.
Do not invent facts.
Cite sources using [1], [2], etc.

Context:
[1]
Title: {title}
URL: {url}
Content:
{chunkText}

[2]
Title: {title}
URL: {url}
Content:
{chunkText}

Question:
{question}

Answer:
```

### Query Limits

To control LLM cost:

```txt
topK: 6
maxChunkWords: 500
maxContextWords: 2500
maxAnswerTokens: 700
```

Also cache query results if the same question is asked repeatedly.

---

## 14. AI Provider Design

Keep the AI provider swappable.

Create this interface:

```ts
interface AiProvider {
  answerWithContext(input: {
    question: string;
    contexts: Array<{
      id: string;
      title: string;
      url: string;
      text: string;
    }>;
    maxTokens?: number;
  }): Promise<{
    answer: string;
    usage?: unknown;
  }>;
}
```

Implement providers later:

```txt
OpenAIAnswerProvider
AnthropicAnswerProvider
BedrockAnswerProvider
```

For cheapest MVP, use one provider first and keep the interface clean.

Store provider API key in SSM Parameter Store, not hardcoded in source.

Environment variables should contain only names/paths:

```txt
AI_PROVIDER=openai
AI_API_KEY_PARAM=/crawler/dev/openai_api_key
CRAWLER_TABLE=CrawlerTable-dev
DATA_BUCKET=crawler-data-dev-123456789
```

---

## 15. Frontend UI

Use Amplify Hosting for a React or Next.js frontend.

### Pages

```txt
/
/sites
/sites/:siteId
/sites/:siteId/pages
/sites/:siteId/query
/sites/:siteId/export
```

### Main Components

```txt
CrawlForm
CrawlStatusCard
SiteList
PageList
MarkdownPreview
QueryPanel
AnswerWithSources
ExportButton
```

### UI Flow

1. User enters a URL.
2. UI calls `POST /crawl`.
3. UI polls `GET /jobs/{siteId}/{jobId}` every few seconds.
4. When job is ready, UI shows page list and query box.
5. User asks a question.
6. UI shows answer and source URLs.
7. User exports Markdown.

### Avoid WebSockets for MVP

Polling is cheaper and simpler.

---

## 16. Deployment Recommendation

Use one of these:

### Option A: AWS CDK with TypeScript

Best if the agent can generate infrastructure code.

Suggested structure:

```txt
lightweight-crawler/
  apps/
    web/
      src/
      package.json
  packages/
    shared/
      src/
  services/
    api/
      src/
        lambdas/
          startCrawl.ts
          crawlWorker.ts
          querySite.ts
          exportMarkdown.ts
          getSites.ts
          getPages.ts
        lib/
          crawler/
          storage/
          search/
          ai/
          markdown/
          security/
      package.json
  infra/
    bin/
      app.ts
    lib/
      crawler-stack.ts
    package.json
  README.md
```

### Option B: SST

Fast developer experience, but adds framework dependency.
Good if the project prefers quick iteration.

### Option C: AWS SAM

Simple Lambda-first deployment.
Good if the backend is small and the frontend is deployed separately through Amplify.

### Recommended for this project

Use **AWS CDK TypeScript** unless the agent/team strongly prefers SAM.

---

## 17. Infrastructure Requirements

Create:

1. S3 data bucket.
2. DynamoDB table with `PK` and `SK`.
3. Lambda functions:
   - `startCrawl`
   - `crawlWorker`
   - `querySite`
   - `exportMarkdown`
   - `getSites`
   - `getSite`
   - `getPages`
   - `getJob`
4. API Gateway HTTP API routes.
5. IAM permissions with least privilege.
6. SSM parameters for AI API keys.
7. CloudWatch log groups with short retention.
8. CORS config for Amplify frontend domain.

### IAM Permissions

`startCrawl` needs:

```txt
dynamodb:PutItem
dynamodb:GetItem
dynamodb:UpdateItem
s3:PutObject
s3:GetObject
lambda:InvokeFunction
```

`crawlWorker` needs:

```txt
dynamodb:GetItem
dynamodb:PutItem
dynamodb:UpdateItem
dynamodb:Query
s3:GetObject
s3:PutObject
lambda:InvokeFunction
```

`querySite` needs:

```txt
dynamodb:GetItem
dynamodb:PutItem
s3:GetObject
ssm:GetParameter
```

`exportMarkdown` needs:

```txt
dynamodb:Query
s3:GetObject
s3:PutObject
s3:PutObjectTagging
s3:GetObject
```

For signed URLs, use AWS SDK presigner in Lambda.

---

## 18. Cheap Cost Controls

### Hard Limits

Set default limits:

```txt
maxPages = 50
maxDepth = 3
maxHtmlBytes = 2 MB
maxRuntimePerWorker = 14 minutes
maxChunksPerSite = 2,000 initially
maxContextWordsPerQuery = 2,500
```

### Logging

- Do not log full HTML.
- Do not log full Markdown.
- Do not log API keys.
- Log page URL, status, timings, error summary.
- Set CloudWatch log retention to 7 or 14 days.

### S3 Lifecycle

Add lifecycle rules:

```txt
raw HTML: delete after 7–30 days
exports: delete after 7 days
job frontier/seen files: delete after 7 days
Markdown: keep
chunks/indexes: keep
```

### DynamoDB

- Use on-demand billing for MVP.
- Store only metadata.
- Avoid large attributes.
- Avoid scans except tiny admin MVP cases.

### LLM Cost

- Retrieve only top chunks.
- Keep answers short.
- Use smaller/cheaper models by default.
- Add a max output token limit.
- Cache identical questions per site if useful.

---

## 19. Runtime Memory Plan

The project should not need large memory if designed correctly.

### During Crawl

Process one page at a time:

```txt
fetch HTML
extract Markdown
upload Markdown
extract links
release page memory
move to next page
```

Do not keep all raw HTML in memory.

### During Query

For small sites:

```txt
load compressed chunks/index from S3
score chunks
select topK
call LLM
```

For larger sites:

```txt
shard chunks/index by page or prefix
load only relevant shard if possible
or impose MVP chunk limit
```

### Suggested MVP Limit

```txt
50 pages
2,000 chunks max
compressed chunks/index in S3
512 MB Lambda query memory
```

---

## 20. File Export Design

### Single Markdown Export

Simplest and cheapest.

Output:

```txt
sites/{siteId}/exports/site.md
```

Format:

```md
# Export for https://example.com

Generated at: 2026-06-26T12:30:00Z

---

# Page: Pricing

Source: https://example.com/docs/pricing

...page markdown...

---

# Page: FAQ

Source: https://example.com/docs/faq

...page markdown...
```

### ZIP Export

For individual files:

```txt
pricing.md
faq.md
getting-started.md
```

Use safe filenames derived from URL paths.

Example:

```txt
https://example.com/docs/getting-started -> docs-getting-started.md
```

---

## 21. Error Handling

Page-level errors should not fail the entire crawl.

Store errors in:

```txt
sites/{siteId}/jobs/{jobId}/errors.ndjson
```

Example error row:

```json
{
  "url": "https://example.com/missing-page",
  "errorType": "HTTP_STATUS",
  "message": "404",
  "timestamp": "2026-06-26T12:08:00Z"
}
```

Crawl job statuses:

```txt
QUEUED
RUNNING
CHECKPOINTED
READY
FAILED
CANCELLED
```

Page statuses:

```txt
DISCOVERED
CRAWLED
SKIPPED_ROBOTS
SKIPPED_CONTENT_TYPE
SKIPPED_EXTERNAL_DOMAIN
SKIPPED_TOO_LARGE
FAILED
UNCHANGED
```

---

## 22. URL and ID Generation

### `siteId`

Generate with NanoID or UUID:

```txt
site_abc123
```

### `pageId`

Use stable hash of normalized URL:

```ts
pageId = "page_" + sha256(normalizedUrl).slice(0, 16)
```

### `contentHash`

Use hash of cleaned Markdown:

```ts
contentHash = sha256(markdown)
```

If content hash is unchanged, skip rewriting chunks for that page unless rebuilding whole index.

---

## 23. Implementation Steps for Agent

Build in this order.

### Phase 1: Local Prototype

1. Create monorepo.
2. Implement URL normalization.
3. Implement SSRF/private IP protection.
4. Implement simple crawler for one domain.
5. Implement HTML extraction to Markdown.
6. Save Markdown locally.
7. Implement chunking.
8. Implement local lexical search over chunks.
9. Implement model prompt and answer function.

Acceptance:

```txt
Given a URL, local script produces Markdown files and can answer questions from them.
```

---

### Phase 2: AWS Backend

1. Create CDK/SAM stack.
2. Create S3 bucket.
3. Create DynamoDB table.
4. Create `startCrawl` Lambda.
5. Create `crawlWorker` Lambda.
6. Create `querySite` Lambda.
7. Create `exportMarkdown` Lambda.
8. Create API Gateway HTTP API routes.
9. Add CORS.
10. Add SSM parameter lookup for AI API key.

Acceptance:

```txt
POST /crawl starts a job.
GET /jobs/{siteId}/{jobId} shows progress.
POST /sites/{siteId}/query returns an answer with sources.
POST /sites/{siteId}/export returns a signed S3 URL.
```

---

### Phase 3: UI

1. Create React/Next.js frontend.
2. Add crawl form.
3. Add crawl status polling.
4. Add page list.
5. Add Markdown preview.
6. Add query UI.
7. Add source display.
8. Add export button.
9. Deploy on Amplify.

Acceptance:

```txt
User can crawl, inspect, query, and export from the browser.
```

---

### Phase 4: Hardening

1. Add stricter robots.txt handling.
2. Add better duplicate detection.
3. Add content hash skip logic.
4. Add query caching.
5. Add S3 lifecycle rules.
6. Add CloudWatch metrics.
7. Add basic auth through Cognito if needed.
8. Add optional embeddings mode only if lexical search is not good enough.

---

## 24. Suggested TypeScript Interfaces

### Site

```ts
export interface SiteRecord {
  PK: string;
  SK: "META";
  entityType: "SITE";
  siteId: string;
  rootUrl: string;
  domain: string;
  status: "QUEUED" | "RUNNING" | "READY" | "FAILED";
  createdAt: string;
  updatedAt: string;
  lastCrawledAt?: string;
  pageCount?: number;
  chunkCount?: number;
  totalWords?: number;
  chunksKey?: string;
  indexKey?: string;
}
```

### Page

```ts
export interface PageRecord {
  PK: string;
  SK: string;
  entityType: "PAGE";
  siteId: string;
  pageId: string;
  url: string;
  normalizedUrl: string;
  title?: string;
  status: string;
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
```

### Chunk

```ts
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
```

### Query Result

```ts
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
```

---

## 25. Local Search Pseudocode

```ts
function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter((term) => term.length > 2)
}

function scoreChunk(question: string, chunk: ChunkRecord): number {
  const queryTerms = tokenize(question)
  const titleTerms = tokenize(chunk.title ?? "")
  const headingTerms = tokenize((chunk.headingPath ?? []).join(" "))
  const bodyTerms = tokenize(chunk.text)

  const bodyCounts = new Map<string, number>()
  for (const term of bodyTerms) {
    bodyCounts.set(term, (bodyCounts.get(term) ?? 0) + 1)
  }

  let score = 0

  for (const term of queryTerms) {
    score += (bodyCounts.get(term) ?? 0)
    if (titleTerms.includes(term)) score += 5
    if (headingTerms.includes(term)) score += 3
  }

  const lowerText = chunk.text.toLowerCase()
  if (lowerText.includes(question.toLowerCase())) {
    score += 20
  }

  return score
}

function searchChunks(question: string, chunks: ChunkRecord[], topK = 6) {
  return chunks
    .map((chunk) => ({ chunk, score: scoreChunk(question, chunk) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
}
```

This is intentionally simple. Upgrade to BM25 when needed.

---

## 26. Crawler Pseudocode

```ts
async function crawlJob(job: CrawlJob) {
  const state = await loadJobState(job)
  const robots = await loadRobotsTxt(job.rootUrl)

  while (state.frontier.length > 0) {
    if (isNearLambdaTimeout()) {
      await saveJobState(state)
      await reinvokeCrawlWorker(job.jobId)
      return
    }

    const next = state.frontier.shift()
    const url = normalizeUrl(next.url)

    if (state.seen.has(url)) continue
    if (!isSameHost(url, job.rootUrl)) continue
    if (!isAllowedBySecurityRules(url)) continue
    if (!robots.isAllowed(url, USER_AGENT)) continue
    if (state.pagesCrawled >= job.maxPages) break
    if (next.depth > job.maxDepth) continue

    state.seen.add(url)

    try {
      const response = await fetchHtml(url)
      if (!isHtml(response.contentType)) continue

      const extracted = extractReadableContent(response.html, url)
      const markdown = convertToMarkdown(extracted.html)
      const contentHash = sha256(markdown)
      const pageId = pageIdFromUrl(url)

      await putS3(markdownKey(job.siteId, pageId), markdown)
      await putS3(rawHtmlKey(job.siteId, pageId), gzip(response.html))
      await putPageRecord({ pageId, url, title: extracted.title, contentHash })

      const links = extractInternalLinks(response.html, url)
      for (const link of links) {
        state.frontier.push({ url: link, depth: next.depth + 1 })
      }

      state.pagesCrawled++
      await sleep(job.delayBetweenRequestsMs)
    } catch (error) {
      await recordPageError(job, url, error)
    }
  }

  await rebuildChunksAndIndex(job.siteId)
  await markJobReady(job)
}
```

---

## 27. Deployment Commands

Example CDK workflow:

```bash
npm install
npm run build
cd infra
npx cdk bootstrap
npx cdk deploy
```

Set AI API key in SSM:

```bash
aws ssm put-parameter \
  --name "/crawler/dev/openai_api_key" \
  --type "SecureString" \
  --value "YOUR_API_KEY" \
  --overwrite
```

Frontend Amplify:

1. Push frontend to GitHub.
2. Connect repo in AWS Amplify.
3. Set API base URL environment variable.
4. Deploy.

Frontend env example:

```txt
VITE_API_BASE_URL=https://abc123.execute-api.us-east-1.amazonaws.com
```

---

## 28. Testing Checklist

### Unit Tests

- URL normalization.
- Private IP blocking.
- Robots.txt matching.
- HTML extraction.
- Markdown conversion.
- Chunking.
- Search scoring.
- Prompt construction.

### Integration Tests

- Crawl a small static test site.
- Store Markdown in S3.
- Store metadata in DynamoDB.
- Query site content.
- Export Markdown.

### Safety Tests

Try and block:

```txt
http://localhost:3000
http://127.0.0.1
http://169.254.169.254/latest/meta-data
file:///etc/passwd
ftp://example.com/file
https://example.com redirecting to private IP
```

---

## 29. Future Upgrade Path

Only upgrade if the MVP proves useful.

### If crawling takes too long

Add SQS queue and process batches.

### If JavaScript pages are needed

Add optional Playwright crawler using Lambda container image or ECS/Fargate.
Do not add this initially.

### If search quality is poor

Add embeddings stored in S3.
Still avoid OpenSearch at first.

### If corpus grows large

Move from S3-loaded index to:

- Aurora Postgres + pgvector
- OpenSearch
- Qdrant
- Bedrock Knowledge Bases

But only after cheap MVP limits are exceeded.

### If users need accounts

Add Cognito and scope every record by `userId`.

---

## 30. Agent Build Instructions

Build the cheapest working version first.

Priority order:

1. Make local crawler work.
2. Save clean Markdown.
3. Save metadata separately.
4. Implement cheap local search.
5. Add AI answer generation.
6. Deploy backend with API Gateway + Lambda + S3 + DynamoDB.
7. Deploy UI with Amplify.
8. Add export.
9. Harden security and cost controls.

Do not introduce OpenSearch, RDS, ECS, or Step Functions unless explicitly requested later.

Keep the architecture boring, cheap, and easy to replace.

---

## 31. Official AWS References Checked

Useful AWS constraints and docs to keep in mind while implementing:

- DynamoDB item size is limited to 400 KB, and AWS recommends S3 for larger objects with a pointer in DynamoDB: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-use-s3-too.html
- DynamoDB item size constraints: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Constraints.html
- Lambda can run up to 15 minutes per invocation and supports configurable memory: https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html
- Lambda timeout configuration: https://docs.aws.amazon.com/lambda/latest/dg/configuration-timeout.html
- Lambda environment variables have a total size limit of 4 KB: https://docs.aws.amazon.com/lambda/latest/dg/configuration-envvars.html
- API Gateway integration timeout details: https://docs.aws.amazon.com/apigateway/latest/api/API_UpdateIntegration.html

