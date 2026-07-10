import { Activity, Database, FileText, Globe } from 'lucide-react';
import type { SiteSummary } from '../types/domain';
import { MetricCard } from './MetricCard';

export function AnalyticsPanel({ sites }: { sites: SiteSummary[] }) {
  const pages = sites.reduce((sum, s) => sum + s.pages, 0);
  const chunks = sites.reduce((sum, s) => sum + s.chunks, 0);
  const sizeKb = sites.reduce((sum, s) => sum + s.markdownSizeKb, 0);
  const sitesReady = sites.filter((s) => s.status === 'completed').length;

  return (
    <section className="analytics-grid">
      <MetricCard label="Companies indexed" value={String(sitesReady)} change={`${sites.length} total`} icon={Globe} />
      <MetricCard label="Pages crawled" value={String(pages)} change="across all companies" icon={FileText} tone="good" />
      <MetricCard label="Chunks indexed" value={String(chunks)} change="ready to query" icon={Database} />
      <MetricCard label="Content stored" value={`${(sizeKb / 1024).toFixed(1)} MB`} change="Markdown + index" icon={Activity} />
    </section>
  );
}
