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

/**
 * A Cloudflare row being edited. A blank token means "keep what is stored".
 *
 * The uid exists only to be a React key. Keying on the account id instead meant
 * the key changed on every keystroke in that field, so React threw the row away
 * and built a new one between characters — the input lost focus after the first
 * letter and the field could not be filled in at all.
 */
type CfRow = {
  uid: string;
  accountId: string;
  token: string;
  existing: boolean;
  tail: string;
};

let nextRowId = 0;
const newRow = (): CfRow => ({
  uid: `row-${(nextRowId += 1)}`,
  accountId: "",
  token: "",
  existing: false,
  tail: "",
});

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
  const [cfRows, setCfRows] = useState<CfRow[] | null>(null);
  const [cfChecked, setCfChecked] = useState<CfSummary[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const apply = useCallback((payload: { providers: Spec[]; statuses: Status[] }) => {
    setSpecs(payload.providers ?? []);
    const byId: Record<string, Status> = {};
    for (const s of payload.statuses ?? []) byId[s.id] = s;
    setStatuses(byId);
    // The stored expiry seeds the picker, so opening the page and pressing Save
    // does not quietly blank a date somebody set last week.
    // Seeded from what is stored, once, so opening the page and pressing Save
    // does not blank the accounts somebody added last week.
    const cf = (payload.statuses ?? []).find((s) => s.id === "cloudflare");
    setCfRows((current) =>
      current ??
      (cf?.accounts ?? []).map((a) => ({
        uid: `row-${(nextRowId += 1)}`,
        accountId: a.accountId,
        token: "",
        existing: true,
        tail: a.tail,
      })),
    );

    setDates((current) => {
      const next = { ...current };
      for (const s of payload.statuses ?? []) {
        if (next[s.id] === undefined) next[s.id] = dateOnly(s.expiresAt);
      }
      return next;
    });
  }, []);

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
  }, [load, check]);

  function setField(provider: string, field: string, value: string) {
    setDrafts((d) => ({ ...d, [provider]: { ...(d[provider] ?? {}), [field]: value } }));
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
            : provider === "cloudflare"
              ? {
                  id: provider,
                  accounts: (cfRows ?? []).map((r) => ({
                    accountId: r.accountId,
                    token: r.token,
                  })),
                }
              : { id: provider, values: drafts[provider] ?? {}, expiresAt: dates[provider] ?? "" },
        ),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "That did not work.");

      // Reseeded from what came back, so the rows show the stored state rather
      // than whatever was typed to get there.
      if (provider === "cloudflare") {
        setCfRows(null);
        // Re-checked after saving, so the table below proves the token that was
        // just entered actually reaches something.
        void check();
      }
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
                  {(cfRows ?? []).map((row, at) => (
                    <div className="cf-row" key={row.uid}>
                      <div className="provider-field">
                        <label htmlFor={`cf-token-${at}`}>
                          API token
                          {row.existing ? (
                            <span className="provider-current">ends {row.tail}</span>
                          ) : null}
                        </label>
                        <input
                          id={`cf-token-${at}`}
                          type="password"
                          autoComplete="off"
                          spellCheck={false}
                          placeholder={
                            row.existing ? "leave blank to keep this one" : "cfut_…"
                          }
                          value={row.token}
                          onChange={(e) =>
                            setCfRows((rows) =>
                              (rows ?? []).map((r, i) =>
                                i === at ? { ...r, token: e.target.value } : r,
                              ),
                            )
                          }
                        />
                      </div>

                      <div className="provider-field">
                        <label htmlFor={`cf-acct-${at}`}>Account ID</label>
                        <input
                          id={`cf-acct-${at}`}
                          type="text"
                          className="mono"
                          spellCheck={false}
                          placeholder="32 hex characters"
                          value={row.accountId}
                          onChange={(e) =>
                            setCfRows((rows) =>
                              (rows ?? []).map((r, i) =>
                                i === at ? { ...r, accountId: e.target.value.trim() } : r,
                              ),
                            )
                          }
                        />
                      </div>

                      <button
                        type="button"
                        className="btn btn-ghost btn-sm cf-row-remove"
                        onClick={() =>
                          setCfRows((rows) => (rows ?? []).filter((_, i) => i !== at))
                        }
                      >
                        Remove
                      </button>
                    </div>
                  ))}

                  {!(cfRows ?? []).length ? (
                    <p className="provider-hint">No Cloudflare accounts yet.</p>
                  ) : null}

                  <div className="provider-actions">
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() =>
                        setCfRows((rows) => [...(rows ?? []), newRow()])
                      }
                    >
                      Add another account
                    </button>
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
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => void submit(spec.id, "PUT")}
                  disabled={
                    busy === spec.id ||
                    (spec.id !== "cloudflare" && !touched && !dateChanged)
                  }
                >
                  {busy === spec.id ? "Saving…" : "Save"}
                </button>
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
