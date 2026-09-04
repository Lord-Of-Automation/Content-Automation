"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import ConfirmDialog from "@/components/ConfirmDialog";

type Rrset = { name: string; type: string; ttl: number; values: string[] };

/** A Cloudflare record, which is one value per row and knows about proxying. */
type CfRecord = {
  id: string;
  type: string;
  name: string;
  content: string;
  ttl: number;
  proxied: boolean;
};

type CfZone = { id: string; name: string; status: string; nameServers: string[] };

type Zone = {
  domain: string;
  provider: string;
  nameServers: string[];
  records: Rrset[];
  authoritative: boolean;
  note: string;
};

const EDITABLE = ["A", "AAAA", "CNAME", "MX", "TXT", "SRV", "CAA"];

/**
 * The name server pairs actually in use here, so the common move is a click.
 *
 * Typing four hostnames correctly is the step where this goes wrong, and every
 * one of these estates moves between the same few hosts. Cloudflare is the
 * exception: it assigns a different pair per account, so it cannot be a preset
 * and has to be copied from the domain that already uses it.
 */
const PRESETS: Array<{ label: string; hosts: string[] }> = [
  { label: "GoDaddy default", hosts: ["ns73.domaincontrol.com", "ns74.domaincontrol.com"] },
  {
    label: "Gandi LiveDNS",
    hosts: ["ns-1.gandi.net", "ns-2.gandi.net", "ns-3.gandi.net"],
  },
];

const empty: Rrset = { name: "@", type: "A", ttl: 3600, values: [""] };

export default function DomainDns({
  domain,
  provider,
  onClose,
}: {
  domain: string;
  provider: string;
  onClose: () => void;
}) {
  const [zone, setZone] = useState<Zone | null>(null);
  /**
   * Cloudflare's zone for this domain, when it has one.
   *
   * Which DNS is the live one is not a preference, it is a fact: a domain whose
   * name servers point at Cloudflare answers from Cloudflare, and the zone the
   * registrar still keeps is read by nobody. This panel used to read and write
   * the registrar's zone regardless — so after moving a domain to Cloudflare it
   * showed the old records as though they were current, and every record added
   * here went somewhere nothing would ever ask.
   */
  const [cfZone, setCfZone] = useState<CfZone | null>(null);
  const [cfRecords, setCfRecords] = useState<CfRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [hosts, setHosts] = useState<string[]>([]);
  const [confirmNs, setConfirmNs] = useState(false);

  const [editing, setEditing] = useState<Rrset | null>(null);
  const [deleting, setDeleting] = useState<Rrset | null>(null);

  const shell = useRef<HTMLDialogElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Both, because they answer different questions. The registrar owns the
      // name servers whatever happens; Cloudflare owns the records once those
      // name servers point at it.
      const [registrar, cloudflare] = await Promise.all([
        fetch(
          `/api/domains/dns?provider=${encodeURIComponent(provider)}&domain=${encodeURIComponent(domain)}`,
          { cache: "no-store" },
        ),
        fetch(`/api/cloudflare?domain=${encodeURIComponent(domain)}`, { cache: "no-store" }),
      ]);

      if (registrar.status === 401) {
        window.location.href = "/login";
        return;
      }

      const payload = await registrar.json();
      if (!registrar.ok) throw new Error(payload.error ?? "Could not read this domain.");
      setZone(payload);
      setHosts(payload.nameServers?.length ? payload.nameServers : ["", ""]);

      if (cloudflare.ok) {
        const cf = (await cloudflare.json()) as { zone?: CfZone | null; records?: CfRecord[] };
        setCfZone(cf.zone ?? null);
        setCfRecords(cf.records ?? []);
      } else {
        // No Cloudflare credential, or it could not be asked. The registrar's
        // zone is then all there is, which is the right answer for a domain
        // that is not on Cloudflare and an honest one for a domain that is.
        setCfZone(null);
        setCfRecords([]);
      }

      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read this domain.");
    } finally {
      setLoading(false);
    }
  }, [domain, provider]);

  useEffect(() => {
    void load();
  }, [load]);

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

  async function send(init: RequestInit, done: string, url = "/api/domains/dns") {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(url, {
        ...init,
        headers: { "content-type": "application/json" },
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "That did not work.");
      setMessage(done);
      await load();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  const changed =
    zone && hosts.filter(Boolean).join("|") !== zone.nameServers.join("|");

  /**
   * Where this domain's DNS actually lives.
   *
   * A Cloudflare zone wins whenever there is one. Cloudflare only answers for a
   * domain whose name servers point at it, and once they do the registrar's
   * zone is a museum piece — which is exactly what made the old records look
   * current here and made a new record vanish into a zone nobody queries.
   */
  const onCloudflare = !!cfZone;

  /** Cloudflare stores one row per value; the rest of this panel speaks sets. */
  const asRrsets = (records: CfRecord[]): Rrset[] => {
    const sets = new Map<string, Rrset>();
    for (const r of records) {
      const key = `${r.name} ${r.type}`;
      const found = sets.get(key);
      if (found) found.values.push(r.content);
      else sets.set(key, { name: r.name, type: r.type, ttl: r.ttl, values: [r.content] });
    }
    return [...sets.values()];
  };

  const shownRecords = onCloudflare ? asRrsets(cfRecords) : (zone?.records ?? []);
  const editable = shownRecords.filter((r) => EDITABLE.includes(r.type));
  const fixed = shownRecords.filter((r) => !EDITABLE.includes(r.type));

  /** The Cloudflare row behind a set, so an edit knows which record to replace. */
  const cfIdFor = (set: Rrset): string | undefined =>
    cfRecords.find((r) => r.name === set.name && r.type === set.type)?.id;

  return (
    <dialog className="sheet" ref={shell}>
      <div className="sheet-card">
        <div className="sheet-head">
          <div>
            <h2>{domain}</h2>
            <p>
              {provider === "godaddy" ? "GoDaddy" : "Gandi"} &middot; where it
              points and what it answers
            </p>
          </div>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="sheet-body">
          {error ? <div className="notice bad">{error}</div> : null}
          {message ? <div className="notice ok">{message}</div> : null}
          {loading && !zone ? <div className="empty">Loading…</div> : null}

          {zone ? (
            <>
              {/* The single most misleading thing this screen could do is let
                  somebody edit a zone nobody reads. Gandi keeps a full LiveDNS
                  zone for a domain pointed at Cloudflare and will accept every
                  edit to it. */}
              {/* Only when the records on screen really are the dead ones. A
                  domain on Cloudflare shows Cloudflare's records, which are
                  live, and warning about the registrar's stale zone there would
                  be a warning about something nobody is looking at. */}
              {!onCloudflare && !zone.authoritative && zone.records.length ? (
                <div className="notice bad">
                  <strong>These records are not live.</strong> This domain&rsquo;s
                  name servers are {zone.nameServers.join(", ") || "elsewhere"},
                  so the internet reads its DNS from there and not from{" "}
                  {provider === "godaddy" ? "GoDaddy" : "Gandi"}. Editing below
                  changes a zone nobody queries. Change the name servers first,
                  or edit the records where they actually live.
                </div>
              ) : null}

              {/* And when Cloudflare has the zone but is not yet answering,
                  which is every domain between being added and the name servers
                  moving. The records are real; nothing reads them yet. */}
              {onCloudflare && cfZone!.status !== "active" ? (
                <div className="notice warn">
                  <strong>Cloudflare has this zone but is not answering for it
                  yet.</strong> Its status is {cfZone!.status}, which means the
                  name servers below still have to become{" "}
                  {cfZone!.nameServers.join(" and ")}. Records edited here are
                  kept and take effect the moment that happens.
                </div>
              ) : null}

              <section className="sheet-section">
                <h3>Name servers</h3>
                <p className="stage-hint">
                  Where the world asks for this domain&rsquo;s DNS. Changing them
                  moves the site and its email together, and resolvers keep the
                  old answer for up to two days.
                </p>

                {hosts.map((host, at) => (
                  <input
                    key={at}
                    type="text"
                    className="mono ns-input"
                    spellCheck={false}
                    placeholder={at < 2 ? "ns1.example.com" : "optional"}
                    value={host}
                    onChange={(e) =>
                      setHosts((current) =>
                        current.map((h, i) => (i === at ? e.target.value : h)),
                      )
                    }
                  />
                ))}

                <div className="sheet-actions">
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => setHosts((c) => [...c, ""])}
                    disabled={hosts.length >= 6}
                  >
                    Add another
                  </button>
                  {PRESETS.map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => setHosts(preset.hosts)}
                    >
                      {preset.label}
                    </button>
                  ))}
                  <button
                    type="button"
                    className="btn btn-danger"
                    disabled={busy || !changed}
                    onClick={() => setConfirmNs(true)}
                  >
                    Change name servers
                  </button>
                </div>
              </section>

              <section className="sheet-section">
                <h3>
                  DNS records
                  <span className="dns-where">
                    {onCloudflare
                      ? "on Cloudflare"
                      : `at ${provider === "godaddy" ? "GoDaddy" : "Gandi"}`}
                  </span>
                </h3>
                {onCloudflare ? (
                  <p className="stage-hint">
                    Read from and written to Cloudflare, because that is where
                    this domain&rsquo;s DNS lives. The registrar still keeps an
                    old copy of the zone and nothing reads it.
                  </p>
                ) : zone.note ? (
                  <p className="stage-hint">{zone.note}</p>
                ) : (
                  <p className="stage-hint">
                    One row per name and type. Saving a row replaces every value
                    it holds, which is what a record set means.
                  </p>
                )}

                {editable.length || fixed.length ? (
                  <table className="logs">
                    <thead>
                      <tr>
                        <th>Type</th>
                        <th>Name</th>
                        <th>Value</th>
                        <th className="num">TTL</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {[...editable, ...fixed].map((r) => {
                        const locked = !EDITABLE.includes(r.type);
                        return (
                          <tr key={`${r.type}-${r.name}`}>
                            <td>
                              <span className="registrar">{r.type}</span>
                            </td>
                            <td className="nowrap">{r.name}</td>
                            <td className="detail">
                              {r.values.map((v) => (
                                <div className="rr-value" key={v}>
                                  {v}
                                </div>
                              ))}
                            </td>
                            <td className="num">{r.ttl}</td>
                            <td className="nowrap">
                              {locked ? (
                                <span className="quiet">
                                  {r.type === "NS" ? "above" : "read only"}
                                </span>
                              ) : (
                                <>
                                  <button
                                    type="button"
                                    className="btn btn-ghost btn-sm"
                                    onClick={() => setEditing({ ...r })}
                                  >
                                    Edit
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-ghost btn-sm"
                                    onClick={() => setDeleting(r)}
                                  >
                                    Delete
                                  </button>
                                </>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                ) : (
                  <div className="empty">No records here.</div>
                )}

                <div className="sheet-actions">
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => setEditing({ ...empty })}
                  >
                    Add a record
                  </button>
                </div>
              </section>
            </>
          ) : null}
        </div>
      </div>

      {editing ? (
        <RecordEditor
          record={editing}
          busy={busy}
          onCancel={() => setEditing(null)}
          onSave={async (next) => {
            // Written where the domain actually answers from. Sending this to
            // the registrar while the name servers point at Cloudflare is how a
            // new record ends up invisible.
            const ok = onCloudflare
              ? await send(
                  {
                    method: "PUT",
                    body: JSON.stringify({
                      domain,
                      zoneId: cfZone!.id,
                      recordId: cfIdFor(next),
                      record: {
                        type: next.type,
                        name: next.name,
                        content: next.values[0] ?? "",
                        ttl: next.ttl,
                      },
                    }),
                  },
                  `Saved ${next.type} ${next.name} on Cloudflare.`,
                  "/api/cloudflare",
                )
              : await send(
                  {
                    method: "PUT",
                    body: JSON.stringify({ provider, domain, rrset: next }),
                  },
                  `Saved ${next.type} ${next.name}.`,
                );
            if (ok) setEditing(null);
          }}
        />
      ) : null}

      <ConfirmDialog
        open={confirmNs}
        title={`Change name servers for ${domain}?`}
        confirmLabel="Change them"
        busyLabel="Changing…"
        cancelLabel="Cancel"
        busy={busy}
        onDismiss={() => setConfirmNs(false)}
        body={
          <>
            <p>
              <strong>Now:</strong> {zone?.nameServers.join(", ") || "none"}
            </p>
            <p>
              <strong>After:</strong> {hosts.filter(Boolean).join(", ")}
            </p>
            <p className="confirm-warn">
              This moves the website and its email together. Resolvers keep the
              old answer for up to 48 hours, so it will look unchanged for a
              while and then switch.
            </p>
          </>
        }
        onConfirm={async () => {
          const ok = await send(
            {
              method: "PUT",
              body: JSON.stringify({ provider, domain, nameServers: hosts.filter(Boolean) }),
            },
            "Name servers changed. It can take up to 48 hours to take effect everywhere.",
          );
          if (ok) setConfirmNs(false);
        }}
      />

      <ConfirmDialog
        open={!!deleting}
        title={`Delete ${deleting?.type} ${deleting?.name}?`}
        confirmLabel="Delete it"
        busyLabel="Deleting…"
        cancelLabel="Keep it"
        busy={busy}
        onDismiss={() => setDeleting(null)}
        body={
          <>
            <p>
              Every value on this record goes:{" "}
              <strong>{deleting?.values.join(", ")}</strong>
            </p>
            <p className="confirm-warn">
              Whatever depends on it stops resolving once the old answer expires.
            </p>
          </>
        }
        onConfirm={async () => {
          const ok = onCloudflare
            ? await send(
                {
                  method: "PUT",
                  body: JSON.stringify({
                    domain,
                    zoneId: cfZone!.id,
                    recordId: deleting ? cfIdFor(deleting) : undefined,
                    remove: true,
                  }),
                },
                `Deleted ${deleting?.type} ${deleting?.name} on Cloudflare.`,
                "/api/cloudflare",
              )
            : await send(
                {
                  method: "DELETE",
                  body: JSON.stringify({
                    provider,
                    domain,
                    name: deleting?.name,
                    type: deleting?.type,
                  }),
                },
                `Deleted ${deleting?.type} ${deleting?.name}.`,
              );
          if (ok) setDeleting(null);
        }}
      />
    </dialog>
  );
}

/** One record set, being written. Values are one per line, as a zone file has them. */
function RecordEditor({
  record,
  busy,
  onSave,
  onCancel,
}: {
  record: Rrset;
  busy: boolean;
  onSave: (next: Rrset) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<Rrset>(record);
  const [text, setText] = useState(record.values.join("\n"));

  return (
    <div className="sheet-editor">
      <div className="sheet-editor-card">
        <h3>{record.values[0] === "" ? "Add a record" : `Edit ${record.type} ${record.name}`}</h3>

        <div className="provider-fields">
          <div className="provider-field">
            <label htmlFor="rr-type">Type</label>
            <select
              id="rr-type"
              value={draft.type}
              onChange={(e) => setDraft({ ...draft, type: e.target.value })}
            >
              {EDITABLE.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>

          <div className="provider-field">
            <label htmlFor="rr-name">Name</label>
            <input
              id="rr-name"
              type="text"
              className="mono"
              spellCheck={false}
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
            <p className="provider-hint">@ for the domain itself, or a label like www.</p>
          </div>

          <div className="provider-field">
            <label htmlFor="rr-ttl">TTL, in seconds</label>
            <input
              id="rr-ttl"
              type="number"
              min={300}
              max={604800}
              value={draft.ttl}
              onChange={(e) => setDraft({ ...draft, ttl: Number(e.target.value) })}
            />
            <p className="provider-hint">How long resolvers keep it. 3600 is an hour.</p>
          </div>
        </div>

        <div className="provider-field" style={{ marginTop: 12 }}>
          <label htmlFor="rr-values">Value</label>
          <textarea
            id="rr-values"
            className="mono"
            rows={3}
            spellCheck={false}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <p className="provider-hint">
            One per line for several. MX and SRV take their priority in front:
            &ldquo;10 mail.example.com&rdquo;.
          </p>
        </div>

        <div className="sheet-actions">
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || !text.trim()}
            onClick={() =>
              onSave({
                ...draft,
                values: text
                  .split("\n")
                  .map((v) => v.trim())
                  .filter(Boolean),
              })
            }
          >
            {busy ? "Saving…" : "Save record"}
          </button>
        </div>
      </div>
    </div>
  );
}
