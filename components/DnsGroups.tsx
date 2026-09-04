"use client";

import { useCallback, useEffect, useState } from "react";

type GroupRecord = {
  type: string;
  name: string;
  content: string;
  ttl: number;
  proxied: boolean;
  priority?: number;
};

type Group = {
  id: string;
  name: string;
  records: GroupRecord[];
  updatedAt: string;
  updatedBy: string;
};

const TYPES = ["A", "AAAA", "CNAME", "MX", "TXT", "CAA"];

const blank = (): Group => ({
  id: "",
  name: "",
  records: [{ type: "A", name: "@", content: "", ttl: 1, proxied: true }],
  updatedAt: "",
  updatedBy: "",
});

/**
 * Named record sets, used when a domain is added to Cloudflare.
 *
 * Every site in an estate points at one of a handful of servers, and the
 * records that send it there are the same each time. Saving them once under a
 * name somebody recognises turns the four hundredth domain from four lines of
 * careful typing into one choice from a list — and a mistyped address is a
 * site that serves somebody else's page, which is the kind of mistake nobody
 * notices from the inside.
 */
export default function DnsGroups() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [starter, setStarter] = useState<Group[]>([]);
  const [draft, setDraft] = useState<Group | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/dnsgroups", { cache: "no-store" });
      if (response.status === 401) {
        window.location.href = "/login";
        return;
      }
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Could not read the groups.");
      setGroups(payload.groups ?? []);
      setStarter(payload.starter ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read the groups.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    if (!draft) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/dnsgroups", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: draft.id || undefined, name: draft.name, records: draft.records }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Could not save.");
      setGroups(payload.groups ?? []);
      setStarter([]);
      setDraft(null);
      setMessage(`Saved "${draft.name}".`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/dnsgroups", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Could not delete.");
      setGroups(payload.groups ?? []);
      setMessage("Deleted.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete.");
    } finally {
      setBusy(false);
    }
  }

  function setRecord(at: number, patch: Partial<GroupRecord>) {
    setDraft((d) =>
      d ? { ...d, records: d.records.map((r, i) => (i === at ? { ...r, ...patch } : r)) } : d,
    );
  }

  const shown = groups.length ? groups : starter;

  return (
    <section className="card">
      <div className="card-head">
        <span>DNS groups</span>
        {!draft ? (
          <button type="button" className="btn btn-ghost" onClick={() => setDraft(blank())}>
            New group
          </button>
        ) : null}
      </div>

      <div className="card-body">
        <p className="stage-hint" style={{ marginBottom: 16 }}>
          Record sets with a name, written into a zone when a domain is added to
          Cloudflare. Give them names you will recognise a year from now &mdash;
          UK server, One page server, Hostinger &mdash; because the list is what
          you choose from at the moment of adding.
        </p>

        {error ? <div className="alert alert-warn">{error}</div> : null}
        {message ? <div className="alert alert-ok">{message}</div> : null}

        {!draft ? (
          <>
            {!shown.length ? (
              <div className="empty">No groups yet.</div>
            ) : (
              shown.map((group) => (
                <div className="provider" key={group.id}>
                  <div className="provider-head">
                    <h3 className="provider-name">{group.name}</h3>
                    <span className="stage-tag">
                      {group.records.length} record{group.records.length === 1 ? "" : "s"}
                    </span>
                    {!groups.length ? <span className="stage-tag">example, not saved</span> : null}
                  </div>

                  <table className="logs">
                    <tbody>
                      {group.records.map((r, at) => (
                        <tr key={`${r.type}-${r.name}-${at}`}>
                          <td>
                            <span className="registrar">{r.type}</span>
                          </td>
                          <td className="nowrap">{r.name}</td>
                          <td className="detail">
                            <span className="rr-value">{r.content || "— not set —"}</span>
                          </td>
                          <td className="nowrap">
                            {r.proxied ? (
                              <span className="pill pill-warn">proxied</span>
                            ) : (
                              <span className="quiet">direct</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  <div className="provider-actions">
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => setDraft({ ...group, id: groups.length ? group.id : "" })}
                    >
                      Edit
                    </button>
                    {groups.length ? (
                      <button
                        type="button"
                        className="btn btn-ghost"
                        disabled={busy}
                        onClick={() => void remove(group.id)}
                      >
                        Delete
                      </button>
                    ) : null}
                    {group.updatedAt ? (
                      <span className="provider-saved">
                        Saved {new Date(group.updatedAt).toLocaleDateString()}
                        {group.updatedBy ? ` by ${group.updatedBy}` : ""}
                      </span>
                    ) : null}
                  </div>
                </div>
              ))
            )}
          </>
        ) : (
          <div className="provider">
            <div className="field">
              <label htmlFor="group-name">Group name</label>
              <input
                id="group-name"
                type="text"
                placeholder="UK server"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </div>

            <table className="logs">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Name</th>
                  <th>Value</th>
                  <th>Proxy</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {draft.records.map((r, at) => (
                  <tr key={at}>
                    <td>
                      <select value={r.type} onChange={(e) => setRecord(at, { type: e.target.value })}>
                        {TYPES.map((tt) => (
                          <option key={tt} value={tt}>
                            {tt}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        type="text"
                        className="mono"
                        value={r.name}
                        onChange={(e) => setRecord(at, { name: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        className="mono"
                        placeholder={r.type === "A" ? "203.0.113.10" : "value"}
                        value={r.content}
                        onChange={(e) => setRecord(at, { content: e.target.value })}
                      />
                    </td>
                    <td className="nowrap">
                      {/* Only where it means anything. Cloudflare will not proxy
                          a TXT or an MX, and offering the choice would suggest
                          it does something. */}
                      {["A", "AAAA", "CNAME"].includes(r.type) ? (
                        <label className="check">
                          <input
                            type="checkbox"
                            checked={r.proxied}
                            onChange={(e) => setRecord(at, { proxied: e.target.checked })}
                          />
                          on
                        </label>
                      ) : (
                        <span className="quiet">n/a</span>
                      )}
                    </td>
                    <td className="nowrap">
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={draft.records.length < 2}
                        onClick={() =>
                          setDraft({ ...draft, records: draft.records.filter((_, i) => i !== at) })
                        }
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="provider-actions">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() =>
                  setDraft({
                    ...draft,
                    records: [
                      ...draft.records,
                      { type: "A", name: "@", content: "", ttl: 1, proxied: true },
                    ],
                  })
                }
              >
                Add a record
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setDraft(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || !draft.name.trim()}
                onClick={() => void save()}
              >
                {busy ? "Saving…" : "Save group"}
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
