"use client";

import { useEffect, useRef, useState } from "react";

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
 * Changing an application's primary domain.
 *
 * Two clicks rather than one, and the second one shows the change written out
 * in full. This is not a form where a typo costs a correction: the primary
 * domain is what the web server answers to, and pointing a live site at a name
 * that does not resolve takes it off the internet until somebody notices.
 *
 * It does not close on success. Two things follow a domain change that this
 * cannot do — the certificate has to be reissued for the new name, and the
 * WordPress database may still hold the old one — and closing the dialog on a
 * green tick is how both get forgotten.
 */
export default function AppDomain({
  app,
  onClose,
  onDone,
}: {
  app: App;
  onClose: () => void;
  onDone: () => void;
}) {
  const [domain, setDomain] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
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

  return (
    <dialog className="sheet sheet-narrow" ref={shell}>
      <div className="sheet-card">
        <div className="sheet-head">
          <div>
            <h2>Primary domain</h2>
            <p>{app.domain || app.label}</p>
          </div>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              if (result?.changed) onDone();
              else onClose();
            }}
          >
            {result?.changed ? "Done" : "Cancel"}
          </button>
        </div>

        <div className="sheet-body">
          {error ? <div className="notice bad">{error}</div> : null}

          {result ? (
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
            </>
          )}
        </div>
      </div>
    </dialog>
  );
}
