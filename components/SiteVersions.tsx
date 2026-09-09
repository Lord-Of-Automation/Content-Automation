"use client";

import { useCallback, useEffect, useState } from "react";

import SitePreview from "@/components/SitePreview";
import type { RevisionBody, RevisionSummary } from "@/lib/revisions";
import type { Website } from "@/lib/websites";

/**
 * The site's earlier versions, and the way back to one.
 *
 * Every save keeps what it replaced, so this is a list of states the site has
 * actually been in. Restoring is itself a save, so it keeps a version too and
 * can be undone — which matters, because restoring the wrong version is the
 * usual way people lose work to a revision list.
 *
 * Each row says what the version *after* it changed, which is the question
 * being asked: not "what is in this one" but "is this the one from before I
 * broke the pricing page". A diff of HTML would answer neither.
 *
 * A version is shown by rendering it, in the same preview the editor uses. The
 * alternative is a wall of markup, and nobody recognises a version of their
 * site by its markup.
 */

const WHY: Record<RevisionSummary["reason"], string> = {
  build: "as written",
  edit: "edited",
  restore: "restored",
  claude: "before Claude's edit",
};

/** "3 minutes ago". Exact dates are in the title attribute for when it matters. */
function ago(iso: string, now: number): string {
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString();
}

export default function SiteVersions({
  site,
  /** Bumped by the editor after a save, so the list picks up the new version. */
  token,
  onRestored,
}: {
  site: Website;
  token: number;
  onRestored: (site: Website) => void;
}) {
  const [rows, setRows] = useState<RevisionSummary[] | null>(null);
  /** How many the store keeps, said by the store rather than guessed here. */
  const [keep, setKeep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [body, setBody] = useState<RevisionBody | null>(null);
  const [showing, setShowing] = useState("");
  const [busy, setBusy] = useState(false);
  /**
   * Read once per render rather than per row, and on the client only.
   *
   * "3 minutes ago" computed on the server is wrong by the time it is read, and
   * differs between the server's render and the browser's, which React reports
   * as a mismatch.
   */
  const [now, setNow] = useState(0);

  const load = useCallback(async () => {
    setError(null);
    try {
      const response = await fetch(`/api/websites/${site.id}/revisions`, { cache: "no-store" });
      if (response.status === 401) {
        window.location.href = "/login";
        return;
      }
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? `The versions returned ${response.status}.`);
      setRows(payload.revisions as RevisionSummary[]);
      setKeep(Number(payload.keep ?? 0));
    } catch (e) {
      setError(e instanceof Error ? e.message : "The versions could not be read.");
      setRows([]);
    }
  }, [site.id]);

  useEffect(() => {
    setNow(Date.now());
    void load();
  }, [load, token]);

  const open = useCallback(
    async (id: string) => {
      if (chosen === id) {
        setChosen(null);
        setBody(null);
        return;
      }
      setChosen(id);
      setBody(null);
      try {
        const response = await fetch(
          `/api/websites/${site.id}/revisions?revision=${encodeURIComponent(id)}`,
          { cache: "no-store" },
        );
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? `The version returned ${response.status}.`);
        const found = payload.revision as { body: RevisionBody };
        setBody(found.body);
        setShowing(found.body.pages[0]?.slug ?? "");
      } catch (e) {
        setError(e instanceof Error ? e.message : "That version could not be read.");
      }
    },
    [chosen, site.id],
  );

  async function restore(id: string) {
    const version = rows?.find((r) => r.id === id);
    const when = version ? new Date(version.at).toLocaleString() : "that version";
    if (!window.confirm(`Put the site back to how it was on ${when}?\n\nWhat is there now is kept as a version, so this can be undone.`)) {
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/websites/${site.id}/revisions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ revision: id }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? `The restore returned ${response.status}.`);
      onRestored(payload.website as Website);
      setChosen(null);
      setBody(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That version could not be restored.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="versions">
      {error ? <p className="notice bad">{error}</p> : null}

      <div className="version-row is-now">
        <div className="version-when">
          <strong>Now</strong>
          <span className="version-by">
            {site.updatedBy ? `${site.updatedBy}, ` : ""}
            {site.updatedAt ? ago(site.updatedAt, now) : "not saved yet"}
          </span>
        </div>
        <div className="version-what">
          <span className="version-count">
            {site.pages.length} page{site.pages.length === 1 ? "" : "s"}
          </span>
        </div>
      </div>

      {rows === null ? (
        <p className="empty">Reading the versions...</p>
      ) : !rows.length ? (
        <p className="empty">
          No earlier versions yet. Every save from here on keeps the version it
          replaces, so there will be one the next time you save.
        </p>
      ) : (
        rows.map((row) => (
          <div
            key={row.id}
            className={chosen === row.id ? "version-row is-open" : "version-row"}
          >
            <button
              type="button"
              className="version-head"
              onClick={() => void open(row.id)}
              title={new Date(row.at).toLocaleString()}
            >
              <div className="version-when">
                <strong>{ago(row.at, now)}</strong>
                <span className="version-by">
                  {row.by || "unknown"}, {WHY[row.reason]}
                </span>
              </div>
              <div className="version-what">
                {row.changed.length ? (
                  <ul className="version-changes">
                    {row.changed.slice(0, 4).map((what, i) => (
                      <li key={i}>{what}</li>
                    ))}
                    {row.changed.length > 4 ? (
                      <li className="version-more">
                        and {row.changed.length - 4} more
                      </li>
                    ) : null}
                  </ul>
                ) : (
                  <span className="version-count">no changes recorded</span>
                )}
              </div>
            </button>

            {chosen === row.id ? (
              <div className="version-open">
                {!body ? (
                  <p className="empty">Reading that version...</p>
                ) : (
                  <>
                    <div className="version-actions">
                      <span className="version-count">
                        {body.pages.length} page{body.pages.length === 1 ? "" : "s"}
                        {body.name !== site.name ? `, called ${body.name}` : ""}
                      </span>
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        disabled={busy || site.status === "building"}
                        onClick={() => void restore(row.id)}
                      >
                        {busy ? "Restoring..." : "Restore this version"}
                      </button>
                    </div>
                    <SitePreview
                      site={{
                        name: body.name,
                        tagline: body.tagline,
                        language: site.language ?? "en",
                        design: body.design,
                        header: body.header,
                        footer: body.footer,
                        theme: body.theme,
                      }}
                      pages={body.pages}
                      current={showing}
                      onNavigate={setShowing}
                    />
                  </>
                )}
              </div>
            ) : null}
          </div>
        ))
      )}

      <p className="provider-hint">
        {keep ? `The last ${keep} versions are kept, and the oldest are dropped as new ones arrive. ` : ""}
        A version is a whole copy of the site, so keeping every one forever
        would cost more storage than the site itself.
      </p>
    </div>
  );
}
