"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useReveal } from "@/lib/reveal";

import AppCredential from "@/components/AppCredential";
import AppDomain from "@/components/AppDomain";
import ConfirmDialog from "@/components/ConfirmDialog";
import NewApplication from "@/components/NewApplication";
import { Select } from "@/components/Select";
import { HOSTS, type HostId } from "@/lib/hosts";
import { ColumnPicker, useColumns, type ColumnSpec } from "@/components/Columns";
import { SkeletonTable } from "@/components/Skeleton";

/**
 * The columns, and which may be turned off.
 *
 * The name and the buttons stay: one is how you know which site a row is, the
 * other is how you do anything to it. The rest are facts somebody needs on one
 * visit and not the next, and the admin login is a whole password box that most
 * visits are not here for.
 */
const COLUMNS: ColumnSpec[] = [
  { key: "name", label: "Application", fixed: true },
  { key: "platform", label: "Platform" },
  { key: "server", label: "Server" },
  { key: "admin", label: "Admin login" },
  { key: "actions", label: "Actions", fixed: true },
];

/**
 * The marks on a row's three actions.
 *
 * Three buttons that did three unrelated things looked identical, so telling
 * them apart on a row you were not reading meant reading them. An icon is what
 * the eye lands on first, and at this size a shape is faster than a word.
 *
 * Drawn rather than loaded: each takes the colour of the button it sits in,
 * which is the point of giving those buttons different colours at all.
 */
/**
 * The two marks in the page's header.
 *
 * Refresh spins its own icon while it reads rather than swapping its label for
 * a longer one, which resizes a button somebody's pointer is still on.
 */
function RefreshIcon({ spinning }: { spinning?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className={spinning ? "spin" : undefined}
      aria-hidden
    >
      <path d="M20 11a8 8 0 1 0-1.6 5.2" />
      <path d="M20 4v7h-7" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function OpenIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M14 4h6v6" />
      <path d="M20 4l-8 8" />
      <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
    </svg>
  );
}

function SweepIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M4 20l5-5" />
      <path d="M11 9l4 4" />
      <path d="M15 5l4 4-6 6-4-4z" />
      <path d="M3 21h6" />
    </svg>
  );
}

function ModifyIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4" />
    </svg>
  );
}

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
  const columns = useColumns("apps", COLUMNS);
  const [error, setError] = useState<string | null>(null);
  const [configError, setConfigError] = useState(false);
  const [query, setQuery] = useState("");
  const [server, setServer] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [direction, setDirection] = useState<"asc" | "desc">("asc");
  const [visible, setVisible] = useState(PAGE);
  // Where a row revealed by Show more takes its arrival from, so a batch
  // cascades instead of landing all at once.
  const revealed = useReveal(visible);
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
            {/* Reading, rather than doing: quiet, and it says so by spinning
                its own mark rather than by changing into a different word that
                resizes the button under the pointer. */}
            <button
              type="button"
              className="btn btn-ghost head-do"
              onClick={() => void load()}
              disabled={loading}
              title="Read every connected host again"
            >
              <RefreshIcon spinning={loading} />
              {loading ? "Reading…" : "Refresh"}
            </button>
            {/* The one thing on this page that makes something exist. It is
                the page's action and it looks like one. */}
            <button
              type="button"
              className="btn btn-primary head-do is-new"
              onClick={() => setCreating(true)}
            >
              <PlusIcon />
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
                <ColumnPicker specs={COLUMNS} chosen={columns} />

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

              <table className="logs logs-middle table-in">
                <thead>
                  <tr>
                    {(
                      [
                        ["name", "Application", ""],
                        ["platform", "Platform", "mid"],
                        ["server", "Server", "mid"],
                        ["admin", "Admin login", "mid cred-cell"],
                      ] as Array<[SortKey, string, string]>
                    )
                      .filter(([key]) => columns.shown(key))
                      .map(([key, label, align]) => (
                        <th key={key} className={columns.cell(key, align ? `${align} sortable` : "sortable")}>
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
                {/* Keyed by the host being shown.

                    Changing the filter replaces the rows rather than editing
                    them in place, so the arrival animation runs again and the
                    table is visibly a different set of rows instead of
                    silently becoming one. Nothing in a row holds state of its
                    own, so replacing them costs nothing. */}
                <tbody key={server || "all"}>
                  {shown.slice(0, visible).map((a, at) => (
                    <tr key={a.key} style={revealed(at)}>
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
                      {columns.shown("platform") ? (
                        <td className={columns.cell("platform", "mid")}>
                          {a.platformLabel}
                          {a.version ? <span className="app-sub-inline">{a.version}</span> : null}
                        </td>
                      ) : null}
                      {columns.shown("server") ? (
                        <td className={columns.cell("server", "mid")}>
                          <span className="registrar">{a.placeLabel}</span>
                          <div className="app-sub">
                            {/* The host, once there is more than one connected.
                                With one it is the same word on every row. */}
                            {(data?.connected.length ?? 0) > 1
                              ? HOSTS[a.host].label
                              : a.placeAddress}
                          </div>
                        </td>
                      ) : null}
                      {columns.shown("admin") ? (
                        <td className={columns.cell("admin", "mid cred-cell")}>
                          <AppCredential user={a.adminUser} password={a.adminPassword} />
                        </td>
                      ) : null}
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
                              className="btn btn-primary-soft btn-sm app-do is-go"
                              href={`${home(a)}${a.adminPath}`}
                              target="_blank"
                              rel="noreferrer noopener"
                              title={`Open ${a.label}'s own WordPress admin in a new tab`}
                            >
                              <OpenIcon />
                              Go To Admin
                            </a>
                          ) : null}
                          {/* Only where there is a domain to purge: a zone
                              is a domain, and a site nobody has pointed one at
                              has no cache in front of it. */}
                          {a.domain ? (
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm app-do is-cache"
                              onClick={() => void purgeSite(a)}
                              disabled={purging === a.key}
                              title={`Clear the Cloudflare cache for ${a.domain}, and nothing else`}
                            >
                              <SweepIcon />
                              {purging === a.key ? "Clearing…" : "Clear cache"}
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm app-do is-modify"
                            onClick={() => setManaging(a)}
                            title={`Rename ${a.label}, change its domain, clone or delete it`}
                          >
                            <ModifyIcon />
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
