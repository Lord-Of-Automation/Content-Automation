"use client";

import { useCallback, useEffect, useState } from "react";

import { FoldBody, FoldToggle, useFold } from "@/components/Fold";

type Credential = {
  name: string;
  set: boolean;
  source: "console" | "environment" | "unset";
  hint: string;
};

/** The arrow on a group's title. Turns to point down when the group is open. */
function Chevron() {
  return (
    <svg className="keys-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

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
    title: "Game pages and screenshots",
    blurb:
      "The crawl sheet the gallery reads. One row per page of the source site; a game page is " +
      "/slots/{studio}/{game}/ and the last part is matched against the game name. Only column A " +
      "is read, so the sheet can stay as wide as the crawl exports it.",
    names: ["SHEET_GAME_CRAWL_ID"],
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
  {
    title: "Link prospects",
    blurb:
      "The list of domains a prospect checker keeps up to date, and the key for reading them. " +
      "Ahrefs is optional: a loop can ask DataForSEO instead, which is already configured, " +
      "though its rank is its own and will not match a Domain Rating. An Ahrefs API key is " +
      "billed separately from an Ahrefs seat. The sheet must be shared with the service " +
      "account with edit rights, since this one is written to and not only read.",
    names: ["SHEET_PROSPECTS_ID", "AHREFS_API_KEY"],
  },
  {
    title: "Mailing",
    blurb:
      "The Google OAuth client a mailbox is connected through. Make one at Google Auth Platform " +
      "under Clients, as a Web application, with the Gmail API enabled on the project. These two " +
      "have to be set in a second place as well — as environment variables on the console, which " +
      "is the half that runs the consent screen — and the Mailing page says which half is missing. " +
      "The refresh token itself is not here and never will be: it is written when somebody " +
      "connects an account and is not something to paste.",
    names: ["GOOGLE_MAIL_CLIENT_ID", "GOOGLE_MAIL_CLIENT_SECRET"],
  },
];

/** Long values get a textarea; a key on one line gets an input. */
const MULTILINE = new Set(["GOOGLE_SERVICE_ACCOUNT"]);

export default function KeysView() {
  const fold = useFold();
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /*
   * Which groups are open, for the ones somebody has actually clicked.
   *
   * Absent means "whatever this group would do on its own", which is open when
   * something in it is not set yet. The page is nine groups of fields and only
   * one of them is usually the reason anybody came; the ones already filled in
   * are the ones worth folding away, and they are also the ones this can
   * recognise without being told.
   */
  const [opened, setOpened] = useState<Record<string, boolean>>({});

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
    <section className={fold.className}>
      <div className="card-head">
        <span>Keys and settings</span>
        {/* The unsaved count stays visible folded or not. It is the one
            thing about this card you would want to know without opening
            it. */}
        {pending ? <span className="badge badge-waiting">{pending} unsaved</span> : null}
        <div className="spacer" />
        <FoldToggle open={fold.open} what="the keys and settings" onToggle={fold.toggle} />
      </div>

      <FoldBody>
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

              const set = rows.filter((n) => byName.get(n)!.set).length;
              const isOpen = opened[group.title] ?? set < rows.length;

              return (
                <div className={isOpen ? "keys-group is-open" : "keys-group"} key={group.title}>
                  {/* The whole title bar is the control, not just the arrow. A
                      target the width of the box is easier to hit than one
                      sixteen pixels across, and the arrow beside it is what
                      says the bar can be clicked at all. */}
                  <button
                    type="button"
                    className="keys-group-head"
                    aria-expanded={isOpen}
                    onClick={() => setOpened((was) => ({ ...was, [group.title]: !isOpen }))}
                  >
                    <h3>{group.title}</h3>
                    {/* What a folded group still tells you. Without it, a
                        closed group is a title and no information. */}
                    <span className="keys-group-count">
                      {set} of {rows.length} set
                    </span>
                    <Chevron />
                  </button>

                  <div className="keys-group-body">
                    <div>
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
                  </div>
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
      </FoldBody>
    </section>
  );
}
