import { ExternalLink } from 'lucide-react';
import type { SiteSummary } from '../types/domain';
import { StatusPill } from './StatusPill';

type Props = {
  sites: SiteSummary[];
  selectedSiteId: string;
  onSelect: (siteId: string) => void;
};

export function SitesList({ sites, selectedSiteId, onSelect }: Props) {
  return (
    <section className="panel sites-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Knowledge bases</p>
          <h2>Sites</h2>
        </div>
      </div>

      <div className="site-list">
        {sites.map((site) => (
          <button key={site.id} className={`site-card ${selectedSiteId === site.id ? 'site-card--active' : ''}`} onClick={() => onSelect(site.id)}>
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
          </button>
        ))}
      </div>
    </section>
  );
}
