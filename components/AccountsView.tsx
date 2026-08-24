"use client";

import { useCallback, useEffect, useState } from "react";

type Added = {
  username: string;
  password: string;
  authUsers: string;
  persisted: boolean;
  note: string;
};

export default function AccountsView() {
  const [accounts, setAccounts] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState<Added | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/accounts", { cache: "no-store" });
      if (response.status === 401) {
        window.location.href = "/login";
        return;
      }
      const payload = (await response.json()) as {
        accounts?: string[];
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
      setAccounts(payload.accounts ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load accounts.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setAdded(null);
    try {
      const response = await fetch("/api/accounts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          username,
          password: password.trim() ? password : undefined,
        }),
      });
      if (response.status === 401) {
        window.location.href = "/login";
        return;
      }
      const payload = (await response.json()) as Added & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
      setAdded(payload);
      setUsername("");
      setPassword("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add the account.");
    } finally {
      setBusy(false);
    }
  }

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      setCopied(null);
    }
  }

  return (
    <div className="stack">
      <div className="card">
        <div className="card-head">
          <div>
            <h2>Accounts</h2>
            <p>
              Everyone who can sign in. Passwords are stored only as bcrypt
              hashes and are never shown here.
            </p>
          </div>
        </div>
        <div className="card-body tight">
          {error ? <div className="notice bad">{error}</div> : null}
          {loading ? (
            <div className="empty">Loading…</div>
          ) : accounts.length === 0 ? (
            <div className="empty">No accounts configured.</div>
          ) : (
            <ul className="runs">
              {accounts.map((name) => (
                <li key={name}>
                  <div className="run" style={{ cursor: "default" }}>
                    <span className="run-id">{name}</span>
                    <span className="run-meta">can sign in</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h2>Add account</h2>
            <p>Leave the password empty and a strong one is generated for you.</p>
          </div>
        </div>
        <div className="card-body">
          <form onSubmit={submit}>
            <div className="field">
              <label htmlFor="new-username">Username</label>
              <input
                id="new-username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="niko"
                autoCapitalize="none"
                spellCheck={false}
                required
              />
              <div className="note">
                Letters, digits, spaces, dots, underscores and hyphens. Sign-in
                ignores capitals.
              </div>
            </div>

            <div className="field">
              <label htmlFor="new-password">Password</label>
              <input
                id="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="leave empty to generate one"
                autoComplete="new-password"
              />
              <div className="note">At least 10 characters if you set it yourself.</div>
            </div>

            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? "Adding…" : "Add account"}
            </button>
          </form>

          {added ? (
            <div className="added">
              <div className={added.persisted ? "notice ok" : "notice warn"}>
                {added.note}
              </div>

              <div className="field">
                <label>Credentials, shown once</label>
                <div className="limit-row">
                  <code className="pill pill-run">{added.username}</code>
                  <code className="pill pill-ok">{added.password}</code>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() =>
                      copy(`${added.username} / ${added.password}`, "creds")
                    }
                  >
                    {copied === "creds" ? "Copied" : "Copy"}
                  </button>
                </div>
                <div className="note">
                  This is the only time the password is displayed. Only its hash
                  is kept.
                </div>
              </div>

              <div className="field">
                <label>AUTH_USERS, for every other environment</label>
                <textarea readOnly rows={3} value={added.authUsers} className="mono" />
                <div className="limit-row">
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => copy(added.authUsers, "value")}
                  >
                    {copied === "value" ? "Copied" : "Copy value"}
                  </button>
                  <span className="note" style={{ margin: 0 }}>
                    Paste as the value on Vercel, then redeploy.
                  </span>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
