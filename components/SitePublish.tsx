"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { Select } from "@/components/Select";
import type { PublishedTo, Website } from "@/lib/websites";

/**
 * Sending a generated site to a host this console is connected to.
 *
 * The route is WordPress rather than a host's own API, because WordPress is the
 * one thing every connected host has in common. Cloudways offers nothing that
 * will take a file — its API manages applications, not their contents — and
 * Hostinger's file endpoints only reach Hostinger's own sites. Nearly every
 * application on both is running WordPress, and WordPress has had a write API
 * in core for years.
 *
 * The console drives the publish a page at a time rather than handing the whole
 * site to one request. A dozen pages is a dozen round trips to somebody else's
 * server, which outlives a serverless function; and going one at a time means
 * this can say which page it is on, and can stop in a known place rather than
 * failing as a whole.
 *
 * Drafts are the default. Publishing writes to a site somebody else's traffic
 * depends on, and the difference between "have a look at these" and "these are
 * live now" should be a decision rather than a default.
 */

interface Target {
  key: string;
  host: string;
  label: string;
  address: string;
  domain: string;
  platform: string;
  place: string;
  ready: boolean;
  username: string;
  readable: boolean;
}

interface Check {
  name: string;
  description: string;
  who: string;
  canPublish: boolean;
  canKeepMarkup: boolean;
  home: string;
}

interface Done {
  slug: string;
  title: string;
  id: number;
  link: string;
  created: boolean;
  warnings: string[];
}

const HOST_LABEL: Record<string, string> = {
  cloudways: "Cloudways",
  hostinger: "Hostinger",
};

export default function SitePublish({
  site,
  onPublished,
}: {
  site: Website;
  onPublished: (site: Website) => void;
}) {
  const [targets, setTargets] = useState<Target[] | null>(null);
  const [sources, setSources] = useState<Array<{ label: string; ok: boolean; note: string }>>([]);
  const [chosen, setChosen] = useState("");
  const [live, setLive] = useState(false);
  const [withDesign, setWithDesign] = useState(true);
  const [asFront, setAsFront] = useState(false);

  const [check, setCheck] = useState<Check | null>(null);
  const [checking, setChecking] = useState(false);
  const [running, setRunning] = useState(false);
  const [at, setAt] = useState("");
  const [done, setDone] = useState<Done[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/websites/${site.id}/publish`, { cache: "no-store" });
      if (response.status === 401) {
        window.location.href = "/login";
        return;
      }
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? `The hosts returned ${response.status}.`);
      setTargets(payload.targets as Target[]);
      setSources(payload.sources ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The connected hosts could not be read.");
      setTargets([]);
    }
  }, [site.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const target = useMemo(
    () => targets?.find((t) => t.key === chosen) ?? null,
    [targets, chosen],
  );

  /** Everything published before is what a repeat publish will update. */
  const previous: PublishedTo | null = site.published;

  async function step(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await fetch(`/api/websites/${site.id}/publish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address: target?.address, ...body }),
    });
    if (response.status === 401 && !response.headers.get("content-type")?.includes("json")) {
      window.location.href = "/login";
      throw new Error("Signed out.");
    }
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? `That step returned ${response.status}.`);
    return payload;
  }

  async function verify() {
    if (!target) return;
    setChecking(true);
    setError(null);
    setCheck(null);
    try {
      const payload = await step({ step: "check" });
      setCheck(payload.check as Check);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That site could not be reached.");
    } finally {
      setChecking(false);
    }
  }

  async function publish() {
    if (!target) return;
    setRunning(true);
    setError(null);
    setDone([]);
    setFinished(false);

    const made: Done[] = [];
    try {
      for (const page of site.pages) {
        setAt(page.title);
        const payload = await step({
          step: "page",
          slug: page.slug,
          status: live ? "publish" : "draft",
          withDesign,
        });
        const result = payload.page as Done;
        made.push(result);
        setDone([...made]);
      }

      // The front page, if asked for, and only after every page exists.
      const front = made.find((row) => row.slug === (site.pages[0]?.slug || row.slug));
      if (asFront && front) {
        setAt("Pointing the front page at it");
        await step({ step: "front", frontPageId: front.id });
      }

      setAt("Writing it down");
      const payload = await step({
        step: "finish",
        host: target.host,
        label: target.label,
        status: live ? "publish" : "draft",
        withDesign,
        pages: Object.fromEntries(made.map((row) => [row.slug, row.id])),
      });
      onPublished(payload.website as Website);
      setFinished(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The site could not be published.");
    } finally {
      setRunning(false);
      setAt("");
    }
  }

  const ready = Boolean(target?.ready && target?.readable);

  return (
    <div className="publish">
      {error ? <p className="notice bad">{error}</p> : null}

      {previous ? (
        <p className="notice ok">
          Last published to <strong>{previous.label}</strong>{" "}
          {new Date(previous.at).toLocaleString()} by {previous.by}, as{" "}
          {previous.status === "publish" ? "live pages" : "drafts"}. Publishing
          to the same place again updates those pages rather than making new
          ones.
        </p>
      ) : null}

      <div className="publish-grid">
        <div className="publish-choice">
          <label className="field-label" htmlFor="publish-target">
            Where it goes
          </label>
          {targets === null ? (
            <p className="empty">Reading the connected hosts...</p>
          ) : !targets.length ? (
            <p className="empty">
              No applications found on the connected hosts. Add a host on the
              Keys page, or check the Applications page for what went wrong.
            </p>
          ) : (
            <Select
              id="publish-target"
              value={chosen}
              onChange={(value) => {
                setChosen(value);
                setCheck(null);
                setDone([]);
                setFinished(false);
              }}
              options={[
                { value: "", label: "Choose an application", hint: "" },
                ...targets.map((t) => ({
                  value: t.key,
                  label: t.label,
                  hint:
                    `${HOST_LABEL[t.host] ?? t.host} · ${t.domain || t.address}` +
                    (t.ready ? "" : " · no login saved"),
                })),
              ]}
            />
          )}

          {target && !target.ready ? (
            <p className="notice warn">
              No WordPress login is saved for <strong>{target.domain}</strong>.
              Add one on the Sites page, using an application password from that
              site&apos;s Users screen rather than the login password.
            </p>
          ) : null}

          {target && target.ready && !target.readable ? (
            <p className="notice bad">
              The saved password for {target.domain} can no longer be read,
              which happens when the signing secret changes. Save it again on
              the Sites page.
            </p>
          ) : null}

          {ready ? (
            <>
              <div className="publish-options">
                <label className="check">
                  <input
                    type="checkbox"
                    checked={live}
                    onChange={(e) => setLive(e.target.checked)}
                  />
                  <span>Publish live rather than as drafts</span>
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={withDesign}
                    onChange={(e) => setWithDesign(e.target.checked)}
                  />
                  <span>Bring the generated design</span>
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={asFront}
                    onChange={(e) => setAsFront(e.target.checked)}
                  />
                  <span>Make the first page the site&apos;s front page</span>
                </label>
              </div>

              <p className="provider-hint">
                {withDesign
                  ? "The design travels as a stylesheet inside each page, confined to the published content so it cannot restyle the rest of the site."
                  : "Without the design, the pages take on the look of the site they are joining, which is usually what you want when adding pages to a site that already exists."}
              </p>
              {asFront ? (
                <p className="notice warn">
                  Changing the front page changes what visitors see when they
                  type the domain. This is the one setting here that touches the
                  rest of the site.
                </p>
              ) : null}

              <div className="publish-actions">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => void verify()}
                  disabled={checking || running}
                >
                  {checking ? "Checking..." : "Check the site"}
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => void publish()}
                  disabled={running || !check}
                  title={check ? undefined : "Check the site first"}
                >
                  {running
                    ? "Publishing..."
                    : `Publish ${site.pages.length} page${site.pages.length === 1 ? "" : "s"}`}
                </button>
              </div>
            </>
          ) : null}
        </div>

        <div className="publish-report">
          {check ? (
            <div className="publish-check">
              <h4>{check.name || target?.domain}</h4>
              {check.description ? <p className="provider-hint">{check.description}</p> : null}
              <ul className="publish-facts">
                <li>Signed in as {check.who}</li>
                <li className={check.canPublish ? "" : "is-warn"}>
                  {check.canPublish
                    ? "May publish pages"
                    : "May only write drafts, so live publishing will be refused"}
                </li>
                <li className={check.canKeepMarkup ? "" : "is-warn"}>
                  {check.canKeepMarkup
                    ? "May keep styles in page content"
                    : "May not keep styles, so the generated design will be stripped by WordPress"}
                </li>
              </ul>
            </div>
          ) : null}

          {running || done.length ? (
            <ol className="publish-pages">
              {done.map((row) => (
                <li key={row.slug || "front"}>
                  <span className="publish-page-title">{row.title}</span>
                  <span className="publish-page-what">
                    {row.created ? "created" : "updated"}
                    {row.warnings.length ? `, ${row.warnings.length} warning` : ""}
                  </span>
                  {row.link ? (
                    <a href={row.link} target="_blank" rel="noopener noreferrer">
                      Open
                    </a>
                  ) : null}
                </li>
              ))}
              {at ? (
                <li className="is-running">
                  <span className="publish-page-title">{at}</span>
                  <span className="publish-page-what">working</span>
                </li>
              ) : null}
            </ol>
          ) : null}

          {finished ? (
            <p className="notice ok">
              Done. {done.length} page{done.length === 1 ? "" : "s"}{" "}
              {live ? "are live" : "are waiting as drafts"} on{" "}
              {check?.name || target?.domain}.
            </p>
          ) : null}

          {done.some((row) => row.warnings.length) ? (
            <div className="publish-warnings">
              {done.flatMap((row) =>
                row.warnings.map((what, i) => (
                  <p className="provider-hint" key={`${row.slug}-${i}`}>
                    {row.title}: {what}
                  </p>
                )),
              )}
            </div>
          ) : null}
        </div>
      </div>

      {sources.some((s) => !s.ok) ? (
        <div className="publish-sources">
          {sources
            .filter((s) => !s.ok)
            .map((s) => (
              <p className="provider-hint" key={s.label}>
                {s.label} could not be read: {s.note}
              </p>
            ))}
        </div>
      ) : null}

      <p className="provider-hint">
        Publishing writes the pages into WordPress on the site you choose, which
        is the one route every connected host has in common. Cloudways offers no
        way to send it files, so a generated site goes there as WordPress pages
        or not at all. The download is still there for anything else.
      </p>
    </div>
  );
}
