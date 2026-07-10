import { AlertCircle, CornerDownLeft, ExternalLink, Library } from 'lucide-react';
import { useMemo, useState } from 'react';
import { api } from '../lib/api';
import type { QueryResult, SiteSummary } from '../types/domain';

type Props = {
  sites: SiteSummary[];
};

export function GlobalQueryConsole({ sites }: Props) {
  const [question, setQuestion] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const readySites = useMemo(
    () => sites.filter((s) => s.status === 'completed'),
    [sites]
  );
  const hasReady = readySites.length > 0;
  const allSelected = selectedIds.length === 0;

  function toggleSite(siteId: string) {
    setSelectedIds((prev) =>
      prev.includes(siteId) ? prev.filter((id) => id !== siteId) : [...prev, siteId]
    );
  }

  async function ask() {
    if (!question.trim() || !hasReady) return;
    setLoading(true);
    setResult(null);
    setError(null);
    try {
      const response = await api.queryAll(
        question,
        allSelected ? undefined : selectedIds
      );
      setResult(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Query failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) ask();
  }

  const scopeLabel = allSelected
    ? `all ${readySites.length} companies`
    : `${selectedIds.length} of ${readySites.length} companies`;

  return (
    <section className="panel query-console" id="kb">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Ask the knowledge base</p>
          <h2>All companies</h2>
        </div>
        <span className="soft-badge"><Library size={15} /> Cross-company search</span>
      </div>

      {!hasReady && (
        <div className="info-banner">
          <AlertCircle size={16} />
          Crawl at least one company to build your knowledge base.
        </div>
      )}

      {hasReady && (
        <div className="scope-chips">
          <button
            className={`scope-chip${allSelected ? ' scope-chip--active' : ''}`}
            onClick={() => setSelectedIds([])}
          >
            All companies
          </button>
          {readySites.map((site) => (
            <button
              key={site.id}
              className={`scope-chip${selectedIds.includes(site.id) ? ' scope-chip--active' : ''}`}
              onClick={() => toggleSite(site.id)}
            >
              {site.domain}
            </button>
          ))}
        </div>
      )}

      <div className={`question-box${!hasReady ? ' question-box--disabled' : ''}`}>
        <Library size={20} />
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={handleKey}
          rows={3}
          placeholder="Benchmark, compare, or spot opportunities across every company…"
          disabled={!hasReady}
        />
      </div>

      <button
        className="primary-button"
        onClick={ask}
        disabled={loading || !hasReady || !question.trim()}
      >
        <CornerDownLeft size={18} />
        {loading ? 'Searching…' : `Ask ${scopeLabel}`}
      </button>
      {hasReady && <p className="muted-note">Ctrl + Enter to submit</p>}

      {error && (
        <div className="error-banner">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {result && (
        <div className="answer-card">
          <p className="answer-text">{result.answer}</p>
          {result.citations.length > 0 && (
            <div className="citations">
              <p className="citations-label">Sources</p>
              {result.citations.map((c) => (
                <a
                  key={`${c.url}-${c.company ?? ''}`}
                  href={c.url}
                  target="_blank"
                  rel="noreferrer"
                  className="citation-link"
                >
                  <ExternalLink size={13} />
                  {c.company && <span className="citation-company">{c.company}</span>}
                  <strong>{c.pageTitle}</strong>
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
