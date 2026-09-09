"use client";

import { useCallback, useEffect, useState } from "react";

type Site = {
  domain: string;
  username: string;
  createdAt: string;
  createdBy: string;
  readable: boolean;
};

/**
 * What the site said when asked.
 *
 * `reading` is the whole answer in a sentence, worked out on the server where
 * the probes are. The rest is what it was worked out from, for the times the
 * sentence is not enough.
 */
type Check = {
  domain: string;
  found: boolean;
  username?: string;
  passwordLength?: number;
  bridge?: boolean;
  /** True when something other than WordPress answered for the REST API. */
  gatekeeper?: boolean;
  site?: string | null;
  identity?: {
    name?: string;
    roles?: string[];
    publish_posts?: boolean;
  } | null;
  /** Each request the check made and what came back, in the order it made them. */
  probes?: Array<{
    label: string;
    status: number | null;
    ok: boolean;
    code?: string | null;
    message?: string | null;
  }>;
  reading?: string;
  note?: string;
};

function GlobeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.7 2.5 15.3 0 18M12 3c-2.5 2.7-2.5 15.3 0 18" />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function KeyIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M15 7a4 4 0 1 1-3.7 5.5L8 15.8V19H4v-4l6.5-6.5A4 4 0 0 1 15 7Z" />
      <circle cx="16.5" cy="7.5" r="1" fill="currentColor" />
    </svg>
  );
}

export default function SiteAccounts() {
  const [sites, setSites] = useState<Site[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /*
   * One check at a time, keyed by domain.
   *
   * Per row rather than one shared result, because the answer belongs to the
   * site it is about: a shared panel would show the last site's verdict under
   * the row somebody is now looking at.
   */
  const [checking, setChecking] = useState<string | null>(null);
  const [checked, setChecked] = useState<Record<string, Check>>({});

  const [domain, setDomain] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/sites", { cache: "no-store" });
      if (response.status === 401) {
        window.location.href = "/login";
        return;
      }
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Could not load sites.");
      setSites(payload.sites ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load sites.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch("/api/sites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ domain, username, password }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Could not save.");

      setNotice(
        (payload.replaced ? "Updated" : "Added") +
          " the login for " +
          payload.domain +
          "."
      );
      setDomain("");
      setUsername("");
      setPassword("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(target: string) {
    if (
      !window.confirm("Remove the stored WordPress login for " + target + "?")
    ) {
      return;
    }
    try {
      const response = await fetch(
        "/api/sites?domain=" + encodeURIComponent(target),
        { method: "DELETE" }
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Could not remove.");
      setNotice("Removed " + target + ".");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove.");
    }
  }

  /**
   * Ask the site whether this login works.
   *
   * Every probe behind it is a read, so this is safe to press as often as
   * somebody likes. It answers the question a failed publish leaves open: was
   * it the password, the plugin, or what this user is allowed to do.
   */
  async function test(site: string) {
    setChecking(site);
    setError(null);
    try {
      const response = await fetch(`/api/sites/check?site=${encodeURIComponent(site)}`, {
        cache: "no-store",
      });
      if (response.status === 401) {
        window.location.href = "/login";
        return;
      }
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? `The check returned ${response.status}.`);
      setChecked((all) => ({ ...all, [site]: payload as Check }));
    } catch (e) {
      setChecked((all) => ({
        ...all,
        [site]: {
          domain: site,
          found: false,
          note: e instanceof Error ? e.message : "The site could not be checked.",
        },
      }));
    } finally {
      setChecking(null);
    }
  }

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>Website accounts</h2>
          <p>
            WordPress logins per domain, so a run can publish to any registered
            site without anyone typing credentials into the run form.
          </p>
        </div>
      </div>

      <div className="card-body">
        {error ? <div className="notice bad">{error}</div> : null}
        {notice ? <div className="notice">{notice}</div> : null}

        {loading ? (
          <div className="empty">Loading&hellip;</div>
        ) : sites.length === 0 ? (
          <div className="empty">
            No sites registered yet. Add one below and any run against that
            domain will use it.
          </div>
        ) : (
          <ul className="sites">
            {sites.map((site) => (
              <li key={site.domain}>
                <span className="site-domain">{site.domain}</span>
                <span className="site-user">{site.username}</span>
                <div className="site-do">
                  {site.readable ? null : (
                    <span className="pill pill-bad">unreadable</span>
                  )}
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={checking === site.domain}
                    title="Ask the site whether this login works. Nothing is written."
                    onClick={() => void test(site.domain)}
                  >
                    {checking === site.domain ? "Testing…" : "Test connection"}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => void remove(site.domain)}
                  >
                    Remove
                  </button>
                </div>

                {/* Under the row it belongs to, and only once asked. The
                    sentence is the answer; the line under it is what the site
                    said about this login, for when the sentence is not
                    enough. */}
                {checked[site.domain] ? (
                  <div
                    className={
                      checked[site.domain]!.reading?.endsWith(
                        "Nothing stands between a run and publishing.",
                      )
                        ? "site-check is-ok"
                        : checked[site.domain]!.gatekeeper
                          ? "site-check is-mixed"
                          : "site-check is-bad"
                    }
                  >
                    <strong>
                      {checked[site.domain]!.reading ??
                        checked[site.domain]!.note ??
                        "No answer."}
                    </strong>

                    {checked[site.domain]!.identity ||
                    checked[site.domain]!.site ||
                    typeof checked[site.domain]!.passwordLength === "number" ? (
                      <span className="site-check-who">
                        {[
                          checked[site.domain]!.site,
                          checked[site.domain]!.identity?.name,
                          checked[site.domain]!.identity?.roles?.join(", "),
                          typeof checked[site.domain]!.passwordLength === "number"
                            ? `password ${checked[site.domain]!.passwordLength} characters`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    ) : null}

                    {/* What the sentence above was worked out from.
                        A reading can be wrong, and this one has been: it once
                        called a working site broken on the evidence of an
                        endpoint nothing here uses. Somebody whose own site
                        disagrees with the verdict should be able to see why
                        without opening a browser console. */}
                    {checked[site.domain]!.probes?.length ? (
                      <ul className="site-probes">
                        {checked[site.domain]!.probes!.map((probe) => (
                          <li key={probe.label}>
                            <span>{probe.label}</span>
                            <code>
                              {probe.status ?? "no answer"}
                              {probe.code ? ` ${probe.code}` : ""}
                            </code>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={save} className="site-form">
          <div className="field">
            <label htmlFor="site_domain">Domain</label>
            <div className="input-icon">
              <GlobeIcon />
              <input
                id="site_domain"
                className="input-fancy"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder="example.com"
                required
              />
            </div>
            <div className="note">
              The domain only. A full URL works too, and www is ignored, so one
              entry covers every page on the site.
            </div>
          </div>

          <div className="row-2">
            <div className="field">
              <label htmlFor="site_username">WordPress username</label>
              <div className="input-icon">
                <UserIcon />
                <input
                  id="site_username"
                  className="input-fancy"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="username"
                  autoComplete="off"
                  required
                />
              </div>
            </div>

            <div className="field">
              <label htmlFor="site_password">Application password</label>
              <div className="input-icon">
                <KeyIcon />
                <input
                  id="site_password"
                  className="input-fancy"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="xxxx xxxx xxxx xxxx"
                  autoComplete="new-password"
                  required
                />
              </div>
            </div>
          </div>

          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? "Saving…" : "Save site login"}
          </button>
        </form>
      </div>
    </div>
  );
}
