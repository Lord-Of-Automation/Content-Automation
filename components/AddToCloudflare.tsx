"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Group = {
  id: string;
  name: string;
  records: Array<{ type: string; name: string; content: string; ttl: number; proxied: boolean }>;
};

type Zone = { id: string; name: string; status: string; nameServers: string[] };

/**
 * Adding a domain to Cloudflare, which is three steps that people think is one.
 *
 * Cloudflare creates the zone, the records get written into it, and then the
 * name servers have to change at the registrar — and until that last step
 * happens nothing is live. The step everybody forgets is the third, so this
 * does not close on success: it shows the name servers Cloudflare wants and
 * offers to set them at the registrar there and then.
 */
export default function AddToCloudflare({
  domain,
  provider,
  onClose,
  onDone,
}: {
  domain: string;
  provider: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [groups, setGroups] = useState<Group[]>([]);
  const [groupId, setGroupId] = useState("");
  const [cfAccounts, setCfAccounts] = useState<Array<{ id: string; label: string }>>([]);
  const [accountId, setAccountId] = useState("");
  const [zone, setZone] = useState<Zone | null>(null);
  const [written, setWritten] = useState<string[]>([]);
  const [failed, setFailed] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [nsDone, setNsDone] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shell = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = shell.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    const onCancel = (e: Event) => {
      e.preventDefault();
      onClose();
    };
    dialog.addEventListener("cancel", onCancel);
    return () => dialog.removeEventListener("cancel", onCancel);
  }, [onClose]);

  const loadGroups = useCallback(async () => {
    try {
      const response = await fetch("/api/dnsgroups", { cache: "no-store" });
      if (!response.ok) return;
      const payload = (await response.json()) as { groups?: Group[] };
      setGroups(payload.groups ?? []);
    } catch {
      // A group list that will not load leaves the plain add, which still works.
    }
  }, []);

  /**
   * Which Cloudflare account to create in.
   *
   * Asked only when there is more than one, because with several configured
   * "which account" is a real question and guessing puts the domain somewhere
   * nobody intended — where it is then invisible to whoever looks for it.
   */
  const loadAccounts = useCallback(async () => {
    try {
      const response = await fetch("/api/cloudflare?accounts=1", { cache: "no-store" });
      if (!response.ok) return;
      const payload = (await response.json()) as { accounts?: Array<{ id: string; label: string }> };
      const list = payload.accounts ?? [];
      setCfAccounts(list);
      if (list.length === 1) setAccountId(list[0].id);
    } catch {
      // The server picks when the browser could not ask.
    }
  }, []);

  useEffect(() => {
    void loadGroups();
    void loadAccounts();
  }, [loadGroups, loadAccounts]);

  async function add() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/cloudflare", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          domain,
          groupId: groupId || undefined,
          accountId: accountId || undefined,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Cloudflare would not add it.");
      setZone(payload.zone);
      setWritten(payload.written ?? []);
      setFailed(payload.failed ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Cloudflare would not add it.");
    } finally {
      setBusy(false);
    }
  }

  async function pointRegistrarAtCloudflare() {
    if (!zone?.nameServers.length) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/domains/dns", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider, domain, nameServers: zone.nameServers }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "The registrar refused the change.");
      setNsDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The registrar refused the change.");
    } finally {
      setBusy(false);
    }
  }

  const chosen = groups.find((g) => g.id === groupId);

  return (
    <dialog className="sheet sheet-narrow" ref={shell}>
      <div className="sheet-card">
        <div className="sheet-head">
          <div>
            <h2>{zone ? "Added to Cloudflare" : "Add to Cloudflare"}</h2>
            <p>{domain}</p>
          </div>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              if (zone) onDone();
              else onClose();
            }}
          >
            {zone ? "Done" : "Cancel"}
          </button>
        </div>

        <div className="sheet-body">
          {error ? <div className="notice bad">{error}</div> : null}

          {!zone ? (
            <>
            {cfAccounts.length > 1 ? (
              <section className="sheet-section">
                <h3>Which Cloudflare account</h3>
                <p className="stage-hint">
                  More than one is configured, and a zone can only live in one of
                  them. Put it where whoever manages this domain will look for it.
                </p>
                <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                  {cfAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label}
                    </option>
                  ))}
                </select>
              </section>
            ) : null}

            <section className="sheet-section">
              <h3>Records to create</h3>
              <p className="stage-hint">
                A saved group is written into the new zone straight away, so the
                site answers correctly the moment Cloudflare takes over. Leave it
                blank to add the domain with only whatever Cloudflare finds for
                itself.
              </p>

              <select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
                <option value="">No records &mdash; just add the domain</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name} ({g.records.length} record
                    {g.records.length === 1 ? "" : "s"})
                  </option>
                ))}
              </select>

              {!groups.length ? (
                <p className="provider-hint">
                  No groups saved yet. They are managed on the Keys page, under
                  DNS groups.
                </p>
              ) : null}

              {chosen ? (
                <table className="logs" style={{ marginTop: 12 }}>
                  <tbody>
                    {chosen.records.map((r, at) => (
                      <tr key={`${r.type}-${r.name}-${at}`}>
                        <td>
                          <span className="registrar">{r.type}</span>
                        </td>
                        <td className="nowrap">{r.name}</td>
                        <td className="detail">
                          <span className="rr-value">{r.content}</span>
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
              ) : null}

              <div className="sheet-actions">
                <button
                  type="button"
                  className="btn btn-cloudflare"
                  onClick={() => void add()}
                  disabled={busy || (cfAccounts.length > 1 && !accountId)}
                >
                  {busy ? "Adding…" : "Add to Cloudflare"}
                </button>
              </div>
            </section>
            </>
          ) : (
            <>
              <section className="sheet-section">
                <h3>Now change the name servers</h3>
                {/* The whole reason this dialog stays open. A zone is created in
                    seconds and does nothing at all until this happens. */}
                <p className="stage-hint">
                  The zone exists and is <strong>pending</strong>. Nothing is
                  live until {domain} points at these two, at{" "}
                  {provider === "godaddy" ? "GoDaddy" : "Gandi"}.
                </p>

                <div className="ns-given">
                  {zone.nameServers.map((ns) => (
                    <span className="ns-chip" key={ns}>
                      {ns}
                    </span>
                  ))}
                </div>

                <div className="sheet-actions">
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(zone.nameServers.join("\n"));
                        setCopied(true);
                      } catch {
                        // Clipboard access is refused in some contexts. The
                        // names are on screen either way.
                        setError("Could not reach the clipboard. Copy them from above.");
                      }
                    }}
                  >
                    {copied ? "Copied" : "Copy"}
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy || nsDone}
                    onClick={() => void pointRegistrarAtCloudflare()}
                  >
                    {nsDone
                      ? "Name servers changed"
                      : busy
                        ? "Changing…"
                        : `Change them at ${provider === "godaddy" ? "GoDaddy" : "Gandi"}`}
                  </button>
                </div>

                {nsDone ? (
                  <div className="notice ok">
                    Done. Cloudflare rechecks on its own and this console asks
                    every five minutes for the next hour. The status dot turns
                    green when it activates, which is usually minutes but can be
                    longer.
                  </div>
                ) : null}
              </section>

              {written.length || failed.length ? (
                <section className="sheet-section">
                  <h3>Records</h3>
                  {written.length ? (
                    <p className="stage-hint">Written: {written.join(", ")}</p>
                  ) : null}
                  {failed.length ? (
                    <div className="notice warn">
                      <strong>Cloudflare refused some records.</strong> Usually
                      because it created its own version first, in which case the
                      Modify panel is where to correct them.
                      <ul className="cf-failed">
                        {failed.map((f) => (
                          <li key={f}>{f}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </section>
              ) : null}
            </>
          )}
        </div>
      </div>
    </dialog>
  );
}
