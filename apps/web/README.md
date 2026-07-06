# SiteMind Crawler Frontend

A modern, cheap-to-deploy React + TypeScript frontend for a lightweight AWS crawler and AI query system.

## Stack

- Vite + React + TypeScript
- Plain CSS design system, no Tailwind required
- AWS Amplify Hosting ready
- API Gateway compatible

## Local development

```bash
npm install
cp .env.example .env
npm run dev
```

## Production build

```bash
npm run build
```

## AWS Amplify

Connect this repository to AWS Amplify Hosting. The included `amplify.yml` builds the app and publishes `dist`.

## Expected API endpoints

Set `VITE_API_BASE_URL` to your API Gateway URL.

```text
POST /crawl
GET  /sites
GET  /sites/:siteId
GET  /sites/:siteId/pages
POST /sites/:siteId/query
POST /sites/:siteId/export
```

The UI includes mock data fallback so it can run before the backend is ready.
