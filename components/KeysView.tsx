"use client";

import { useCallback, useEffect, useState } from "react";

type Credential = {
  name: string;
  set: boolean;
  source: "console" | "environment" | "unset";
  hint: string;
};

/** Grouped so the page reads as jobs rather than as an alphabet of names. */
const GROUPS: Array<{ title: string; blurb: string; names: string[] }> = [
  {
    title: "Required to run",
    blurb: "Without these a run is refused rather than started and failed.",
    names: ["DATAFORSEO_LOGIN", "DATAFORSEO_PASSWORD", "ANTHROPIC_API_KEY"],
  },
  {
    title: "Publishing",
    blurb:
      "The plugin accepts either a WordPress login that can edit posts, or this shared secret. " +
      "It is N8N_CB_SECRET in the site's wp-config.php.",
    names: ["WP_PLUGIN_KEY", "INDEXNOW_KEY"],
  },
  {
    title: "Images",
    blurb:
      "Gemini draws the two story screenshots. Studio uses the API key; Vertex uses the service " +
      "account and works from Europe, where the free Studio tier does not.",
    names: ["IMAGE_BACKEND", "GOOGLE_AI_API_KEY", "GEMINI_LOCATION", "GEMINI_IMAGE_MODEL"],
  },
  {
    title: "Game data",
    blurb:
      "Specs from the provider's own feed, and the playable demo embed. Newer Slots Launch " +
      "credentials are a key and a secret: with a secret set, every call and every embed is " +
      "signed, which becomes compulsory on 15 November 2026. The domain is the one registered " +
      "under Launch Pad → API, hostname only and no www — it is checked on both, so the live " +
      "site goes here rather than whichever host runs the engine. Embed days is how long a " +
      "signed demo URL keeps working before its page must be regenerated.",
    names: [
      "SLOTSLAUNCH_TOKEN",
      "SLOTSLAUNCH_SECRET",
      "SLOTSLAUNCH_DOMAIN",
      "SLOTSLAUNCH_EMBED_DAYS",
    ],
  },
  {
    title: "Sheets and the brief",
    blurb:
      "The service account JSON, on one line or base64. Every sheet and the brief document must " +
      "be shared with its email address.",
    names: ["GOOGLE_SERVICE_ACCOUNT", "ANTHROPIC_MODEL"],
  },
];

/** Long values get a textarea; a key on one line gets an input. */
const MULTILINE = new Set(["GOOGLE_SERVICE_ACCOUNT"]);

export default function KeysView() {
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/keys", { cache: "no-store" });
      if (response.status === 401) {
        window.location.href = "/login";
        return;
      }
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Could not read the keys.");
      setCredentials(payload.credentials ?? []);
      setError(payload.credentials?.length ? null : (payload.note ?? null));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reach the engine.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    const changes = Object.fromEntries(
      Object.entries(drafts).filter(([, v]) => v !== undefined),
    );
    if (!Object.keys(changes).length) {
      setMessage("Nothing to save.");
      return;
    }

    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const response = await fetch("/api/keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(changes),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Could not save.");

      setCredentials(payload.credentials ?? []);
      setDrafts({});
      setMessage(
        payload.changed?.length
          ? `Saved ${payload.changed.join(", ")}. In effect immediately, no restart needed.`
          : "Nothing changed.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  };

  const byName = new Map(credentials.map((c) => [c.name, c]));
  const pending = Object.keys(drafts).length;

  return (
    <section className="card">
      <div className="card-head">
        <span>Keys and settings</span>
        {pending ? <span className="badge badge-waiting">{pending} unsaved</span> : null}
      </div>

      <div className="card-body">
        <p className="stage-hint" style={{ marginBottom: 16 }}>
          These live on the engine, which is the thing that uses them. Values are never shown back
          here, so a field left blank means &ldquo;leave it as it is&rdquo;. Saving a blank over an
          existing value is done with the Clear button.
        </p>

        {error ? <div className="alert alert-warn">{error}</div> : null}
        {message ? <div className="alert alert-ok">{message}</div> : null}
        {loading ? <p className="stage-hint">Reading…</p> : null}

        {!loading && credentials.length > 0
          ? GROUPS.map((group) => {
              const rows = group.names.filter((n) => byName.has(n));
              if (!rows.length) return null;

              return (
                <div key={group.title} style={{ marginTop: 22 }}>
                  <h3 style={{ margin: "0 0 4px", fontSize: 14 }}>{group.title}</h3>
                  <p className="stage-hint" style={{ margin: "0 0 12px" }}>{group.blurb}</p>

                  {rows.map((name) => {
                    const c = byName.get(name)!;
                    const draft = drafts[name];
                    return (
                      <div key={name} style={{ marginBottom: 14 }}>
                        <label
                          htmlFor={`key-${name}`}
                          style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}
                        >
                          <code style={{ fontSize: 12.5 }}>{name}</code>
                          {c.set ? (
                            <span className="stage-tag">
                              {c.source === "console" ? "set here" : "from the environment"} ·{" "}
                              {c.hint}
                            </span>
                          ) : (
                            <span className="stage-tag">not set</span>
                          )}
                        </label>

                        <div style={{ display: "flex", gap: 8, marginTop: 5 }}>
                          {MULTILINE.has(name) ? (
                            <textarea
                              id={`key-${name}`}
                              rows={3}
                              placeholder={c.set ? "Leave blank to keep the current value" : ""}
                              value={draft ?? ""}
                              onChange={(e) =>
                                setDrafts((d) => ({ ...d, [name]: e.target.value }))
                              }
                              style={{ flex: 1, minWidth: 0, fontFamily: "inherit" }}
                            />
                          ) : (
                            <input
                              id={`key-${name}`}
                              type="text"
                              autoComplete="off"
                              spellCheck={false}
                              placeholder={c.set ? "Leave blank to keep the current value" : ""}
                              value={draft ?? ""}
                              onChange={(e) =>
                                setDrafts((d) => ({ ...d, [name]: e.target.value }))
                              }
                              style={{ flex: 1, minWidth: 0 }}
                            />
                          )}

                          {c.set ? (
                            <button
                              type="button"
                              className="btn btn-ghost"
                              title="Clear this override and fall back to the environment file"
                              onClick={() => setDrafts((d) => ({ ...d, [name]: "" }))}
                            >
                              Clear
                            </button>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })
          : null}

        {!loading && credentials.length > 0 ? (
          <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
            <button
              type="button"
              className="btn btn-primary"
              disabled={saving || !pending}
              onClick={() => void save()}
            >
              {saving ? "Saving…" : "Save changes"}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={saving || !pending}
              onClick={() => { setDrafts({}); setMessage(null); }}
            >
              Discard
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
