import type { CrawlStatus, PageRecord } from '../types/domain';

type Status = CrawlStatus | PageRecord['status'];

export function StatusPill({ status }: { status: Status }) {
  return <span className={`status-pill status-pill--${status}`}>{status}</span>;
}
