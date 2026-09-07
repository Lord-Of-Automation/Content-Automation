"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Select } from "@/components/Select";

type Installable = { application: string; version: string; label: string };
type Server = { id: string; label: string; status: string; ip: string; apps: number };
type Created = {
  operationId: string;
  app: { id: string; label: string; stagingUrl: string; platformLabel: string } | null;
  label: string;
  serverLabel: string;
};

/**
 * Installing a new application.
 *
 * The gentle sibling of the domain change. Nothing existing is touched,
 * Cloudways bills per server rather than per application, and one created by
 * mistake can be deleted — so this asks once and gets on with it rather than
 * making anyone confirm twice.
 *
 * What it does insist on is telling the truth about time. Cloudways builds an
 * application in the background and can take longer than a browser will wait,
 * so "still building" is a real outcome here and gets said plainly instead of
 * being dressed up as a failure.
 */
export default function NewApplication({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: () => void;
}) {
  const [installable, setInstallable] = useState<Installable[]>([]);
  const [servers, setServers] = useState<Server[]>([]);
  const [serverId, setServerId] = useState("");
  const [choice, setChoice] = useState("");
  const [label, setLabel] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<Created | null>(null);
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

  const loadCatalogue = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/apps?catalogue=1", { cache: "no-store" });
      if (response.status === 401) {
        window.location.href = "/login";
        return;
      }
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? `The catalogue returned ${response.status}.`);

      const list = (payload.installable ?? []) as Installable[];
      const hosts = (payload.servers ?? []) as Server[];
      setInstallable(list);
      setServers(hosts);

      // Preselected when there is nothing to decide, which is the common case
      // for the application and never for the server.
      if (hosts.length === 1) setServerId(hosts[0].id);
      const wordpress = list.find((i) => i.application === "wordpress") ?? list[0];
      if (wordpress) setChoice(`${wordpress.application}|${wordpress.version}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The catalogue could not be read.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCatalogue();
  }, [loadCatalogue]);

  async function create() {
    setBusy(true);
    setError(null);
    const [application, version] = choice.split("|");
    try {
      const response = await fetch("/api/apps", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ serverId, application, version, label }),
      });
      if (response.status === 401) {
        window.location.href = "/login";
        return;
      }
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? `The create returned ${response.status}.`);
      setCreated(payload as Created);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The application could not be created.");
    } finally {
      setBusy(false);
    }
  }

  const server = servers.find((s) => s.id === serverId);
  const ready = !!serverId && !!choice && label.trim().length > 0;

  return (
    <dialog className="sheet sheet-narrow" ref={shell}>
      <div className="sheet-card">
        <div className="sheet-head">
          <div>
            <h2>{created ? "Application created" : "New application"}</h2>
            <p>{created ? created.serverLabel : "Installed straight onto one of your servers"}</p>
          </div>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => (created ? onDone() : onClose())}
          >
            {created ? "Done" : "Cancel"}
          </button>
        </div>

        <div className="sheet-body">
          {error ? <div className="notice bad">{error}</div> : null}

          {loading ? <div className="empty">Reading the catalogue…</div> : null}

          {created ? (
            <section className="sheet-section">
              {created.app ? (
                <>
                  <div className="notice ok">
                    <strong>{created.app.label}</strong> is on{" "}
                    {created.serverLabel}, running {created.app.platformLabel}.
                  </div>
                  <h3>It already answers here</h3>
                  <p className="stage-hint">
                    Every application gets an address of its own from the start,
                    so you can open it before any domain points at it.
                  </p>
                  <p>
                    <a
                      className="btn btn-ghost btn-sm"
                      href={created.app.stagingUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      Open {created.app.stagingUrl.replace("https://", "")}
                    </a>
                  </p>
                  <p className="stage-hint">
                    To put a domain on it, use Modify on its row once the list
                    reloads.
                  </p>
                </>
              ) : (
                <div className="notice warn">
                  <strong>Cloudways is still building {created.label}.</strong>{" "}
                  The request was accepted and the application had not appeared
                  by the time this stopped waiting, which is ordinary for a new
                  install. It should show up in the list within a few minutes.
                </div>
              )}
            </section>
          ) : !loading && installable.length ? (
            <>
              <section className="sheet-section">
                <h3>Which server</h3>
                <p className="stage-hint">
                  Cloudways charges by server rather than by application, so this
                  adds nothing to the bill. What it does use is disk and memory
                  on a machine that may already be busy.
                </p>
                <Select
                  id="new-app-server"
                  value={serverId}
                  onChange={setServerId}
                  options={servers.map((s) => ({
                    value: s.id,
                    label: s.label,
                    hint: `${s.apps} app${s.apps === 1 ? "" : "s"}`,
                  }))}
                />
                {server && server.status !== "running" ? (
                  <p className="provider-hint">
                    That server is {server.status}. An application cannot be
                    installed until it is running.
                  </p>
                ) : null}
              </section>

              <section className="sheet-section">
                <h3>What to install</h3>
                <p className="stage-hint">
                  Read from Cloudways rather than listed here, so this offers
                  what your account can actually install today.
                </p>
                <Select
                  id="new-app-kind"
                  value={choice}
                  onChange={setChoice}
                  options={installable.map((i) => ({
                    value: `${i.application}|${i.version}`,
                    label: `${i.label} ${i.version}`,
                    // The raw identifier, because one name can carry more than
                    // one build and Cloudways does not say how they differ.
                    hint: i.application,
                  }))}
                />
              </section>

              <section className="sheet-section">
                <h3>Call it</h3>
                <p className="stage-hint">
                  How it is labelled in Cloudways and on this page. Most of your
                  applications are named after the domain they serve, which is
                  what makes them findable later.
                </p>
                <input
                  type="text"
                  value={label}
                  placeholder="example.com"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={50}
                  onChange={(e) => setLabel(e.target.value)}
                />

                <div className="sheet-actions">
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => void create()}
                    disabled={!ready || busy}
                  >
                    {busy ? "Creating…" : "Create application"}
                  </button>
                </div>
                {busy ? (
                  <p className="provider-hint">
                    Cloudways builds this in the background. It usually takes a
                    minute or two.
                  </p>
                ) : null}
              </section>
            </>
          ) : null}
        </div>
      </div>
    </dialog>
  );
}
