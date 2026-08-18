'use client';

import { useCallback, useEffect, useState } from 'react';

function ago(iso) {
  if (!iso) return '';
  const secs = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return secs + 's ago';
  if (secs < 3600) return Math.round(secs / 60) + 'm ago';
  if (secs < 86400) return Math.round(secs / 3600) + 'h ago';
  return Math.round(secs / 86400) + 'd ago';
}

function took(run) {
  if (!run.startedAt) return '';
  const end = run.stoppedAt ? new Date(run.stoppedAt) : new Date();
  const secs = Math.round((end - new Date(run.startedAt)) / 1000);
  const m = Math.floor(secs / 60);
  return m > 0 ? m + 'm ' + (secs % 60) + 's' : secs + 's';
}

export default function Console() {
  const [runs, setRuns] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    website_url: '',
    market: 'gb',
    language: 'en',
    max_crawl_pages: 10,
    brief_doc_id: '',
  });

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/runs');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not reach n8n.');
      setRuns(data.runs);
      setError(null);
    } catch (err) {
      setError(String(err.message || err));
      setRuns([]);
    }
  }, []);

  // Poll faster while something is running, so the board feels live without
  // hammering n8n when the queue is idle.
  useEffect(() => {
    load();
    const anyRunning = (runs || []).some((r) => r.state === 'running');
    const id = setInterval(load, anyRunning ? 4000 : 15000);
    return () => clearInterval(id);
  }, [load, runs && runs.some((r) => r.state === 'running')]);

  async function start(event) {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch('/api/runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'The run did not start.');
      setNotice({ kind: 'good', text: 'Run started. It appears in the board within a few seconds.' });
      setTimeout(load, 2500);
    } catch (err) {
      setNotice({ kind: 'bad', text: String(err.message || err) });
    } finally {
      setBusy(false);
    }
  }

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  return (
    <main className="shell">
      <header className="masthead">
        <h1 className="wordmark">Content<span>/</span>Automation</h1>
        <p>Crawl a site, draft the page, publish it.</p>
      </header>

      <div className="grid">
        <section className="panel">
          <div className="panel-head"><h2>Start a run</h2></div>
          <div className="panel-body">
            {notice && <div className={'notice ' + (notice.kind === 'good' ? 'good' : 'bad')}>{notice.text}</div>}
            <form onSubmit={start}>
              <label>
                <span className="label-text">Site or page</span>
                <input
                  value={form.website_url}
                  onChange={set('website_url')}
                  placeholder="https://example.com/"
                  required
                />
              </label>
              <p className="hint">
                A bare domain optimises every page it crawls. A full URL crawls the site for the link graph
                but rewrites only that page.
              </p>
              <div className="row">
                <label>
                  <span className="label-text">Market</span>
                  <input value={form.market} onChange={set('market')} placeholder="gb" />
                </label>
                <label>
                  <span className="label-text">Language</span>
                  <input value={form.language} onChange={set('language')} placeholder="en" />
                </label>
              </div>
              <label>
                <span className="label-text">Pages to crawl</span>
                <input type="number" min="1" max="10" value={form.max_crawl_pages} onChange={set('max_crawl_pages')} />
              </label>
              <label>
                <span className="label-text">Brief doc ID</span>
                <input value={form.brief_doc_id} onChange={set('brief_doc_id')} placeholder="Leave blank for the default brief" />
              </label>
              <button type="submit" disabled={busy}>{busy ? 'Starting…' : 'Start run'}</button>
            </form>
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>Runs</h2>
            <button className="ghost" onClick={load} type="button">Refresh</button>
          </div>

          {error && <div className="panel-body"><div className="notice bad">{error}</div></div>}

          {!error && runs === null && <div className="empty">Loading the board…</div>}

          {!error && runs && runs.length === 0 && (
            <div className="empty">
              <strong>No runs yet</strong>
              Start one on the left and it will appear here.
            </div>
          )}

          {!error && runs && runs.length > 0 && (
            <ul className="runs">
              {runs.map((run) => (
                <li key={run.id}>
                  <a className="run" href={'/runs/' + run.id}>
                    <span className={'state ' + run.state}>{run.state}</span>
                    <span className="runid">
                      Run {run.id}
                      {run.mode === 'webhook' ? ' \u00b7 from the console' : run.mode === 'manual' ? ' \u00b7 started in n8n' : ''}
                    </span>
                    <span className="when">{ago(run.startedAt)}</span>
                    <span className="took">{took(run)}</span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
