"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import AppCredential from "@/components/AppCredential";
import AppDomain from "@/components/AppDomain";
import ConfirmDialog from "@/components/ConfirmDialog";
import NewApplication from "@/components/NewApplication";
import { Select } from "@/components/Select";
import { HOSTS, type HostId } from "@/lib/hosts";
import { SkeletonTable } from "@/components/Skeleton";

type App = {
  host: HostId;
  key: string;
  id: string;
  label: string;
  domain: string;
  platform: string;
  platformLabel: string;
  version: string;
  stagingUrl: string;
  adminPath: string;
  staging: boolean;
  ssl: "installed" | "pending" | "none" | "unknown";
  adminUser: string;
  adminPassword: string;
  createdAt: string;
  enabled: boolean;
  placeId: string;
  placeLabel: string;
  placeAddress: string;
  accountIndex: number;
};

/** A server on Cloudways, a hosting account on Hostinger. */
type Place = {
  id: string;
  label: string;
  host: HostId;
  hostLabel: string;
  apps: number;
};

type Source = {
  host: HostId;
  label: string;
  ok: boolean;
  count: number;
  note: string;
};

type Payload = {
  apps: App[];
  places: Place[];
  sources: Source[];
  connected: HostId[];
};

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

/**
 * How many rows to draw before asking.
 *
 * Fifty, matching the Domains and Logs tables. The cost here is not the markup
 * so much as what hangs off each row: a credential with state of its own and
 * three controls, times every application on the account.
 */
const PAGE = 50;

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
  const [visible, setVisible] = useState(PAGE);
  /** The application whose domain is being changed, if any. */
  const [managing, setManaging] = useState<App | null>(null);
  const [creating, setCreating] = useState(false);
  /**
   * The server whose cache is about to be cleared.
   *
   * Held as the application that was clicked, because the confirm has to
   * name how many other sites share that cache before anyone agrees to it.
   */
  /**
   * Whether a purge is being confirmed, and how far it reaches.
   *
   * One state rather than two, because there is one action with two scopes.
   * There used to be a button on every row as well, which read as "clear this
   * site" and cleared two hundred and forty-three of them: Cloudways purges
   * Varnish by server and offers nothing smaller through its API. A control
   * whose label needs a paragraph of correction is in the wrong place, so it
   * lives beside the server filter now, where the scope is the thing you just
   * chose.
   */
  const [flushAsking, setFlushAsking] = useState(false);
  const [flushBusy, setFlushBusy] = useState(false);
  const [flushed, setFlushed] = useState<string | null>(null);
  /**
   * The one site being cleared, through Cloudflare rather than the host.
   *
   * A different action from the button beside the filter, and the only one on
   * this page whose reach is what its label says. Cloudways purges Varnish by
   * server and nothing smaller; Cloudflare purges by zone, a zone is a domain,
   * and a domain is one site.
   */
  const [purging, setPurging] = useState<string | null>(null);

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

  // Back to the first page whenever the list underneath changes. Holding
  // position while the filter narrows leaves you looking at rows that are no
  // longer there, or at nothing at all.
  useEffect(() => {
    setVisible(PAGE);
  }, [query, server, sortKey, direction]);

  /**
   * Clear Varnish, as far as the filter says.
   *
   * A server when one is chosen, everything when it is not. The API takes a
   * server or a flag for all of them, and this is only deciding which.
   */
  async function flush() {
    setFlushBusy(true);
    setError(null);
    try {
      const server = chosen?.host === "cloudways" ? chosen.id.split(":")[1] : "";
      const response = await fetch("/api/apps/cache", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(server ? { serverId: server } : { all: true }),
      });
      if (response.status === 401) {
        window.location.href = "/login";
        return;
      }
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? `The purge returned ${response.status}.`);

      if (server) {
        setFlushed(
          `Varnish cleared on ${payload.serverLabel}, covering ${payload.apps} application` +
            `${payload.apps === 1 ? "" : "s"}.`,
        );
      } else {
        // Reported per server. One refusing while the rest go through is a
        // real outcome, and "done" would be the wrong word for it.
        const rows = (payload.servers ?? []) as Array<{ ok: boolean; label: string }>;
        const failed = rows.filter((s) => !s.ok);
        setFlushed(
          failed.length
            ? `Varnish cleared on ${rows.length - failed.length} of ${rows.length} servers. ` +
              `${failed.map((s) => s.label).join(", ")} refused.`
            : `Varnish cleared on every server, covering ${payload.apps} applications.`,
        );
      }
      setFlushAsking(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The cache could not be cleared.");
      setFlushAsking(false);
    } finally {
      setFlushBusy(false);
    }
  }

  async function purgeSite(app: App) {
    setPurging(app.key);
    setError(null);
    try {
      const response = await fetch("/api/apps/cache", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ domain: app.domain }),
      });
      if (response.status === 401) {
        window.location.href = "/login";
        return;
      }
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? `The purge returned ${response.status}.`);
      setFlushed(`Cloudflare cache cleared for ${app.domain}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That cache could not be cleared.");
    } finally {
      setPurging(null);
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
      if (server && a.placeId !== server) return false;
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
        return a.placeLabel.localeCompare(b.placeLabel) * flip || name(a).localeCompare(name(b));
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
      servers: data?.places.length ?? 0,
      // The one worth opening this page for. An application nobody pointed a
      // domain at is either unfinished or forgotten, and both are money.
      homeless: rows.filter((a) => !a.domain && !a.staging).length,
      staging: rows.filter((a) => a.staging).length,
    };
  }, [data]);

  /**
   * Everywhere a site can live, across every connected host.
   *
   * One control rather than a host picker and a server picker. "Which host" and
   * "which server" are the same question asked at two depths, and the answer is
   * always one place — so the list names the place and hints at the host it
   * belongs to.
   */
  const serverOptions = useMemo(() => {
    const places = data?.places ?? [];
    const hosts = new Set(places.map((p) => p.host));
    return [
      { value: "", label: hosts.size > 1 ? "All hosts" : "All servers" },
      ...places.map((p) => ({
        value: p.id,
        label: p.label,
        // The host, once there is more than one. With a single host it is the
        // same word on every line and tells nobody anything.
        hint: hosts.size > 1 ? p.hostLabel : `${p.apps}`,
      })),
    ];
  }, [data]);

  /** The place the filter is on, or nothing when it is showing everything. */
  const chosen = useMemo(
    () => (data?.places ?? []).find((p) => p.id === server) ?? null,
    [data, server],
  );

  /** Hosts that answered badly, named so an empty list is not a mystery. */
  const broken = useMemo(
    () => (data?.sources ?? []).filter((s) => !s.ok && data?.connected.includes(s.host)),
    [data],
  );

  return (
    <div className="stack">
      <div className="card">
        <div className="card-head">
          <div>
            <h2>Hosting</h2>
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

          {broken.map((s) => (
            <div className="notice warn" key={s.host}>
              <strong>{s.label} could not be read.</strong> {s.note} Everything
              below is what the other hosts returned, so this list is short
              rather than wrong.
            </div>
          ))}

          {loading && !data ? <SkeletonTable columns={5} rows={8} /> : null}

          {data && !data.apps.length && !error ? (
            <div className="notice warn">
              <strong>No applications on any connected host.</strong> The
              tokens worked and the accounts came back empty, so there is
              nothing to show rather than something we could not read.
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
                <div className="bar-filter">
                  <Select
                    id="apps-server"
                    value={server}
                    options={serverOptions}
                    onChange={setServer}
                  />
                </div>
                {/* Beside the filter, and scoped by it. Cloudways purges
                    Varnish per server and offers nothing smaller, so this is
                    the smallest honest control: it clears what you have just
                    selected, and says which that is. */}
                {(data?.connected ?? []).includes("cloudways") ? (
                  <button
                    type="button"
                    className="btn btn-ghost bar-btn"
                    onClick={() => setFlushAsking(true)}
                    disabled={flushBusy || (!!chosen && chosen.host !== "cloudways")}
                    title={
                      chosen && chosen.host !== "cloudways"
                        ? `${chosen.hostLabel} has no cache this can clear.`
                        : undefined
                    }
                  >
                    {flushBusy
                      ? "Clearing…"
                      : chosen
                        ? `Flush cache on ${chosen.label}`
                        : "Flush cache on every server"}
                  </button>
                ) : null}
                <span className="domain-counts">
                  <span className="domain-count">
                    {shown.length > visible ? (
                      <>
                        <strong>{visible}</strong> of {shown.length}
                      </>
                    ) : (
                      <>
                        <strong>{shown.length}</strong> shown
                      </>
                    )}
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
                    {/* Not sortable: it holds controls, not a value to order
                        rows by. Right, to sit over the buttons beneath it. */}
                    <th className="act-head">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.slice(0, visible).map((a) => (
                    <tr key={a.key}>
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
                        <span className="registrar">{a.placeLabel}</span>
                        <div className="app-sub">
                          {/* The host, once there is more than one connected.
                              With one it is the same word on every row. */}
                          {(data?.connected.length ?? 0) > 1
                            ? HOSTS[a.host].label
                            : a.placeAddress}
                        </div>
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
                          {!a.enabled ? (
                            <span
                              className="pill pill-bad"
                              title="This site is switched off at the host."
                            >
                              disabled
                            </span>
                          ) : null}
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
                          {/* Only where there is a domain to purge: a zone
                              is a domain, and a site nobody has pointed one at
                              has no cache in front of it. */}
                          {a.domain ? (
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              onClick={() => void purgeSite(a)}
                              disabled={purging === a.key}
                              title={`Clear the Cloudflare cache for ${a.domain}, and nothing else`}
                            >
                              {purging === a.key ? "Clearing…" : "Clear cache"}
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => setManaging(a)}
                          >
                            Modify
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {shown.length > visible ? (
                <div className="more">
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => setVisible((v) => v + PAGE)}
                  >
                    Show {Math.min(PAGE, shown.length - visible)} more
                  </button>
                </div>
              ) : null}

              <p className="domain-note">
                Every site on every connected host. The name links to the
                domain when one is pointed at it, and to the host&rsquo;s own
                address otherwise. An <strong>SSL</strong> mark means Cloudways
                holds a certificate; most of these sit behind Cloudflare, which
                does its own, so no mark does not mean no padlock, and Hostinger
                does not report certificates at all. Cloudways returns four
                passwords per application and only the admin login is kept, the
                rest dropped before anything reaches your browser; it is what
                was set at install, so it will be out of date if someone has
                changed it since. Hostinger returns no passwords, and supports
                neither cloning nor domain changes, so those controls do not
                appear on its rows. <strong>Clear cache</strong> on a row goes
                through Cloudflare and clears that one site; the button beside
                the filter goes through Cloudways, which purges Varnish by
                server and offers nothing smaller.
              </p>
            </>
          ) : null}
        </div>
      </div>

      <ConfirmDialog
        open={flushAsking}
        title={chosen ? `Clear the cache on ${chosen.label}` : "Clear every cache"}
        body={
          <>
            Cloudways purges Varnish by server and offers nothing smaller
            through its API, so this clears every application on{" "}
            {chosen ? (
              <>
                <strong>{chosen.label}</strong>, all{" "}
                <strong>{chosen.apps}</strong> of them
              </>
            ) : (
              <>
                all{" "}
                <strong>
                  {(data?.places ?? []).filter((p) => p.host === "cloudways").length}
                </strong>{" "}
                Cloudways servers
              </>
            )}
            . Each serves from the origin until its cache refills, so the
            servers work harder for a minute afterwards. Nothing is lost and
            there is nothing to undo.
          </>
        }
        confirmLabel="Clear it"
        busyLabel="Clearing…"
        cancelLabel="Cancel"
        busy={flushBusy}
        onConfirm={() => void flush()}
        onDismiss={() => setFlushAsking(false)}
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
          servers={data?.places ?? []}
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
