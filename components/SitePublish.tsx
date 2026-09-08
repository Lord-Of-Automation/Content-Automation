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

/**
 * This console, as WordPress will record it.
 *
 * Fixed rather than generated per install: WordPress shows it beside every
 * password it issues, and one stable name means a site's list reads as "the
 * console" rather than as a row of unrelated strangers.
 */
const APP_ID = "6f2a1c74-9d3e-4b58-8c21-0a7e5f1d9b40";

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
  /**
   * How much of the target's theme the published pages keep.
   *
   * One choice rather than a row of checkboxes, because the three answers are
   * three different intentions and two of them could otherwise be ticked at
   * once. "Theme" is adding pages to a site that should go on looking like
   * itself; "canvas" is putting a generated site somewhere, where the WordPress
   * underneath is a host and not a look.
   */
  const [fit, setFit] = useState<"theme" | "inside" | "canvas">("canvas");
  const [asFront, setAsFront] = useState(false);
  /** Whether the design may escape the column the theme puts content in. */
  const [fullWidth, setFullWidth] = useState(false);

  const withDesign = fit !== "theme";

  const [check, setCheck] = useState<Check | null>(null);
  const [checking, setChecking] = useState(false);
  const [running, setRunning] = useState(false);
  const [at, setAt] = useState("");
  const [done, setDone] = useState<Done[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);
  /** The manual way in, for a site where the one-click flow will not run. */
  const [byHand, setByHand] = useState(false);
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);

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

  /*
   * What WordPress said when it sent the browser back.
   *
   * Read once and then wiped from the address, so a reload does not repeat a
   * message about something that happened before it.
   */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const came = params.get("connected");
    if (!came) return;

    setNote(
      came === "declined"
        ? "That site was not authorised, so nothing was saved."
        : came === "incomplete" || came === "nodomain" || came === "failed"
          ? "WordPress sent the browser back without a usable password. Add the login by hand instead."
          : `Connected to ${came}. It can be published to now.`,
    );

    params.delete("connected");
    const rest = params.toString();
    window.history.replaceState(
      {},
      "",
      window.location.pathname + (rest ? `?${rest}` : ""),
    );
  }, []);

  const target = useMemo(
    () => targets?.find((t) => t.key === chosen) ?? null,
    [targets, chosen],
  );

  /** Everything published before is what a repeat publish will update. */
  const previous: PublishedTo | null = site.published;

  async function step(
    body: Record<string, unknown>,
    /** Where to send it, when the caller has just learned somewhere better. */
    to?: string,
  ): Promise<Record<string, unknown>> {
    /*
     * Where the site says it lives, once it has been asked.
     *
     * An application reached on its staging address may believe it lives on a
     * custom domain, and answer a request to the staging address with a
     * redirect to that domain. Redirects across origins drop the Authorization
     * header, so the pages would arrive unauthenticated. Asking first and then
     * addressing the site by its own name avoids the redirect entirely.
     */
    const address = to || check?.home || target?.address;

    const response = await fetch(`/api/websites/${site.id}/publish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address, ...body }),
    });
    if (response.status === 401 && !response.headers.get("content-type")?.includes("json")) {
      window.location.href = "/login";
      throw new Error("Signed out.");
    }
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? `That step returned ${response.status}.`);
    return payload;
  }

  /**
   * Ask the site who we are and what we may do there.
   *
   * Addressed to the target as the host names it, since that is all there is to
   * go on until the site answers with a name of its own.
   */
  async function runCheck(): Promise<Check> {
    const response = await fetch(`/api/websites/${site.id}/publish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address: target!.address, step: "check" }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? `The check returned ${response.status}.`);
    const found = payload.check as Check;
    setCheck(found);
    return found;
  }

  async function verify() {
    if (!target) return;
    setChecking(true);
    setError(null);
    setCheck(null);
    try {
      await runCheck();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That site could not be reached.");
    } finally {
      setChecking(false);
    }
  }

  /**
   * Ask WordPress for a password, on the site itself.
   *
   * Sends the browser to that site's own authorisation screen, where somebody
   * signed in there approves this console by name and WordPress mints an
   * application password. It comes back to a callback that saves it. The
   * alternative is asking a person to open an admin screen on each of three
   * hundred applications and copy a string, which nobody is going to do.
   */
  function connect() {
    if (!target) return;

    const origin = window.location.origin;
    if (!origin.startsWith("https://")) {
      setError(
        "WordPress only sends an application password back to an https address, " +
          "so this works on the deployed console rather than a local one. Add the " +
          "login by hand here instead.",
      );
      setByHand(true);
      return;
    }

    const back = new URL("/api/sites/authorize", origin);
    back.searchParams.set("back", site.id);
    back.searchParams.set("asked", target.domain || target.address);

    const to = new URL("/wp-admin/authorize-application.php", `https://${target.address.replace(/^https?:\/\//, "")}`);
    to.searchParams.set("app_name", "Content Automation console");
    to.searchParams.set("app_id", APP_ID);
    to.searchParams.set("success_url", back.toString());

    window.location.href = to.toString();
  }

  /** The way in for a site where that flow will not run. */
  async function saveByHand() {
    if (!target) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/sites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          domain: target.domain || target.address,
          username: user,
          password,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? `Saving returned ${response.status}.`);
      setPassword("");
      setByHand(false);
      setNote(`Saved the login for ${target.domain || target.address}.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That login could not be saved.");
    } finally {
      setSaving(false);
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
      /*
       * The check, if it has not already been run.
       *
       * It used to be a button you had to press before Publish would light up,
       * which meant the main action sat greyed out with the reason hidden in a
       * tooltip. Checking is something publishing needs, not something to make
       * somebody do first, so it happens here and the button beside it is only
       * for looking before committing.
       */
      const found = check ?? (await runCheck());

      /*
       * What the account is not allowed to do, before anything is written.
       *
       * A publish that fails on page four because the credentials cannot
       * publish has already made three pages nobody asked for.
       */
      if (live && !found.canPublish) {
        throw new Error(
          `${found.who} may only write drafts on that site, so publishing live ` +
            `would be refused. Untick "Publish live" or use an account that can.`,
        );
      }
      if (withDesign && !found.canKeepMarkup) {
        throw new Error(
          `${found.who} may not keep styles in page content on that site, so ` +
            `WordPress would strip the generated design out and the pages would ` +
            `arrive unstyled. Untick "Bring the generated design", or use an ` +
            `administrator account.`,
        );
      }

      for (const page of site.pages) {
        setAt(page.title);
        const payload = await step(
          {
            step: "page",
            slug: page.slug,
            status: live ? "publish" : "draft",
            withDesign,
            fullWidth,
            fit: fit === "canvas" ? "canvas" : "inside",
            // The navigation in the site's own header needs to know whether
            // the first page will answer at the root or at its own slug.
            asFront,
          },
          found.home,
        );
        const result = payload.page as Done;
        made.push(result);
        setDone([...made]);
      }

      /*
       * The front page, if asked for, and only once every page exists.
       *
       * The first page published is the site's own front page. Matching it by
       * slug would not work: the front page has no slug here, and is given one
       * on the way out, so what WordPress calls it is not what this calls it.
       */
      const front = made[0];
      if (asFront && front) {
        setAt("Pointing the front page at it");
        await step({ step: "front", frontPageId: front.id }, found.home);
      }

      setAt("Writing it down");
      const payload = await step(
        {
          step: "finish",
          host: target.host,
          label: target.label,
          status: live ? "publish" : "draft",
          withDesign,
          fit,
          pages: Object.fromEntries(made.map((row) => [row.slug, row.id])),
        },
        found.home,
      );
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
      {note ? <p className="notice ok">{note}</p> : null}

      {previous ? (
        <p className="notice ok">
          Last published to <strong>{previous.label}</strong>{" "}
          {new Date(previous.at).toLocaleString()} by {previous.by}, as{" "}
          {previous.status === "publish" ? "live pages" : "drafts"}
          {previous.fit === "canvas"
            ? ", looking exactly like the generated site"
            : previous.fit === "inside"
              ? ", with the design inside the target's theme"
              : ", taking the target's own look"}
          . Publishing to the same place again updates those pages rather than
          making new ones.
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
              searchPlaceholder="Search by name, domain or server"
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
                  // Searchable but not drawn: the server or plan it sits on,
                  // and whether it is ready, are both worth typing and neither
                  // fits on a line that already carries a domain.
                  search: `${t.place} ${t.platform} ${t.ready ? "connected ready" : "unconnected"}`,
                })),
              ]}
            />
          )}

          {target && !target.ready ? (
            <div className="publish-connect">
              <p className="notice warn">
                This console cannot write to <strong>{target.domain || target.address}</strong> yet.
                WordPress will not accept a login password over its API, so it
                needs an application password of its own.
              </p>
              <button type="button" className="btn btn-primary" onClick={connect}>
                Get one from WordPress
              </button>
              <p className="provider-hint">
                Opens that site&apos;s own authorisation screen. Approve this
                console there and it comes straight back, connected. You will
                need to be signed in to that site as an administrator.
              </p>

              {byHand ? (
                <div className="publish-byhand">
                  <label className="field-label" htmlFor="publish-user">
                    WordPress username
                  </label>
                  <input
                    id="publish-user"
                    type="text"
                    value={user}
                    autoComplete="off"
                    onChange={(e) => setUser(e.target.value)}
                  />
                  <label className="field-label" htmlFor="publish-password">
                    Application password
                  </label>
                  <input
                    id="publish-password"
                    type="password"
                    value={password}
                    autoComplete="new-password"
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={saving || !user.trim() || !password.trim()}
                    onClick={() => void saveByHand()}
                  >
                    {saving ? "Saving..." : "Save the login"}
                  </button>
                  <p className="provider-hint">
                    From Users, then your profile, then Application Passwords on
                    that site. Not the password you sign in with.
                  </p>
                </div>
              ) : (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setByHand(true)}
                >
                  Or paste one instead
                </button>
              )}
            </div>
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
              <label className="field-label" htmlFor="publish-fit">
                How it should look
              </label>
              <Select
                id="publish-fit"
                value={fit}
                onChange={(value) => setFit(value as typeof fit)}
                options={[
                  {
                    value: "canvas",
                    label: "Exactly like the generated site",
                    hint: "the theme steps aside",
                  },
                  {
                    value: "inside",
                    label: "The design, inside the theme",
                    hint: "keeps the header and footer",
                  },
                  {
                    value: "theme",
                    label: "Like the rest of the target site",
                    hint: "words only, no design",
                  },
                ]}
              />

              <p className="provider-hint">
                {fit === "canvas"
                  ? "The page becomes the generated site. On these pages only, the theme's header, footer and sidebar are hidden and everything it wraps the content in is flattened, so what is left is the design and nothing else. The rest of the site is untouched."
                  : fit === "inside"
                    ? "The design travels as a stylesheet inside each page, confined to the published content and weighted so the theme cannot overrule it. The theme's header and footer stay, and so does anything the design does not set."
                    : "The pages take on the look of the site they are joining, which is what you want when adding pages to a site that already exists."}
              </p>

              <div className="publish-options">
                <label className="check">
                  <input
                    type="checkbox"
                    checked={live}
                    onChange={(e) => setLive(e.target.checked)}
                  />
                  <span>Publish live rather than as drafts</span>
                </label>
                {fit === "inside" ? (
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={fullWidth}
                      onChange={(e) => setFullWidth(e.target.checked)}
                    />
                    <span>Let it run the full width of the page</span>
                  </label>
                ) : null}
                <label className="check">
                  <input
                    type="checkbox"
                    checked={asFront}
                    onChange={(e) => setAsFront(e.target.checked)}
                  />
                  <span>Make the first page the site&apos;s front page</span>
                </label>
              </div>
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
                  disabled={running || checking}
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
