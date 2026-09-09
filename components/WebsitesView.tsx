"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Select } from "@/components/Select";
import { SkeletonTable } from "@/components/Skeleton";

type Website = {
  id: string;
  name: string;
  tagline: string;
  description: string;
  topic: string;
  keywords: string[];
  format: "wordpress" | "static";
  language: string;
  status: "building" | "ready" | "failed";
  runId: string;
  wanted: number;
  note: string;
  pages: Array<{ slug: string; title: string }>;
  createdAt: string;
  createdBy: string;
};

const STATUS: Record<Website["status"], { label: string; tone: string }> = {
  building: { label: "writing", tone: "run" },
  ready: { label: "ready", tone: "ok" },
  failed: { label: "nothing written", tone: "bad" },
};

/**
 * Websites this platform wrote.
 *
 * A site here has no domain and no host: it is prose waiting to be read,
 * corrected and then put somewhere. The list says which are still being
 * written, because a build takes a call per page and a page takes a while.
 *
 * It reloads itself while anything is still building, and stops the moment
 * nothing is. A page that polls forever is a page that keeps a laptop warm all
 * afternoon for news that came an hour ago.
 */
export default function WebsitesView() {
  const [sites, setSites] = useState<Website[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [open, setOpen] = useState(false);
  const [brief, setBrief] = useState("");
  const [topic, setTopic] = useState("");
  const [keywords, setKeywords] = useState("");
  const [name, setName] = useState("");
  const [format, setFormat] = useState<"wordpress" | "static">("wordpress");
  const [pageCount, setPageCount] = useState("5");
  const [primaryKeyword, setPrimaryKeyword] = useState("");
  const [market, setMarket] = useState("gb");
  const [referenceUrl, setReferenceUrl] = useState("");
  /**
   * Standing instructions for every page of this site.
   *
   * Remembered in the browser, because a house style is written once and used
   * on every site after it. Not on the server: it is a preference of whoever
   * is building, not a fact about the estate.
   */
  const [houseRules, setHouseRules] = useState("");
  const [showRules, setShowRules] = useState(false);
  const [busy, setBusy] = useState(false);
  /** The site a row action is working on, so only its buttons go quiet. */
  const [acting, setActing] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/websites", { cache: "no-store" });
      if (response.status === 401) {
        window.location.href = "/login";
        return;
      }
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? `The websites API returned ${response.status}.`);
      setSites(payload.websites ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The websites could not be read.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Read once on mount. A blocked or empty store just means an empty box.
  useEffect(() => {
    try {
      setHouseRules(localStorage.getItem("ca:houseRules") ?? "");
    } catch {
      /* private windows throw here, and an empty box is a fine answer */
    }
  }, []);

  const building = useMemo(
    () => (sites ?? []).some((s) => s.status === "building"),
    [sites],
  );

  useEffect(() => {
    if (!building) return;
    const timer = setInterval(() => void load(), 15_000);
    return () => clearInterval(timer);
  }, [building, load]);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/websites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          brief,
          topic,
          keywords,
          name,
          format,
          pageCount: Number(pageCount) || 5,
          primaryKeyword,
          market,
          houseRules,
          referenceUrl,
        }),
      });
      if (response.status === 401) {
        window.location.href = "/login";
        return;
      }
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? `The build returned ${response.status}.`);

      // Kept for the next site, since a house style is written once.
      try {
        localStorage.setItem("ca:houseRules", houseRules);
      } catch {
        /* it just will not be remembered */
      }

      setOpen(false);
      setBrief("");
      setTopic("");
      setKeywords("");
      setName("");
      setReferenceUrl("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The website could not be started.");
    } finally {
      setBusy(false);
    }
  }

  /**
   * Stop a build, or throw a site away.
   *
   * Stopping keeps whatever was written: three pages of five is three real
   * pages, and discarding them because the fourth never came would throw away
   * work that was paid for. Deleting is the one that loses the writing, so it
   * asks first.
   */
  async function act(site: Website, what: "stop" | "delete") {
    if (what === "delete") {
      const sure = window.confirm(
        `Delete ${site.name}? Its ${site.pages.length} page(s) go with it and ` +
          "nothing here can bring them back.",
      );
      if (!sure) return;
    }

    setActing(site.id);
    setError(null);
    try {
      const response = await fetch(
        what === "stop" ? `/api/websites/${site.id}/stop` : `/api/websites/${site.id}`,
        { method: what === "stop" ? "POST" : "DELETE" },
      );
      if (response.status === 401) {
        window.location.href = "/login";
        return;
      }
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? `That returned ${response.status}.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That could not be done.");
    } finally {
      setActing(null);
    }
  }

  const ready = brief.trim().length > 10 && topic.trim().length > 1;

  return (
    <div className="stack">
      <div className="card">
        <div className="card-head">
          <div>
            <h2>Websites</h2>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? "Cancel" : "Create with AI"}
          </button>
        </div>

        <div className="card-body tight">
          {error ? <div className="notice bad">{error}</div> : null}

          {open ? (
            <section className="sheet-section">
              <h3>What should it be?</h3>
              <p className="stage-hint">
                The more specific the brief, the less generic the writing. Say
                who it is for and what it should get them to do, not just what
                the subject is.
              </p>

              <label className="field-label" htmlFor="site-brief">
                What the site is for
              </label>
              <textarea
                id="site-brief"
                rows={4}
                value={brief}
                placeholder="A shop selling handmade unscented candles to people who find scented ones overpowering. It should explain why unscented is a choice rather than a compromise, and get people to the product pages."
                onChange={(e) => setBrief(e.target.value)}
              />

              <label className="field-label" htmlFor="site-topic">
                What it is about
              </label>
              <input
                id="site-topic"
                type="text"
                value={topic}
                placeholder="unscented handmade candles"
                onChange={(e) => setTopic(e.target.value)}
              />

              <label className="field-label" htmlFor="site-primary">
                The one keyword it is built around
              </label>
              <input
                id="site-primary"
                type="text"
                value={primaryKeyword}
                placeholder="unscented candles uk"
                onChange={(e) => setPrimaryKeyword(e.target.value)}
              />
              <p className="provider-hint">
                The front page is built for this one. Left blank, the plan picks
                one out of the list below, which is a different keyword every
                run.
              </p>

              <label className="field-label" htmlFor="site-keywords">
                Other keywords to rank for
              </label>
              <textarea
                id="site-keywords"
                rows={2}
                value={keywords}
                placeholder="unscented candles, fragrance free candles, candles for sensitive noses"
                onChange={(e) => setKeywords(e.target.value)}
              />
              <p className="provider-hint">
                One per line or separated by commas. They are spread across the
                pages rather than crammed into one.
              </p>

              <label className="field-label" htmlFor="site-reference">
                Design reference (optional)
              </label>
              <input
                id="site-reference"
                type="text"
                value={referenceUrl}
                placeholder="https://a-site-you-like.com"
                onChange={(e) => setReferenceUrl(e.target.value)}
              />
              <p className="provider-hint">
                A site to take the shape of. It is read for its arrangement and
                its colours, never its words: the headings and section shapes go
                to the builder, the prose is thrown away before it gets there. A
                page that will not load is skipped rather than failing the build.
              </p>

              <div className="site-row">
                <div>
                  <label className="field-label" htmlFor="site-name">
                    Name it (optional)
                  </label>
                  <input
                    id="site-name"
                    type="text"
                    value={name}
                    placeholder="left blank, the plan chooses one"
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>
                <div>
                  <label className="field-label" htmlFor="site-format">
                    Built as
                  </label>
                  <Select
                    id="site-format"
                    value={format}
                    onChange={(v) => setFormat(v as "wordpress" | "static")}
                    options={[
                      { value: "wordpress", label: "WordPress", hint: "theme supplies the shell" },
                      { value: "static", label: "Static HTML", hint: "carries its own shell" },
                    ]}
                  />
                </div>
                <div>
                  <label className="field-label" htmlFor="site-market">
                    Market
                  </label>
                  <input
                    id="site-market"
                    type="text"
                    value={market}
                    placeholder="gb"
                    onChange={(e) => setMarket(e.target.value)}
                  />
                </div>
                <div>
                  <label className="field-label" htmlFor="site-pages">
                    Pages
                  </label>
                  <Select
                    id="site-pages"
                    value={pageCount}
                    onChange={setPageCount}
                    options={["1", "3", "5", "8", "12", "20"].map((n) => ({
                      value: n,
                      label: n === "1" ? "One page" : `${n} pages`,
                      hint: n === "1" ? "everything on the front page" : undefined,
                    }))}
                  />
                </div>
              </div>

              <p className="provider-hint">
                The format decides what gets written, not just where it goes. A
                WordPress theme supplies the header, navigation and footer, so
                those are left out; a static site has to carry its own.
              </p>

              <div className="editor-body-head">
                <span className="field-label">House rules</span>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setShowRules((v) => !v)}
                >
                  {showRules ? "Hide" : houseRules ? "Edit" : "Add"}
                </button>
              </div>
              {showRules ? (
                <>
                  <textarea
                    rows={8}
                    value={houseRules}
                    placeholder={
                      "Standing instructions for every page. What must always be said, " +
                      "what must never be claimed, the house style.\n\n" +
                      "Example: state the 18+ age restriction wherever the page discusses " +
                      "signing up. Link a gambling help service at most once on the whole " +
                      "page. Never promise guaranteed wins or risk free bets. Point every " +
                      "call to action at AFF_LINK."
                    }
                    onChange={(e) => setHouseRules(e.target.value)}
                  />
                  <p className="provider-hint">
                    These sit above the brief and override it. Remembered in
                    this browser for the next site, because a house style is
                    written once and used every time.
                  </p>
                </>
              ) : houseRules ? (
                <p className="provider-hint">
                  {houseRules.length} characters of standing instructions will
                  be applied.
                </p>
              ) : (
                <p className="provider-hint">
                  Nothing standing. Add rules here for anything that must be
                  true of every page: a regulated niche&rsquo;s wording, an
                  affiliate link placeholder, your house style.
                </p>
              )}

              <div className="sheet-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => void create()}
                  disabled={!ready || busy}
                >
                  {busy ? "Starting…" : "Write it"}
                </button>
              </div>
              <p className="provider-hint">
                It plans the site first, then writes a page at a time. Expect a
                few minutes. You can leave this page and come back.
              </p>
            </section>
          ) : null}

          {loading && !sites ? <SkeletonTable columns={5} rows={4} /> : null}

          {sites && !sites.length && !loading ? (
            <div className="empty">
              No websites yet. Create one and it appears here to edit.
            </div>
          ) : null}

          {sites && sites.length ? (
            <table className="logs logs-middle">
              <thead>
                <tr>
                  <th>Website</th>
                  <th className="mid">Built as</th>
                  <th className="mid">Pages</th>
                  <th className="mid">Status</th>
                  <th className="act-head">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sites.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <Link className="domain-name" href={`/websites/${s.id}`}>
                        {s.name}
                      </Link>
                      <div className="app-sub">{s.tagline || s.topic}</div>
                    </td>
                    <td className="mid">
                      <span className="registrar">
                        {s.format === "wordpress" ? "WordPress" : "Static HTML"}
                      </span>
                    </td>
                    <td className="mid">
                      {/* A fraction while it is being written, because the
                          number alone cannot tell working from stuck. */}
                      {s.status === "building" && s.wanted
                        ? `${s.pages.length} of ${s.wanted}`
                        : s.pages.length}
                    </td>
                    <td className="mid">
                      <span
                        className={`pill pill-${STATUS[s.status].tone}`}
                        title={s.note || undefined}
                      >
                        {STATUS[s.status].label}
                      </span>
                    </td>
                    <td className="detail">
                      <div className="app-links">
                        {s.runId ? (
                          <Link className="btn btn-ghost btn-sm" href={`/runs?run=${s.runId}`}>
                            Run log
                          </Link>
                        ) : null}
                        {s.status === "building" ? (
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => void act(s, "stop")}
                            disabled={acting === s.id}
                            title="Stop writing. The pages already written are kept."
                          >
                            {acting === s.id ? "Stopping…" : "Stop"}
                          </button>
                        ) : (
                          <Link className="btn btn-ghost btn-sm" href={`/websites/${s.id}`}>
                            Edit
                          </Link>
                        )}
                        <button
                          type="button"
                          className="btn btn-danger btn-sm"
                          onClick={() => void act(s, "delete")}
                          disabled={acting === s.id}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}

          {sites && sites.length ? (
            <p className="domain-note">
              None of these is hosted. They are pages waiting to be read and
              corrected, and where each one lives is a decision still to be
              made. A website still being written updates itself here every few
              seconds.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
