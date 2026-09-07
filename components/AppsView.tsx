"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import AppCredential from "@/components/AppCredential";
import AppDomain from "@/components/AppDomain";
import ConfirmDialog from "@/components/ConfirmDialog";
import NewApplication from "@/components/NewApplication";
import { Select } from "@/components/Select";

type App = {
  id: string;
  label: string;
  domain: string;
  platform: string;
  platformLabel: string;
  version: string;
  stagingUrl: string;
  adminPath: string;
  staging: boolean;
  ssl: "installed" | "pending" | "none";
  adminUser: string;
  adminPassword: string;
  createdAt: string;
  serverId: string;
  serverLabel: string;
  serverIp: string;
};

type Server = {
  id: string;
  label: string;
  status: string;
  ip: string;
  cloud: string;
  region: string;
  size: string;
  apps: number;
};

type Payload = { servers: Server[]; apps: App[]; ok: boolean; note: string };

type SortKey = "name" | "platform" | "server" | "admin";

/** Which end of each column is the interesting one. */
const FIRST: Record<SortKey, "asc" | "desc"> = {
  name: "asc",
  platform: "asc",
  server: "asc",
  admin: "asc",
};

/**
 * Where the site answers.
 *
 * The domain when one is pointed at it, and the cloudwaysapps.com address
 * otherwise — an application with no domain is still running and still worth
 * being able to open, which is usually the moment you find out what it is.
 */
function home(app: App): string {
  return app.domain ? `https://${app.domain}` : app.stagingUrl;
}

function Chevrons({ state }: { state: "none" | "asc" | "desc" }) {
  return (
    <svg className={`sortmark is-${state}`} viewBox="0 0 10 14" aria-hidden>
      <path className="sortmark-up" d="M5 1.5 8.2 5.4H1.8z" />
      <path className="sortmark-down" d="M5 12.5 1.8 8.6h6.4z" />
    </svg>
  );
}

export default function AppsView() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [configError, setConfigError] = useState(false);
  const [query, setQuery] = useState("");
  const [server, setServer] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [direction, setDirection] = useState<"asc" | "desc">("asc");
  /** The application whose domain is being changed, if any. */
  const [managing, setManaging] = useState<App | null>(null);
  const [creating, setCreating] = useState(false);
  /**
   * The server whose cache is about to be cleared.
   *
   * Held as the application that was clicked, because the confirm has to
   * name how many other sites share that cache before anyone agrees to it.
   */
  const [flushing, setFlushing] = useState<App | null>(null);
  const [flushBusy, setFlushBusy] = useState(false);
  const [flushed, setFlushed] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/apps", { cache: "no-store" });
      if (response.status === 401) {
        window.location.href = "/login";
        return;
      }
      const payload = await response.json();
      if (!response.ok) {
        setConfigError(payload.kind === "config");
        throw new Error(payload.error ?? `The applications API returned ${response.status}.`);
      }
      setData(payload);
      setConfigError(false);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reach Cloudways.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function flush() {
    if (!flushing) return;
    setFlushBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/apps/cache", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ serverId: flushing.serverId }),
      });
      if (response.status === 401) {
        window.location.href = "/login";
        return;
      }
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? `The purge returned ${response.status}.`);
      setFlushed(`Varnish cleared on ${payload.serverLabel}.`);
      setFlushing(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The cache could not be cleared.");
      setFlushing(null);
    } finally {
      setFlushBusy(false);
    }
  }

  function sortBy(key: SortKey) {
    if (key === sortKey) setDirection((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setDirection(FIRST[key]);
    }
  }

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const rows = (data?.apps ?? []).filter((a) => {
      if (server && a.serverId !== server) return false;
      if (!needle) return true;
      // The label and the domain routinely differ, and people search for
      // whichever one they happen to remember.
      return (
        a.domain.includes(needle) ||
        a.label.toLowerCase().includes(needle) ||
        a.platformLabel.toLowerCase().includes(needle)
      );
    });

    const flip = direction === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const name = (x: App) => x.domain || x.label;
      if (sortKey === "name") return name(a).localeCompare(name(b)) * flip;
      if (sortKey === "platform") {
        return (
          a.platformLabel.localeCompare(b.platformLabel) * flip ||
          name(a).localeCompare(name(b))
        );
      }
      if (sortKey === "server") {
        return a.serverLabel.localeCompare(b.serverLabel) * flip || name(a).localeCompare(name(b));
      }
      return a.adminUser.localeCompare(b.adminUser) * flip || name(a).localeCompare(name(b));
    });
  }, [data, query, server, sortKey, direction]);

  // Over the whole account rather than over what the filters left: these are
  // facts about the estate and should not move as you type.
  const totals = useMemo(() => {
    const rows = data?.apps ?? [];
    return {
      apps: rows.length,
      servers: data?.servers.length ?? 0,
      // The one worth opening this page for. An application nobody pointed a
      // domain at is either unfinished or forgotten, and both are money.
      homeless: rows.filter((a) => !a.domain && !a.staging).length,
      staging: rows.filter((a) => a.staging).length,
    };
  }, [data]);

  const serverOptions = useMemo(
    () => [
      { value: "", label: "All servers" },
      ...(data?.servers ?? []).map((s) => ({
        value: s.id,
        label: s.label,
        hint: `${s.apps}`,
      })),
    ],
    [data],
  );

  return (
    <div className="stack">
      <div className="card">
        <div className="card-head">
          <div>
            <h2>Applications</h2>
          </div>
          <div className="app-head-actions">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => void load()}
              disabled={loading}
            >
              {loading ? "Reading…" : "Refresh"}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setCreating(true)}
            >
              New application
            </button>
          </div>
        </div>

        <div className="card-body tight">
          {error ? (
            <div className="notice bad">
              {error}
              {configError ? (
                <>
                  {" "}
                  <a href="/keys">Open the Keys page</a> to fix it.
                </>
              ) : null}
            </div>
          ) : null}

          {flushed ? (
            <div className="notice ok">
              {flushed} Every site on it serves from the origin until the
              cache refills.{" "}
              <button type="button" className="btn-link" onClick={() => setFlushed(null)}>
                Dismiss
              </button>
            </div>
          ) : null}

          {loading && !data ? <p className="quiet">Reading Cloudways…</p> : null}

          {data && !data.apps.length && !error ? (
            <div className="notice warn">
              <strong>This Cloudways account hosts no applications.</strong> The
              token worked and the account came back empty, so there is nothing
              to show rather than something we could not read.
            </div>
          ) : null}

          {data && data.apps.length ? (
            <>
              <div className="domain-stats">
                <div className="domain-stat">
                  <span className="domain-stat-value">{totals.apps}</span>
                  <span className="domain-stat-label">applications</span>
                </div>
                <div className="domain-stat">
                  <span className="domain-stat-value">{totals.servers}</span>
                  <span className="domain-stat-label">servers</span>
                </div>
                <div className={totals.homeless ? "domain-stat is-warn" : "domain-stat"}>
                  <span className="domain-stat-value">{totals.homeless}</span>
                  <span className="domain-stat-label">with no domain</span>
                </div>
                <div className="domain-stat">
                  <span className="domain-stat-value">{totals.staging}</span>
                  <span className="domain-stat-label">staging copies</span>
                </div>
              </div>

              <div className="domain-bar">
                <input
                  type="search"
                  className="domain-search"
                  placeholder="Filter by domain, name or platform"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <div className="app-server-filter">
                  <Select
                    id="apps-server"
                    value={server}
                    options={serverOptions}
                    onChange={setServer}
                  />
                </div>
                <span className="domain-counts">
                  <span className="domain-count">
                    <strong>{shown.length}</strong> shown
                  </span>
                </span>
              </div>

              <table className="logs logs-middle">
                <thead>
                  <tr>
                    {(
                      [
                        ["name", "Application", ""],
                        ["platform", "Platform", "mid"],
                        ["server", "Server", "mid"],
                        ["admin", "Admin login", "mid cred-cell"],
                      ] as Array<[SortKey, string, string]>
                    ).map(([key, label, align]) => (
                      <th key={key} className={align ? `${align} sortable` : "sortable"}>
                        <button type="button" onClick={() => sortBy(key)}>
                          {label}
                          <Chevrons state={sortKey === key ? direction : "none"} />
                        </button>
                      </th>
                    ))}
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {shown.map((a) => (
                    <tr key={a.id}>
                      <td>
                        <div className="app-name">
                          <a
                            className="domain-name"
                            href={home(a)}
                            target="_blank"
                            rel="noreferrer noopener"
                          >
                            {a.domain || a.label}
                          </a>
                          {a.staging ? <span className="pill pill-idle">staging</span> : null}
                        </div>
                        {/* The Cloudways name, when it is not simply the
                            domain again. It is what the dashboard calls this
                            application, so it is how you find it there. */}
                        {a.domain && a.label.toLowerCase() !== a.domain ? (
                          <div className="app-sub">{a.label}</div>
                        ) : null}
                      </td>
                      <td className="mid">
                        {a.platformLabel}
                        {a.version ? <span className="app-sub-inline">{a.version}</span> : null}
                      </td>
                      <td className="mid">
                        <span className="registrar">{a.serverLabel}</span>
                        <div className="app-sub">{a.serverIp}</div>
                      </td>
                      <td className="mid cred-cell">
                        <AppCredential user={a.adminUser} password={a.adminPassword} />
                      </td>
                      <td className="detail">
                        <div className="app-links">
                          {!a.domain && !a.staging ? (
                            <span className="pill pill-warn" title="Nothing is pointed at this application yet.">
                              no domain
                            </span>
                          ) : null}
                          {/* Shown when it is there, never as a complaint when
                              it is not. A missing Cloudways certificate is the
                              normal state of a site behind Cloudflare, and a
                              red badge on nine rows in ten would train everyone
                              to ignore the column. */}
                          {a.ssl === "installed" ? (
                            <span
                              className="registrar"
                              title="Cloudways holds a certificate for this application."
                            >
                              SSL
                            </span>
                          ) : null}
                          {/* An anchor rather than a button, because it goes
                              somewhere and should middle-click and open in a
                              new tab like any other link. The button styles
                              share their declaration block with bare buttons,
                              so it stands the same height as Modify beside
                              it. */}
                          {a.adminPath ? (
                            <a
                              className="btn btn-ghost btn-sm"
                              href={`${home(a)}${a.adminPath}`}
                              target="_blank"
                              rel="noreferrer noopener"
                            >
                              Go To Admin
                            </a>
                          ) : null}
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => setManaging(a)}
                          >
                            Modify
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            title={`Clear the Varnish cache on ${a.serverLabel}`}
                            onClick={() => setFlushing(a)}
                          >
                            Flush cache
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <p className="domain-note">
                Every application on every server this Cloudways token can see.
                The name links to the domain when one is pointed at it, and to
                the cloudwaysapps.com address otherwise. An{" "}
                <strong>SSL</strong> mark means Cloudways holds a certificate
                for that application; most of these sit behind Cloudflare, which
                does its own, so no mark does not mean no padlock. Cloudways
                returns four passwords per application; only the admin login
                is kept, and the server, database and Redis passwords are
                dropped before anything reaches your browser. The admin
                password is what Cloudways set at install, so it will be out
                of date if someone has changed it inside the site since.
              </p>
            </>
          ) : null}
        </div>
      </div>

      <ConfirmDialog
        open={!!flushing}
        title="Clear the Varnish cache"
        body={
          <>
            {/* The count is the point. Cloudways purges by server, so a
                button on one row clears the cache for every site beside
                it, and nobody should find that out afterwards. */}
            Cloudways clears Varnish for a whole server, so this affects all{" "}
            <strong>
              {data?.servers.find((s) => s.id === flushing?.serverId)?.apps ?? 0}
            </strong>{" "}
            applications on <strong>{flushing?.serverLabel}</strong>, not just{" "}
            {flushing?.domain || flushing?.label}. They will serve from the
            origin until the cache refills, which costs a minute of slower
            pages and nothing else.
          </>
        }
        confirmLabel="Clear it"
        busyLabel="Clearing…"
        cancelLabel="Cancel"
        busy={flushBusy}
        onConfirm={() => void flush()}
        onDismiss={() => setFlushing(null)}
      />

      {creating ? (
        <NewApplication
          onClose={() => setCreating(false)}
          onDone={() => {
            setCreating(false);
            // The new one belongs in the table, and it is sorted by name
            // rather than appended, so the whole list is read again.
            void load();
          }}
        />
      ) : null}

      {managing ? (
        <AppDomain
          app={managing}
          onClose={() => setManaging(null)}
          onDone={() => {
            setManaging(null);
            // The domain moved, and it is the first column on this page.
            void load();
          }}
        />
      ) : null}
    </div>
  );
}
