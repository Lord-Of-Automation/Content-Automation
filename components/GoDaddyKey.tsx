"use client";

import { useCallback, useEffect, useState } from "react";

type Status = {
  set: boolean;
  source: "console" | "environment" | "unset";
  tail: string;
  expiresAt: string | null;
  daysLeft: number | null;
  savedAt: string | null;
  savedBy: string | null;
  readable: boolean;
};

/**
 * How loudly to say the token is running out.
 *
 * Thirty days because reissuing one is a five-minute job somebody has to
 * remember to do, and nothing warns them: GoDaddy sends no notice and reports
 * no expiry through the API. The first symptom otherwise is the Domains page
 * saying the credential was refused, on a token nobody has touched.
 */
function expiryNote(days: number | null): { text: string; tone: string } | null {
  if (days === null) return null;
  if (days < 0) {
    return { text: `expired ${Math.abs(days)} days ago`, tone: "bad" };
  }
  if (days <= 30) return { text: `expires in ${days} days`, tone: "bad" };
  if (days <= 90) return { text: `expires in ${days} days`, tone: "warn" };
  return { text: `expires in ${days} days`, tone: "ok" };
}

export default function GoDaddyKey() {
  const [status, setStatus] = useState<Status | null>(null);
  const [token, setToken] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/keys/godaddy", { cache: "no-store" });
      if (response.status === 401) {
        window.location.href = "/login";
        return;
      }
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Could not read the token status.");
      setStatus(payload);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read the token status.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit(method: "PUT" | "DELETE") {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const response = await fetch("/api/keys/godaddy", {
        method,
        headers: { "content-type": "application/json" },
        body: method === "PUT" ? JSON.stringify({ token, expiresAt }) : undefined,
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "That did not work.");

      setStatus(payload);
      setToken("");
      setMessage(
        method === "PUT"
          ? `Saved. The Domains page uses it from the next request; no redeploy needed.`
          : "Removed. The environment variable takes over again, if one is set.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  const note = expiryNote(status?.daysLeft ?? null);

  return (
    <section className="card">
      <div className="card-head">
        <span>GoDaddy</span>
        {status?.set ? (
          <span className="stage-tag">
            {status.source === "console" ? "set here" : "from the environment"}
            {status.tail ? ` · ends ${status.tail}` : ""}
          </span>
        ) : (
          <span className="stage-tag">not set</span>
        )}
      </div>

      <div className="card-body">
        <p className="stage-hint" style={{ marginBottom: 16 }}>
          Lists the domains on the Domains page, and nothing else. GoDaddy issues
          these with account-wide scope, so it is encrypted here and never sent
          to the browser. Only a token beginning <code>gd_pat_</code> is
          accepted.
        </p>

        {error ? <div className="alert alert-warn">{error}</div> : null}
        {message ? <div className="alert alert-ok">{message}</div> : null}

        {status?.set && !status.readable ? (
          <div className="alert alert-warn">
            <strong>The stored token cannot be read.</strong> AUTH_SECRET has
            changed since it was saved, so it is no longer decryptable. Paste it
            again below.
          </div>
        ) : null}

        {note ? (
          <div className={note.tone === "ok" ? "alert alert-ok" : `alert alert-${note.tone}`}>
            This token {note.text}
            {status?.expiresAt ? ` (${new Date(status.expiresAt).toLocaleDateString()})` : ""}.
            {note.tone === "ok"
              ? " Nothing warns you when it lapses, so the date is recorded here."
              : " Issue a new one in GoDaddy under Account, API Keys, then paste it below."}
          </div>
        ) : null}

        <div style={{ marginBottom: 14 }}>
          <label htmlFor="godaddy-token" style={{ display: "block", marginBottom: 5 }}>
            <code style={{ fontSize: 12.5 }}>Personal Access Token</code>
          </label>
          <input
            id="godaddy-token"
            type="password"
            autoComplete="off"
            placeholder={status?.set ? "leave blank to keep the current one" : "gd_pat_…"}
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
        </div>

        <div style={{ marginBottom: 14 }}>
          <label htmlFor="godaddy-expiry" style={{ display: "block", marginBottom: 5 }}>
            <code style={{ fontSize: 12.5 }}>Expires on</code>
          </label>
          <input
            id="godaddy-expiry"
            type="date"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
          />
          <p className="stage-hint" style={{ margin: "5px 0 0" }}>
            GoDaddy does not report this anywhere, so it is typed in. A token
            that lapses starts answering 401 with no other warning, which reads
            as a broken key rather than an expired one.
          </p>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void submit("PUT")}
            disabled={busy || !token.trim()}
          >
            {busy ? "Saving…" : "Save token"}
          </button>
          {status?.source === "console" ? (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => void submit("DELETE")}
              disabled={busy}
            >
              Remove
            </button>
          ) : null}
        </div>

        {status?.savedAt ? (
          <p className="stage-hint" style={{ marginTop: 12 }}>
            Saved {new Date(status.savedAt).toLocaleString()}
            {status.savedBy ? ` by ${status.savedBy}` : ""}.
          </p>
        ) : null}
      </div>
    </section>
  );
}
