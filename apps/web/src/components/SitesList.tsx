import { AlertCircle, ExternalLink, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { SiteSummary } from '../types/domain';
import { StatusPill } from './StatusPill';

type Props = {
  sites: SiteSummary[];
  selectedSiteId: string;
  onSelect: (siteId: string) => void;
  onDelete: (siteId: string) => Promise<void>;
};

export function SitesList({ sites, selectedSiteId, onSelect, onDelete }: Props) {
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete(site: SiteSummary) {
    const confirmed = window.confirm(
      `Remove ${site.domain} from the knowledge base?\n\nThis deletes all of its crawled pages, chunks, and history.`
    );
    if (!confirmed) return;

    setDeletingId(site.id);
    setError(null);
    try {
      await onDelete(site.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to delete ${site.domain}.`);
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <section className="panel sites-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Knowledge base</p>
          <h2>Companies</h2>
        </div>
      </div>

      {error && (
        <div className="error-banner">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      <div className="site-list">
        {sites.map((site) => {
          const crawling = site.status === 'queued' || site.status === 'running';
          const deleting = deletingId === site.id;
          return (
            <div
              key={site.id}
              role="button"
              tabIndex={0}
              className={`site-card ${selectedSiteId === site.id ? 'site-card--active' : ''}${deleting ? ' site-card--deleting' : ''}`}
              onClick={() => onSelect(site.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelect(site.id);
                }
              }}
            >
              <button
                className="site-card__delete"
                title={crawling ? 'Wait for the crawl to finish before deleting' : `Delete ${site.domain}`}
                aria-label={`Delete ${site.domain}`}
                disabled={crawling || deleting}
                onClick={(e) => {
                  e.stopPropagation();
                  void handleDelete(site);
                }}
              >
                <Trash2 size={15} />
              </button>
              <div>
                <strong>{site.name}</strong>
                <span>{site.domain}</span>
              </div>
              <StatusPill status={site.status} />
              <div className="site-card__stats">
                <span>{site.pages} pages</span>
                <span>{site.chunks} chunks</span>
                <span>{site.indexedPercent}% indexed</span>
              </div>
              <small><ExternalLink size={13} /> {site.seedUrl}</small>
            </div>
          );
        })}
      </div>
    </section>
  );
}
