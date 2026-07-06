import { Globe2, Play, ShieldCheck, Zap } from 'lucide-react';
import { useState } from 'react';
import { api } from '../lib/api';
import type { CrawlRequest, SiteSummary } from '../types/domain';

type Props = {
  onCreated: (site: SiteSummary) => void;
};

export function CrawlLauncher({ onCreated }: Props) {
  const [seedUrl, setSeedUrl] = useState('');
  const [maxPages, setMaxPages] = useState(100);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function submit() {
    if (!seedUrl.trim()) return;
    setLoading(true);
    setMessage('');
    setError('');

    const payload: CrawlRequest = {
      seedUrl: seedUrl.trim(),
      maxPages,
      respectRobotsTxt: true,
      sameDomainOnly: true,
      renderJavascript: false,
    };

    try {
      const site = await api.startCrawl(payload);
      onCreated(site);
      setMessage('Crawl started — it will appear in your sites list.');
      setSeedUrl('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start crawl.');
    } finally {
      setLoading(false);
    }
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter') submit();
  }

  return (
    <section className="panel crawl-launcher" id="crawl">
      <div className="section-heading">
        <div>
          <p className="eyebrow">New crawl</p>
          <h2>Add a website</h2>
        </div>
        <span className="soft-badge"><ShieldCheck size={15} /> robots.txt</span>
      </div>

      <div className="field-row">
        <label className="field field--grow">
          <span>Website URL</span>
          <div className="input-shell">
            <Globe2 size={18} />
            <input
              value={seedUrl}
              onChange={(e) => setSeedUrl(e.target.value)}
              onKeyDown={handleKey}
              placeholder="https://docs.yoursite.com"
            />
          </div>
        </label>

        <label className="field">
          <span>Page limit — <strong>{maxPages} pages</strong></span>
          <input
            className="range-input"
            type="range"
            min="10"
            max="500"
            step="10"
            value={maxPages}
            onChange={(e) => setMaxPages(Number(e.target.value))}
          />
          <div className="range-row"><span>10</span><span>500</span></div>
        </label>

        <button className="primary-button field--auto" disabled={loading || !seedUrl.trim()} onClick={submit}>
          <Play size={18} /> {loading ? 'Starting…' : 'Start crawl'}
        </button>
      </div>

      <div className="workflow-strip">
        <div><Zap size={14} /> Fetch</div>
        <div>Extract</div>
        <div>Markdown</div>
        <div>Index</div>
      </div>

      {message && <p className="muted-note success-note">{message}</p>}
      {error && <p className="muted-note error-note">{error}</p>}
    </section>
  );
}
