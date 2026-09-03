"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Domain = {
  domain: string;
  domainId: number | null;
  status: string;
  expires: string | null;
  createdAt: string | null;
  renewAuto: boolean;
  locked: boolean;
  privacy: boolean;
  daysLeft: number | null;
  nameServers: string[];
};

const PAGE = 50;

/**
 * How urgent an expiry is.
 *
 * Thirty days is the line because that is roughly when a renewal stops being
 * something to schedule and starts being something to do. Ninety is worth
 * marking too: a domain a quarter from expiry is fine, but it is the one to
 * look at when deciding what to let go.
 */
function expiryTone(days: number | null, renewAuto: boolean): string {
  if (days === null) return "idle";
  if (days < 0) return "bad";
  if (days <= 30) return renewAuto ? "warn" : "bad";
  if (days <= 90) return "warn";
  return "ok";
}

function expiryText(days: number | null, expires: string | null): string {
  if (days === null || !expires) return "no expiry recorded";
  if (days < 0) return `expired ${Math.abs(days)}d ago`;
  if (days === 0) return "expires today";
  if (days <= 90) return `${days}d left`;
  return new Date(expires).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * GoDaddy's statuses are SHOUTED enum names, and there are over two hundred of
 * them. Only ACTIVE is unremarkable; everything else is matched on the word
 * that carries the meaning.
 *
 * ABUSE and LOCKED_ are here because this account actually holds a
 * LOCKED_ABUSE domain, and neither the word "locked" nor "abuse" appeared in
 * the first version of this list — so the one domain on the account in real
 * trouble rendered in the same grey as an unknown status. Registry suspension
 * and redemption are the other two that turn up.
 */
function statusTone(status: string): string {
  if (status === "ACTIVE") return "ok";
  if (/EXPIRED|CANCELL?ED|SUSPENDED|ABUSE|LOCKED_|HELD|HOLD|REDEMPTION|INVALID/i.test(status)) {
    return "bad";
  }
  if (/PENDING|TRANSFER|VERIFICATION|RENEWAL|AWAITING/i.test(status)) return "warn";
  return "idle";
}

function prettyStatus(status: string): string {
  return status.toLowerCase().replace(/_/g, " ");
}

/**
 * Where a domain actually points.
 *
 * The registrar's default name servers mean the domain is parked: registered
 * and doing nothing. That is the single most useful thing this list can say
 * beyond the expiry date, and it is invisible in GoDaddy's own interface
 * without opening each domain in turn.
 */
function pointsAt(nameServers: string[]): { label: string; tone: string } {
  if (!nameServers.length) return { label: "unknown", tone: "idle" };
  const hosts = nameServers.map((n) => n.toLowerCase());
  if (hosts.some((h) => /(^|\.)domaincontrol\.com$/.test(h))) {
    return { label: "parked at GoDaddy", tone: "idle" };
  }
  if (hosts.some((h) => /(^|\.)cloudflare\.com$/.test(h))) {
    return { label: "Cloudflare", tone: "ok" };
  }
  if (hosts.some((h) => /(^|\.)vercel-dns\.com$/.test(h))) {
    return { label: "Vercel", tone: "ok" };
  }
  // The registrable part of the first name server, which is the host that
  // actually answers for this domain.
  const parts = hosts[0].split(".").filter(Boolean);
  return { label: parts.slice(-2).join(".") || hosts[0], tone: "ok" };
}

export default function DomainsView() {
  const [domains, setDomains] = useState<Domain[]>([]);
  const [scheme, setScheme] = useState<string>("");
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [configError, setConfigError] = useState(false);
  const [query, setQuery] = useState("");
  const [visible, setVisible] = useState(PAGE);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/domains", { cache: "no-store" });
      if (response.status === 401) {
        window.location.href = "/login";
        return;
      }
      const payload = await response.json();
      if (!response.ok) {
        setConfigError(payload.kind === "config");
        throw new Error(payload.error ?? `The domains API returned ${response.status}.`);
      }
      setDomains(payload.domains ?? []);
      setScheme(payload.scheme ?? "");
      setTruncated(!!payload.truncated);
      setConfigError(false);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reach GoDaddy.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return domains;
    return domains.filter((d) => d.domain.toLowerCase().includes(needle));
  }, [domains, query]);

  // Counted over everything, not over what the search box left behind: these
  // are facts about the account, and they should not change as you type.
  const soon = domains.filter((d) => d.daysLeft !== null && d.daysLeft <= 30).length;
  const manual = domains.filter((d) => !d.renewAuto).length;

  return (
    <div className="stack">
      <div className="card">
        <div className="card-head">
          <div>
            <h2>Domains</h2>
            <p>
              Everything this GoDaddy account holds, soonest to expire first.
              Read only &mdash; nothing here renews, moves or changes a domain.
            </p>
          </div>
          <button type="button" className="btn btn-ghost" onClick={() => void load()} disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>

        <div className="card-body tight">
          {error ? (
            <div className="notice bad">
              {error}
              {configError ? (
                <>
                  {" "}
                  Set <code>GODADDY_API_KEY</code> in the project&rsquo;s
                  environment variables and redeploy.
                </>
              ) : null}
            </div>
          ) : null}

          {truncated ? (
            <div className="notice warn">
              This account holds more domains than one read returns. The list
              below is the first several thousand, soonest to expire first.
            </div>
          ) : null}

          {loading && !domains.length ? (
            <div className="empty">Asking GoDaddy…</div>
          ) : !domains.length && !error ? (
            <div className="empty">This account holds no domains.</div>
          ) : domains.length ? (
            <>
              <div className="domain-bar">
                <input
                  type="search"
                  className="domain-search"
                  placeholder="Filter by name"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setVisible(PAGE);
                  }}
                />
                <span className="domain-counts">
                  {domains.length} domain{domains.length === 1 ? "" : "s"}
                  {soon ? <> &middot; {soon} expiring within 30 days</> : null}
                  {manual ? <> &middot; {manual} not on auto-renew</> : null}
                </span>
              </div>

              <table className="logs">
                <thead>
                  <tr>
                    <th>Domain</th>
                    <th>Status</th>
                    <th>Expires</th>
                    <th>Renewal</th>
                    <th>Points at</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.slice(0, visible).map((d) => {
                    const where = pointsAt(d.nameServers);
                    return (
                      <tr key={d.domain}>
                        <td>
                          <a
                            className="domain-name"
                            href={`https://${d.domain}`}
                            target="_blank"
                            rel="noreferrer noopener"
                          >
                            {d.domain}
                          </a>
                        </td>
                        <td>
                          <span className={`pill pill-${statusTone(d.status)}`}>
                            {prettyStatus(d.status)}
                          </span>
                        </td>
                        <td className="nowrap">
                          <span className={`pill pill-${expiryTone(d.daysLeft, d.renewAuto)}`}>
                            {expiryText(d.daysLeft, d.expires)}
                          </span>
                        </td>
                        <td className="nowrap">
                          {d.renewAuto ? (
                            <span className="quiet">automatic</span>
                          ) : (
                            <span className="pill pill-warn">manual</span>
                          )}
                        </td>
                        <td className="detail">
                          <span className={`pill pill-${where.tone}`}>{where.label}</span>
                        </td>
                      </tr>
                    );
                  })}
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

              {!shown.length ? (
                <div className="empty">No domain matches &ldquo;{query}&rdquo;.</div>
              ) : null}

              {scheme ? (
                <p className="domain-note">
                  Read from GoDaddy with the {scheme} authorization scheme.
                </p>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
