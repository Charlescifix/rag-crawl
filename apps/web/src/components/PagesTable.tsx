import { ExternalLink, FileDown, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { api } from '../lib/api';
import type { PageRecord } from '../types/domain';
import { StatusPill } from './StatusPill';

type Props = {
  siteId: string;
  pages: PageRecord[];
};

export function PagesTable({ siteId, pages }: Props) {
  const [query, setQuery] = useState('');
  const [exporting, setExporting] = useState(false);

  const filtered = useMemo(
    () => pages.filter((p) => `${p.title} ${p.url}`.toLowerCase().includes(query.toLowerCase())),
    [pages, query]
  );

  async function exportMarkdown() {
    setExporting(true);
    try {
      const result = await api.exportMarkdown(siteId);
      window.open(result.url, '_blank', 'noreferrer');
    } catch {
      alert('Export failed — please try again.');
    } finally {
      setExporting(false);
    }
  }

  return (
    <section className="panel table-panel" id="pages">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Content</p>
          <h2>Pages</h2>
        </div>
        <button className="ghost-button" onClick={exportMarkdown} disabled={exporting}>
          <FileDown size={17} /> {exporting ? 'Preparing…' : 'Export Markdown'}
        </button>
      </div>

      <div className="input-shell search-shell">
        <Search size={17} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by title or URL"
        />
      </div>

      {filtered.length === 0 ? (
        <p className="muted-note">No pages match your filter.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Page</th>
                <th>Status</th>
                <th>Words</th>
                <th>Chunks</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((page) => (
                <tr key={page.id}>
                  <td>
                    <a href={page.url} target="_blank" rel="noreferrer" className="page-link">
                      <strong>{page.title}</strong>
                      <span><ExternalLink size={12} /> {page.url}</span>
                    </a>
                  </td>
                  <td><StatusPill status={page.status} /></td>
                  <td>{page.words.toLocaleString()}</td>
                  <td>{page.chunks}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
