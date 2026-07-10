import { BrainCircuit, Globe, LayoutDashboard, Library, MessageSquare, Workflow } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnalyticsPanel } from './components/AnalyticsPanel';
import { CrawlLauncher } from './components/CrawlLauncher';
import { GlobalQueryConsole } from './components/GlobalQueryConsole';
import { PagesTable } from './components/PagesTable';
import { QueryConsole } from './components/QueryConsole';
import { SitesList } from './components/SitesList';
import { WorkflowTimeline } from './components/WorkflowTimeline';
import { api } from './lib/api';
import type { PageRecord, SiteSummary } from './types/domain';

const POLL_INTERVAL_MS = 4_000;
const ACTIVE_STATUSES = new Set<SiteSummary['status']>(['queued', 'running']);

function App() {
  const [sites, setSites] = useState<SiteSummary[]>([]);
  const [pages, setPages] = useState<PageRecord[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState('');
  const [loading, setLoading] = useState(true);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    api.getSites()
      .then((list) => {
        setSites(list);
        setSelectedSiteId(list[0]?.id ?? '');
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selectedSiteId) return;
    void api.getPages(selectedSiteId).then(setPages);
  }, [selectedSiteId]);

  const schedulePoll = useCallback((siteList: SiteSummary[]) => {
    const active = siteList.filter((s) => ACTIVE_STATUSES.has(s.status) && s.activeJobId);
    if (active.length === 0) return;

    pollTimerRef.current = setTimeout(async () => {
      const updates = await Promise.allSettled(
        active.map(async (s) => {
          const job = await api.pollJob(s.id, s.activeJobId!);
          if (job.status === 'READY' || job.status === 'FAILED' || job.status === 'CANCELLED') {
            return api.getSite(s.id);
          }
          const next: SiteSummary = {
            ...s,
            status: job.status === 'RUNNING' || job.status === 'CHECKPOINTED' ? 'running' : s.status,
            pages: job.pagesCrawled,
            indexedPercent: Math.round((job.pagesCrawled / Math.max(job.pagesCrawled + job.pagesSkipped, 1)) * 100),
          };
          return next;
        })
      );

      setSites((prev) => {
        const map = new Map(prev.map((s) => [s.id, s]));
        for (const result of updates) {
          if (result.status === 'fulfilled') {
            const updated = result.value;
            map.set(updated.id, { ...(map.get(updated.id) ?? updated), ...updated });
          }
        }
        const next = [...map.values()];
        schedulePoll(next);
        return next;
      });
    }, POLL_INTERVAL_MS);
  }, []);

  useEffect(() => {
    schedulePoll(sites);
    return () => { if (pollTimerRef.current) clearTimeout(pollTimerRef.current); };
  }, [sites, schedulePoll]);

  const selectedSite = useMemo(
    () => sites.find((s) => s.id === selectedSiteId) ?? sites[0],
    [sites, selectedSiteId]
  );

  function handleCreated(site: SiteSummary) {
    setSites((prev) => [site, ...prev]);
    setSelectedSiteId(site.id);
  }

  function handleSelect(siteId: string) {
    setSelectedSiteId(siteId);
    setPages([]);
    void api.getPages(siteId).then(setPages);
  }

  async function handleDelete(siteId: string) {
    await api.deleteSite(siteId);
    const next = sites.filter((s) => s.id !== siteId);
    setSites(next);
    if (selectedSiteId === siteId) {
      const fallback = next[0]?.id ?? '';
      setSelectedSiteId(fallback);
      setPages([]);
      if (fallback) void api.getPages(fallback).then(setPages);
    }
  }

  if (loading) {
    return (
      <main className="loading-screen">
        <div className="orb" />
        <h1>SiteMind</h1>
        <p>Loading your workspace…</p>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <div className="brand-mark"><BrainCircuit size={22} /></div>
          <div>
            <strong>SiteMind</strong>
            <span>Web intelligence</span>
          </div>
        </div>

        <nav className="nav-stack">
          <a className="nav-item" href="#dashboard" onClick={(e) => { e.preventDefault(); document.getElementById('dashboard')?.scrollIntoView({ behavior: 'smooth' }); }}>
            <LayoutDashboard size={17} /> Overview
          </a>
          <a className="nav-item" href="#crawl" onClick={(e) => { e.preventDefault(); document.getElementById('crawl')?.scrollIntoView({ behavior: 'smooth' }); }}>
            <Globe size={17} /> Crawl
          </a>
          <a className="nav-item" href="#kb" onClick={(e) => { e.preventDefault(); document.getElementById('kb')?.scrollIntoView({ behavior: 'smooth' }); }}>
            <Library size={17} /> Knowledge base
          </a>
          <a className="nav-item" href="#query" onClick={(e) => { e.preventDefault(); document.getElementById('query')?.scrollIntoView({ behavior: 'smooth' }); }}>
            <MessageSquare size={17} /> Query
          </a>
          <a className="nav-item" href="#workflow" onClick={(e) => { e.preventDefault(); document.getElementById('workflow')?.scrollIntoView({ behavior: 'smooth' }); }}>
            <Workflow size={17} /> Pipeline
          </a>
        </nav>
      </aside>

      <main className="main-area">
        <header className="hero" id="dashboard">
          <div>
            <p className="eyebrow">Company intelligence</p>
            <h1>Turn company websites into a knowledge base you can query.</h1>
            <p>Crawl any company's website, then ask questions across your whole collection — benchmark against your own, spot partnership fits, and track competitors. Drop a company the moment it stops being relevant.</p>
          </div>
        </header>

        <AnalyticsPanel sites={sites} />

        <section className="content-grid">
          <CrawlLauncher onCreated={handleCreated} />
          <SitesList
            sites={sites}
            selectedSiteId={selectedSiteId}
            onSelect={handleSelect}
            onDelete={handleDelete}
          />
          <GlobalQueryConsole sites={sites} />
          {selectedSite ? (
            <QueryConsole
              siteId={selectedSite.id}
              siteName={selectedSite.domain}
              siteStatus={selectedSite.status}
            />
          ) : (
            <section className="panel query-console">
              <p className="muted-note">Add a company to start querying.</p>
            </section>
          )}
          <WorkflowTimeline />
        </section>

        {selectedSite && (
          <PagesTable
            siteId={selectedSite.id}
            pages={pages.filter((p) => p.siteId === selectedSite.id)}
          />
        )}
      </main>
    </div>
  );
}

export default App;
