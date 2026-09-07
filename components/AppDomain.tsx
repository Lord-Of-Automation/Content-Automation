"use client";

import { useEffect, useRef, useState } from "react";

import { Select } from "@/components/Select";

type Server = { id: string; label: string; apps: number };

type App = {
  id: string;
  label: string;
  domain: string;
  platform: string;
  platformLabel: string;
  stagingUrl: string;
  serverId: string;
  serverLabel: string;
};

type Result = {
  requested: string;
  now: string;
  changed: boolean;
  before: string;
  operationId: string;
};

/**
 * Managing one application: its domain, a copy of it, or its removal.
 *
 * Three sections, ordered by what they cost and guarded in proportion. Cloning
 * only reads the original, so it asks once. Changing the domain is confirmed by
 * reading the change written out in full, because the mistake it invites is a
 * typo and seeing it spelled out catches one. Deleting is confirmed by typing
 * the application's name, because the mistake it invites is acting on the wrong
 * row, and only naming the thing catches that.
 *
 * None of them closes on success. A domain change leaves a certificate to
 * reissue and possibly a WordPress database still holding the old address; a
 * clone usually outlives the request that started it. Closing on a green tick
 * is how the part that still needs doing gets forgotten.
 */
export default function AppDomain({
  app,
  servers,
  onClose,
  onDone,
}: {
  app: App;
  /** Where a copy could go. Handed down rather than fetched again. */
  servers: Server[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [domain, setDomain] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  /** Typed out by hand, and checked again on the server before anything goes. */
  const [confirmName, setConfirmName] = useState("");
  const [deleted, setDeleted] = useState<{ label: string; gone: boolean } | null>(null);
  const [cloneName, setCloneName] = useState("");
  const [cloneTo, setCloneTo] = useState(app.serverId);
  const [cloned, setCloned] = useState<{
    label: string;
    serverLabel: string;
    app: { stagingUrl: string } | null;
  } | null>(null);
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

  const wanted = domain.trim().toLowerCase();
  // Deliberately loose. The server decides what is valid; this only stops the
  // confirm step arming on an obviously empty or unfinished entry.
  const plausible = wanted.length > 3 && wanted.includes(".") && !wanted.includes(" ");

  async function change() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/apps/domain", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ serverId: app.serverId, appId: app.id, domain: wanted }),
      });
      if (response.status === 401) {
        window.location.href = "/login";
        return;
      }
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? `The change returned ${response.status}.`);
      setResult(payload as Result);
      setConfirming(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The change could not be made.");
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/apps", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          serverId: app.serverId,
          appId: app.id,
          confirm: confirmName,
        }),
      });
      if (response.status === 401) {
        window.location.href = "/login";
        return;
      }
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? `The delete returned ${response.status}.`);
      setDeleted({ label: payload.label, gone: payload.gone });
    } catch (e) {
      setError(e instanceof Error ? e.message : "The application could not be deleted.");
    } finally {
      setBusy(false);
    }
  }

  async function clone() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/apps/clone", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          serverId: app.serverId,
          appId: app.id,
          label: cloneName,
          destinationServerId: cloneTo,
        }),
      });
      if (response.status === 401) {
        window.location.href = "/login";
        return;
      }
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? `The clone returned ${response.status}.`);
      setCloned(payload);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The application could not be copied.");
    } finally {
      setBusy(false);
    }
  }

  // What has to be typed to arm the delete. The domain when there is one,
  // because that is what the row is called and what anyone would recognise.
  const fullName = (app.domain || app.label).trim().toLowerCase();
  const armed = confirmName.trim().toLowerCase() === fullName;

  return (
    <dialog className="sheet sheet-narrow" ref={shell}>
      <div className="sheet-card">
        <div className="sheet-head">
          <div>
            <h2>{app.domain || app.label}</h2>
            <p>
              {app.platformLabel} on {app.serverLabel}
            </p>
          </div>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              if (result?.changed || deleted || cloned) onDone();
              else onClose();
            }}
          >
            {result?.changed || deleted || cloned ? "Done" : "Cancel"}
          </button>
        </div>

        <div className="sheet-body">
          {error ? <div className="notice bad">{error}</div> : null}

          {cloned ? (
            <section className="sheet-section">
              {cloned.app ? (
                <>
                  <div className="notice ok">
                    <strong>{cloned.label}</strong> is a copy of{" "}
                    {app.domain || app.label}, on {cloned.serverLabel}.
                  </div>
                  <p className="stage-hint">
                    It answers on its own address straight away, with no domain
                    pointed at it and nothing shared with the original.
                  </p>
                  <p>
                    <a
                      className="btn btn-ghost btn-sm"
                      href={cloned.app.stagingUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      Open the copy
                    </a>
                  </p>
                </>
              ) : (
                <div className="notice warn">
                  <strong>Cloudways is still copying {cloned.label}.</strong> A
                  clone moves every file and the whole database, which takes
                  longer than this could wait for. It will appear in the list
                  when it lands. The original was only read, so it is untouched
                  either way.
                </div>
              )}
            </section>
          ) : deleted ? (
            <section className="sheet-section">
              {deleted.gone ? (
                <div className="notice ok">
                  <strong>{deleted.label} is gone.</strong> Its files and its
                  database went with it, and this console has no way to bring
                  any of it back.
                </div>
              ) : (
                <div className="notice warn">
                  <strong>Cloudways is still removing {deleted.label}.</strong>{" "}
                  The request was accepted and the application was still listed
                  when this stopped waiting. It should disappear from the list
                  shortly.
                </div>
              )}
            </section>
          ) : result ? (
            <section className="sheet-section">
              {result.changed ? (
                <>
                  <div className="notice ok">
                    <strong>
                      {result.before || "This application"} now answers to{" "}
                      {result.now}.
                    </strong>{" "}
                    Read back from Cloudways after the change, not assumed from
                    the reply.
                  </div>
                  <h3>Two things this did not do</h3>
                  <p className="stage-hint">
                    The certificate is issued per domain, so{" "}
                    <strong>{result.now}</strong> needs a new one once its DNS
                    points at <span className="rr-value">{app.serverLabel}</span>.
                    Install it from the Cloudways SSL panel.
                  </p>
                  {app.platform.startsWith("wordpress") ? (
                    <p className="stage-hint">
                      This is WordPress, so check the site URL in its settings.
                      Cloudways rewrites the database when you press Set as
                      Primary in its own dashboard; whether it does the same for
                      an API call is undocumented, and if it did not, the site
                      will keep redirecting to{" "}
                      <strong>{result.before || "its old address"}</strong>.
                    </p>
                  ) : null}
                </>
              ) : (
                <div className="notice warn">
                  <strong>Cloudways accepted the change but it has not taken.</strong>{" "}
                  It was asked for <strong>{result.requested}</strong> and the
                  application still reads{" "}
                  <strong>{result.now || "no domain"}</strong>. That is either
                  work still queued, or a request that was accepted and ignored.
                  Check the Cloudways dashboard before trying again.
                </div>
              )}
            </section>
          ) : (
            <>
              <section className="sheet-section">
                <h3>What it answers to now</h3>
                <table className="logs">
                  <tbody>
                    <tr>
                      <td className="nowrap">Primary domain</td>
                      <td className="detail">
                        {app.domain ? (
                          <span className="rr-value">{app.domain}</span>
                        ) : (
                          <span className="quiet">none set</span>
                        )}
                      </td>
                    </tr>
                    <tr>
                      <td className="nowrap">Always answers</td>
                      <td className="detail">
                        <span className="rr-value">
                          {app.stagingUrl.replace("https://", "")}
                        </span>
                      </td>
                    </tr>
                    <tr>
                      <td className="nowrap">Server</td>
                      <td className="detail">
                        <span className="registrar">{app.serverLabel}</span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </section>

              <section className="sheet-section">
                <h3>Change it to</h3>
                <p className="stage-hint">
                  Point the domain at this server first. A primary domain that
                  does not resolve here leaves the site unreachable at the new
                  address and no longer served at the old one.
                </p>
                <input
                  type="text"
                  value={domain}
                  placeholder="example.com"
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(e) => {
                    setDomain(e.target.value);
                    // Editing after arming the confirm step disarms it, so the
                    // sentence being confirmed is always the current one.
                    setConfirming(false);
                  }}
                />

                {confirming ? (
                  <div className="notice warn">
                    <strong>
                      {app.domain || app.label} becomes {wanted}.
                    </strong>{" "}
                    The old address stops being served by this application.
                    {app.platform.startsWith("wordpress")
                      ? " Its certificate and its WordPress site URL will both need checking afterwards."
                      : " Its certificate will need reissuing afterwards."}
                  </div>
                ) : null}

                <div className="sheet-actions">
                  {confirming ? (
                    <>
                      <button
                        type="button"
                        className="btn btn-danger"
                        onClick={() => void change()}
                        disabled={busy}
                      >
                        {busy ? "Changing…" : `Yes, change it to ${wanted}`}
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => setConfirming(false)}
                        disabled={busy}
                      >
                        Back
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => setConfirming(true)}
                      disabled={!plausible || wanted === app.domain}
                    >
                      Change primary domain
                    </button>
                  )}
                </div>
              </section>

              <section className="sheet-section">
                <h3>Clone this application</h3>
                <p className="stage-hint">
                  Copies the files and the database into a new application. The
                  original is only read, so nothing about it changes. The copy
                  starts with no domain, on an address of its own.
                </p>

                {servers.length > 1 ? (
                  <Select
                    id="clone-server"
                    value={cloneTo}
                    onChange={setCloneTo}
                    options={servers.map((s) => ({
                      value: s.id,
                      label: s.id === app.serverId ? `${s.label} (same server)` : s.label,
                      hint: `${s.apps} app${s.apps === 1 ? "" : "s"}`,
                    }))}
                  />
                ) : null}

                <input
                  type="text"
                  value={cloneName}
                  placeholder={`Copy of ${app.domain || app.label}`}
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={50}
                  onChange={(e) => setCloneName(e.target.value)}
                />

                <div className="sheet-actions">
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => void clone()}
                    disabled={!cloneName.trim() || busy}
                  >
                    {busy ? "Copying…" : "Clone"}
                  </button>
                </div>
              </section>

              <section className="sheet-section sheet-danger">
                <h3>Delete this application</h3>
                <p className="stage-hint">
                  Permanent. The site, its files and its database go together,
                  and Cloudways keeps nothing this console could restore from.
                  Whatever you want to keep has to come off it first.
                </p>
                <p className="stage-hint">
                  Type <strong>{fullName}</strong> to confirm. The name is
                  checked again on the server against what this application is
                  actually called, so a page left open while things changed
                  underneath it cannot delete something else.
                </p>
                <input
                  type="text"
                  value={confirmName}
                  placeholder={fullName}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(e) => setConfirmName(e.target.value)}
                />
                <div className="sheet-actions">
                  <button
                    type="button"
                    className="btn btn-danger"
                    onClick={() => void remove()}
                    disabled={!armed || busy}
                  >
                    {busy ? "Deleting…" : "Delete permanently"}
                  </button>
                </div>
              </section>
            </>
          )}
        </div>
      </div>
    </dialog>
  );
}
