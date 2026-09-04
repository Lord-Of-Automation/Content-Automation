"use client";

import { useCallback, useEffect, useState } from "react";

import DatePicker from "@/components/DatePicker";

type Field = {
  name: string;
  label: string;
  secret: boolean;
  multiline?: boolean;
  placeholder: string;
  hint?: string;
};

type Spec = {
  id: string;
  label: string;
  wired: boolean;
  blurb: string;
  fields: Field[];
};

type Status = {
  id: string;
  set: boolean;
  source: "console" | "environment" | "unset";
  shown: Record<string, string>;
  expiresAt: string | null;
  daysLeft: number | null;
  savedAt: string | null;
  savedBy: string | null;
  readable: boolean;
  accounts?: Array<{ accountId: string; tail: string }>;
};

/** The one credential being typed. It is added to the list, not saved over it. */
type CfEntry = { token: string; accountId: string };

/** What each stored Cloudflare credential is actually doing, checked live. */
type CfSummary = {
  accountId: string;
  tail: string;
  ok: boolean;
  zones: number | null;
  canCreate: boolean;
  note: string;
};

/**
 * How loudly to say a credential is running out.
 *
 * Thirty days because reissuing one is a five-minute job somebody has to
 * remember, and nothing warns them: none of these registrars send a notice or
 * report an expiry through their API. The first symptom otherwise is a page
 * that worked yesterday saying the credential was refused.
 */
function expiryNote(days: number | null): { text: string; tone: string } | null {
  if (days === null) return null;
  if (days < 0) return { text: `expired ${Math.abs(days)} days ago`, tone: "bad" };
  if (days <= 30) return { text: `expires in ${days} days`, tone: "bad" };
  if (days <= 90) return { text: `expires in ${days} days`, tone: "warn" };
  return { text: `expires in ${days} days`, tone: "ok" };
}

/** ISO datetime to the date part the picker wants. */
function dateOnly(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "";
}

export default function DomainProviders() {
  const [specs, setSpecs] = useState<Spec[]>([]);
  const [statuses, setStatuses] = useState<Record<string, Status>>({});
  const [drafts, setDrafts] = useState<Record<string, Record<string, string>>>({});
  const [dates, setDates] = useState<Record<string, string>>({});
  /**
   * Cloudflare's accounts, as rows.
   *
   * Several is the normal case for this one, and a list of secrets cannot be
   * edited as a block of text when none of them can be shown back. So each
   * account is a row keyed on its id, and a row left untouched keeps the token
   * already stored for it.
   */
  const [cfEntry, setCfEntry] = useState<CfEntry>({ token: "", accountId: "" });
  const [cfChecked, setCfChecked] = useState<CfSummary[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  /** What the Google callback redirected back with, if anything. */
  const [googleSaid, setGoogleSaid] = useState<string | null>(null);
  const [googleRedirect, setGoogleRedirect] = useState("");
  const [copied, setCopied] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const apply = useCallback(
    (payload: { providers: Spec[]; statuses: Status[]; googleRedirect?: string }) => {
    setSpecs(payload.providers ?? []);
    if (payload.googleRedirect) setGoogleRedirect(payload.googleRedirect);
    const byId: Record<string, Status> = {};
    for (const s of payload.statuses ?? []) byId[s.id] = s;
    setStatuses(byId);
    // The stored expiry seeds the picker, so opening the page and pressing Save
    // does not quietly blank a date somebody set last week.
    setDates((current) => {
      const next = { ...current };
      for (const s of payload.statuses ?? []) {
        if (next[s.id] === undefined) next[s.id] = dateOnly(s.expiresAt);
      }
      return next;
    });
    },
    [],
  );

  /**
   * Ask Cloudflare what each stored token can actually see.
   *
   * A stored credential and a working one are different things, and the form
   * alone could only ever show the first. Separate from the load because it
   * costs a request per account, and the fields should appear before anybody
   * has been to Cloudflare and back.
   */
  const check = useCallback(async () => {
    setChecking(true);
    try {
      const response = await fetch("/api/keys/providers?check=1", { cache: "no-store" });
      if (!response.ok) return;
      const payload = (await response.json()) as { cloudflare?: CfSummary[] };
      setCfChecked(payload.cloudflare ?? []);
    } catch {
      // The rows above still say what is stored, which is the important half.
    } finally {
      setChecking(false);
    }
  }, []);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/keys/providers", { cache: "no-store" });
      if (response.status === 401) {
        window.location.href = "/login";
        return;
      }
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Could not read the providers.");
      apply(payload);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read the providers.");
    }
  }, [apply]);

  useEffect(() => {
    void load();
    void check();

    // The sign-in leaves the app and comes back, so the outcome arrives in the
    // address bar rather than in a response. Read once, then cleaned out of the
    // URL so a reload does not report last time's result as this time's.
    const said = new URLSearchParams(window.location.search).get("google");
    if (said) {
      setGoogleSaid(said);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [load, check]);

  function setField(provider: string, field: string, value: string) {
    setDrafts((d) => ({ ...d, [provider]: { ...(d[provider] ?? {}), [field]: value } }));
  }

  /**
   * One credential at a time.
   *
   * The list is not something you edit and save; it is something you add to and
   * take from. None of the tokens can be shown back, so a form that held the
   * whole list would make you retype every one of them to change any.
   */
  async function cloudflare(body: Record<string, unknown>, done: string) {
    setBusy("cloudflare");
    setMessage(null);
    setError(null);
    try {
      const response = await fetch("/api/keys/providers", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "cloudflare", ...body }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "That did not work.");
      apply(payload);
      setCfEntry({ token: "", accountId: "" });
      setMessage(done);
      // Re-checked straight away, so the table proves what was just added
      // actually reaches something.
      void check();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work.");
    } finally {
      setBusy(null);
    }
  }

  async function submit(provider: string, method: "PUT" | "DELETE") {
    setBusy(provider);
    setMessage(null);
    setError(null);
    try {
      const response = await fetch("/api/keys/providers", {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          method !== "PUT"
            ? { id: provider }
            : { id: provider, values: drafts[provider] ?? {}, expiresAt: dates[provider] ?? "" },
        ),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "That did not work.");

      // Reseeded from what came back, so the rows show the stored state rather
      // than whatever was typed to get there.
      apply(payload);
      setDrafts((d) => ({ ...d, [provider]: {} }));
      const name = specs.find((s) => s.id === provider)?.label ?? provider;
      setMessage(
        method === "PUT"
          ? `Saved ${name}. In effect from the next request, no redeploy needed.`
          : `Removed ${name}.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="card">
      <div className="card-head">
        <span>Domain providers</span>
      </div>

      <div className="card-body">
        <p className="stage-hint" style={{ marginBottom: 16 }}>
          Read-only credentials for the registrars this console lists domains
          from. Every secret is encrypted here and never sent back to the
          browser, so a field left blank means &ldquo;leave it as it is&rdquo;.
        </p>

        {error ? <div className="alert alert-warn">{error}</div> : null}
        {message ? <div className="alert alert-ok">{message}</div> : null}
        {!specs.length ? <p className="stage-hint">Reading…</p> : null}

        {specs.map((spec) => {
          const status = statuses[spec.id];
          const note = expiryNote(status?.daysLeft ?? null);
          const draft = drafts[spec.id] ?? {};
          const touched = Object.values(draft).some((v) => v.trim());
          const dateChanged = (dates[spec.id] ?? "") !== dateOnly(status?.expiresAt ?? null);

          return (
            <div className="provider" key={spec.id}>
              <div className="provider-head">
                <h3 className="provider-name">{spec.label}</h3>
                {status?.set ? (
                  <span className="stage-tag">
                    {status.source === "console" ? "set here" : "from the environment"}
                  </span>
                ) : (
                  <span className="stage-tag">not set</span>
                )}
                {/* Said plainly, because a form that accepts a credential and
                    does nothing with it is worse than no form. */}
                {!spec.wired ? (
                  <span className="stage-tag">stored, not yet read by the Domains page</span>
                ) : null}
              </div>

              <p className="stage-hint provider-blurb">{spec.blurb}</p>

              {/* The sign-in, above the fields, because it is the answer for
                  almost everybody and the service account below it is the
                  fallback for the case where nobody can sign in. */}
              {spec.id === "searchconsole" ? (
                <div className="google-connect">
                  {status?.shown?.refreshToken ? (
                    <>
                      <span className="pill pill-ok">Signed in</span>
                      <span className="google-who">
                        {status.shown.googleEmail || "a Google account"}
                      </span>
                      <a className="btn btn-ghost btn-sm" href="/api/google/connect">
                        Sign in again
                      </a>
                    </>
                  ) : (
                    <>
                      <a
                        className="btn btn-primary btn-sm"
                        href="/api/google/connect"
                        // A plain link, not a fetch: this leaves the app for
                        // Google's consent screen and comes back, which is a
                        // navigation rather than a request.
                      >
                        Connect Google
                      </a>
                      <span className="google-who">
                        Sees every property that account owns. Needs the client
                        ID and secret below to be saved first.
                      </span>
                    </>
                  )}
                </div>
              ) : null}

              {/* The one string that has to match, shown rather than guessed
                  at. redirect_uri_mismatch is an exact comparison, and a
                  trailing slash or a preview host is enough to fail it. */}
              {spec.id === "searchconsole" && googleRedirect ? (
                <div className="field">
                  <label htmlFor="google-redirect">
                    Authorised redirect URI
                    <span className="provider-current">register this verbatim</span>
                  </label>
                  <div className="redirect-row">
                    <input
                      id="google-redirect"
                      type="text"
                      className="mono"
                      readOnly
                      value={googleRedirect}
                      onFocus={(e) => e.currentTarget.select()}
                    />
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(googleRedirect);
                          setCopied(true);
                        } catch {
                          setError("Could not reach the clipboard. Select the box and copy it.");
                        }
                      }}
                    >
                      {copied ? "Copied" : "Copy"}
                    </button>
                  </div>
                  <p className="provider-hint">
                    Paste into the OAuth client under Authorised redirect URIs.
                    Google compares it as a string, so a trailing slash, http
                    instead of https, or a preview address rather than this one
                    each count as different.
                  </p>
                </div>
              ) : null}

              {spec.id === "searchconsole" && googleSaid ? (
                <div className={googleSaid === "connected" ? "alert alert-ok" : "alert alert-warn"}>
                  {googleSaid === "connected"
                    ? "Connected. The Performance page now reads as that account."
                    : googleSaid === "cancelled"
                      ? "The Google sign-in was cancelled, so nothing changed."
                      : googleSaid === "no-client"
                        ? "Save the OAuth client ID and secret first, then connect."
                        : googleSaid === "bad-state"
                          ? "That sign-in did not match one started here. Try again from this page."
                          : "Google would not complete the sign-in. Check that the redirect URI on the OAuth client matches this site exactly."}
                </div>
              ) : null}

              {status?.set && !status.readable ? (
                <div className="alert alert-warn">
                  <strong>The stored credential cannot be read.</strong>{" "}
                  AUTH_SECRET has changed since it was saved, so it can no longer
                  be decrypted. Enter it again below.
                </div>
              ) : null}

              {note ? (
                <div className={`alert alert-${note.tone}`}>
                  This credential {note.text}
                  {status?.expiresAt
                    ? ` (${new Date(status.expiresAt).toLocaleDateString()})`
                    : ""}
                  .
                  {note.tone === "ok"
                    ? " Nothing warns you when it lapses, which is why the date is kept here."
                    : " Issue a new one and paste it below."}
                </div>
              ) : null}

              {/* Cloudflare gets rows rather than fields, because several
                  accounts is ordinary for it and each one is a token that can
                  never be shown back. Everything else is one credential and
                  reads better as a plain form. */}
              {spec.id === "cloudflare" ? (
                <>
                  {/* One box, not a list of boxes. Each token entered joins the
                      table below rather than replacing what is there, which is
                      the only shape that works when none of them can be shown
                      back to be edited. */}
                  <div className="cf-row">
                    <div className="provider-field">
                      <label htmlFor="cf-new-token">API token</label>
                      <input
                        id="cf-new-token"
                        type="password"
                        autoComplete="off"
                        spellCheck={false}
                        placeholder="cfut_…"
                        value={cfEntry.token}
                        onChange={(e) => setCfEntry((c) => ({ ...c, token: e.target.value }))}
                      />
                    </div>

                    <div className="provider-field">
                      <label htmlFor="cf-new-account">Account ID</label>
                      <input
                        id="cf-new-account"
                        type="text"
                        className="mono"
                        spellCheck={false}
                        placeholder="32 hex characters"
                        value={cfEntry.accountId}
                        onChange={(e) =>
                          setCfEntry((c) => ({ ...c, accountId: e.target.value.trim() }))
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && cfEntry.token.trim() && busy !== "cloudflare") {
                            void cloudflare({ add: cfEntry }, "Added.");
                          }
                        }}
                      />
                    </div>

                    <button
                      type="button"
                      className="btn btn-primary cf-row-remove"
                      disabled={busy === "cloudflare" || !cfEntry.token.trim()}
                      onClick={() => void cloudflare({ add: cfEntry }, "Added.")}
                    >
                      {busy === "cloudflare" ? "Adding…" : "Add"}
                    </button>
                  </div>

                  <div className="provider-actions">
                    <button
                      type="button"
                      className="btn btn-ghost"
                      disabled={checking}
                      onClick={() => void check()}
                    >
                      {checking ? "Checking…" : "Re-check"}
                    </button>
                  </div>

                  {/* What is stored is one question and what works is another.
                      This answers the second, which is the one somebody has
                      when a domain reads as being on an account they thought
                      was configured. */}
                  {cfChecked?.length ? (
                    <table className="logs cf-summary">
                      <thead>
                        <tr>
                          <th>Token</th>
                          <th>Account</th>
                          <th className="num">Zones</th>
                          <th>Reads</th>
                          <th>Creates</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {cfChecked.map((a) => (
                          <tr key={`${a.accountId}-${a.tail}`}>
                            <td className="nowrap">
                              <span className="registrar">ends {a.tail}</span>
                            </td>
                            <td className="detail">
                              <span className="rr-value">{a.accountId || "not given"}</span>
                            </td>
                            <td className="num">
                              {a.zones === null ? <span className="quiet">—</span> : a.zones}
                            </td>
                            <td className="nowrap">
                              <span className={a.ok ? "pill pill-ok" : "pill pill-bad"}>
                                {a.ok ? "yes" : "no"}
                              </span>
                            </td>
                            <td className="detail">
                              {a.canCreate ? (
                                <span className="pill pill-ok">yes</span>
                              ) : (
                                <span className="pill pill-warn">needs an account id</span>
                              )}
                              {a.note ? <div className="provider-hint">{a.note}</div> : null}
                            </td>
                            <td className="nowrap">
                              <button
                                type="button"
                                className="btn btn-ghost btn-sm"
                                disabled={busy === "cloudflare"}
                                onClick={() =>
                                  void cloudflare(
                                    { remove: a.accountId || a.tail },
                                    "Removed.",
                                  )
                                }
                              >
                                Remove
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : cfChecked ? (
                    <p className="provider-hint">
                      Nothing stored for Cloudflare yet, so there is nothing to
                      check.
                    </p>
                  ) : null}
                </>
              ) : null}

              <div className="provider-fields">
                {spec.id === "cloudflare" ? null : spec.fields.map((field) => (
                  <div className="provider-field" key={field.name}>
                    <label htmlFor={`${spec.id}-${field.name}`}>
                      {field.label}
                      {status?.shown?.[field.name] ? (
                        <span className="provider-current">{status.shown[field.name]}</span>
                      ) : null}
                    </label>
                    {/* A textarea where the value holds several lines. A
                        password input would collapse them and hide which line
                        was wrong. */}
                    {field.multiline ? (
                      <textarea
                        id={`${spec.id}-${field.name}`}
                        rows={3}
                        autoComplete="off"
                        spellCheck={false}
                        placeholder={
                          status?.shown?.[field.name]
                            ? "leave blank to keep what is stored"
                            : field.placeholder
                        }
                        value={draft[field.name] ?? ""}
                        onChange={(e) => setField(spec.id, field.name, e.target.value)}
                      />
                    ) : (
                      <input
                        id={`${spec.id}-${field.name}`}
                        type={field.secret ? "password" : "text"}
                        autoComplete="off"
                        spellCheck={false}
                        placeholder={
                          status?.shown?.[field.name]
                            ? "leave blank to keep the current one"
                            : field.placeholder
                        }
                        value={draft[field.name] ?? ""}
                        onChange={(e) => setField(spec.id, field.name, e.target.value)}
                      />
                    )}
                    {field.hint ? <p className="provider-hint">{field.hint}</p> : null}
                  </div>
                ))}

                {spec.id === "cloudflare" ? null : (
                <div className="provider-field">
                  <label htmlFor={`${spec.id}-expiry`}>Expires on</label>
                  <DatePicker
                    id={`${spec.id}-expiry`}
                    value={dates[spec.id] ?? ""}
                    onChange={(iso) => setDates((d) => ({ ...d, [spec.id]: iso }))}
                  />
                  <p className="provider-hint">
                    Typed in because no registrar reports it. A lapsed credential
                    starts answering 401 with no other warning.
                  </p>
                </div>
                )}
              </div>

              <div className="provider-actions">
                {spec.id === "cloudflare" ? null : (
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => void submit(spec.id, "PUT")}
                    disabled={busy === spec.id || (!touched && !dateChanged)}
                  >
                    {busy === spec.id ? "Saving…" : "Save"}
                  </button>
                )}
                {status?.source === "console" ? (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => void submit(spec.id, "DELETE")}
                    disabled={busy === spec.id}
                  >
                    Remove
                  </button>
                ) : null}
                {status?.savedAt ? (
                  <span className="provider-saved">
                    Saved {new Date(status.savedAt).toLocaleDateString()}
                    {status.savedBy ? ` by ${status.savedBy}` : ""}
                  </span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
