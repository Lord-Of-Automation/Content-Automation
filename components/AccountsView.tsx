"use client";

import { useCallback, useEffect, useState } from "react";
import { SkeletonLines } from "@/components/Skeleton";
import PermissionsDialog from "@/components/PermissionsDialog";
import { roleOf, type Permission } from "@/lib/permissionlist";

type Added = {
  username: string;
  password: string;
  authUsers: string;
  persisted: boolean;
  note: string;
};

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

export default function AccountsView() {
  const [accounts, setAccounts] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState<Added | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  /** What each account may do, and everything that could be granted. */
  const [permissions, setPermissions] = useState<Record<string, string[]>>({});
  const [catalogue, setCatalogue] = useState<Permission[]>([]);
  const [admin, setAdmin] = useState("");
  /** Whether any of the above is being enforced yet. See the notice below. */
  const [inCharge, setInCharge] = useState(true);
  /** The account whose permissions are open, if any. */
  const [editing, setEditing] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/accounts", { cache: "no-store" });
      if (response.status === 401) {
        window.location.href = "/login";
        return;
      }
      const payload = (await response.json()) as {
        accounts?: string[];
        permissions?: Record<string, string[]>;
        catalogue?: Permission[];
        admin?: string;
        inCharge?: boolean;
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
      setAccounts(payload.accounts ?? []);
      setPermissions(payload.permissions ?? {});
      setCatalogue(payload.catalogue ?? []);
      setAdmin(payload.admin ?? "");
      setInCharge(payload.inCharge ?? true);
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

          {/* Said here rather than discovered at the Save button. Until
              somebody holds full access nothing on this list is in force, and
              a page of permissions that are not in force has to admit it. */}
          {!loading && !inCharge ? (
            <div className="notice warn">
              Nobody has full access yet, so permissions are not in force and
              every account below can do everything. Give one account Full
              access to turn them on. From that moment it sees all the work on
              the platform and everybody else drops to the default set. Start
              with yourself.
            </div>
          ) : null}

          {loading ? (
            <SkeletonLines count={3} />
          ) : accounts.length === 0 ? (
            <div className="empty">No accounts configured.</div>
          ) : (
            <ul className="account-list">
              {accounts.map((name) => {
                const granted = permissions[name] ?? [];
                const role = roleOf(name, granted, admin);
                return (
                  <li key={name}>
                    <div className="account-row">
                      <span className="run-id">{name}</span>
                      {/* What this account could do, in one word. The list is
                          read to find the person who should not have
                          something, so the badge answers that rather than
                          counting permissions. */}
                      <span className={`account-role is-${role.tone}`}>{role.label}</span>
                      <span className="run-meta">
                        {name === admin
                          ? "everything, set by ADMIN_USER"
                          : `${granted.length} of ${catalogue.length} permissions`}
                      </span>
                      <div className="spacer" />
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => setEditing(name)}
                      >
                        Edit permissions
                      </button>
                    </div>
                  </li>
                );
              })}
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
              <div className="input-icon">
                <UserIcon />
                <input
                  id="new-username"
                  className="input-fancy"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  required
                />
              </div>
              <div className="note">
                Letters, digits, spaces, dots, underscores and hyphens. Sign-in
                ignores capitals.
              </div>
            </div>

            <div className="field">
              <label htmlFor="new-password">Password</label>
              <div className="input-icon">
                <KeyIcon />
                <input
                  id="new-password"
                  className="input-fancy"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="leave empty to generate one"
                  autoComplete="new-password"
                />
              </div>
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

      {editing ? (
        <PermissionsDialog
          user={editing}
          granted={permissions[editing] ?? []}
          catalogue={catalogue}
          onClose={() => setEditing(null)}
          onSaved={(next, nowInCharge) => {
            setPermissions(next);
            // Granting the first full access is what switches restrictions on,
            // so the notice above has to go the moment it happens.
            setInCharge(nowInCharge);
          }}
        />
      ) : null}
    </div>
  );
}
