import { AlertCircle, Bot, CornerDownLeft, ExternalLink, Sparkles, X } from 'lucide-react';
import { useState } from 'react';
import { api } from '../lib/api';
import type { CrawlStatus, QueryResult } from '../types/domain';

type Props = {
  siteId: string;
  siteName: string;
  siteStatus: CrawlStatus;
};

export function QueryConsole({ siteId, siteName, siteStatus }: Props) {
  const [question, setQuestion] = useState('');
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const isReady = siteStatus === 'completed';

  async function ask() {
    if (!question.trim() || !isReady) return;
    setLoading(true);
    setResult(null);
    setError(null);
    try {
      const response = await api.querySite(siteId, question);
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

  function clearResult() {
    setResult(null);
    setError(null);
    setQuestion('');
  }

  return (
    <section className="panel query-console" id="query">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Ask one company</p>
          <h2>{siteName}</h2>
        </div>
        <span className="soft-badge"><Sparkles size={15} /> AI search</span>
      </div>

      {!isReady && (
        <div className="info-banner">
          <AlertCircle size={16} />
          {siteStatus === 'queued' || siteStatus === 'running'
            ? 'Crawl is still in progress — querying will be available when it completes.'
            : 'Select a fully crawled company to query its content.'}
        </div>
      )}

      <div className={`question-box${!isReady ? ' question-box--disabled' : ''}`}>
        <Bot size={20} />
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={handleKey}
          rows={3}
          placeholder="Ask anything about this company…"
          disabled={!isReady}
        />
      </div>

      <button className="primary-button" onClick={ask} disabled={loading || !isReady || !question.trim()}>
        <CornerDownLeft size={18} />
        {loading ? 'Searching…' : 'Ask'}
      </button>
      {isReady && <p className="muted-note">Ctrl + Enter to submit</p>}

      {error && (
        <div className="error-banner">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {result && (
        <div className="answer-card">
          <div className="answer-card__head">
            <p className="citations-label answer-card__label">Answer</p>
            <button className="clear-button" onClick={clearResult} title="Clear the result and reset the console">
              <X size={14} /> Clear result
            </button>
          </div>
          <p className="answer-text">{result.answer}</p>
          {result.citations.length > 0 && (
            <div className="citations">
              <p className="citations-label">Sources</p>
              {result.citations.map((c) => (
                <a key={`${c.url}-${c.heading}`} href={c.url} target="_blank" rel="noreferrer" className="citation-link">
                  <ExternalLink size={13} />
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
