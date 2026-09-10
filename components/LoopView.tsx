"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { LANGUAGES, MARKETS } from "@/lib/markets";
import type { Schedule, StatsProvider } from "@/lib/schedules";
import { DECLARABLE_CLASSES, type DeclarableClass } from "@/lib/validate";
import { Select } from "@/components/Select";
import { Toasts, useToasts } from "@/components/Toasts";
import ConfirmDialog from "@/components/ConfirmDialog";
import { SkeletonCards } from "@/components/Skeleton";

/**
 * What each mode is called, said once.
 *
 * The two gap modes are the same pipeline pointed at different things, and the
 * only place that distinction is invisible is in a label, so each gets its own.
 */
const MODE_NAME: Record<"gap" | "casino_gap" | "optimise" | "prospects", string> = {
  gap: "Game gap filler",
  casino_gap: "Casino gap filler",
  optimise: "Optimiser",
  prospects: "Prospect checker",
};

/** Whether a mode writes pages that do not exist, as opposed to rewriting ones that do. */
function fillsGaps(mode: string): boolean {
  return mode === "gap" || mode === "casino_gap";
}

/**
 * Whether a mode has a website at all.
 *
 * Three of the four crawl a site and publish to it. The fourth reads a
 * spreadsheet of link prospects and writes numbers back into it, and every
 * field about crawling, publishing and page classes is meaningless there — so
 * they are hidden rather than left on screen to be answered pointlessly.
 */
function touchesSite(mode: string): boolean {
  return mode !== "prospects";
}

/**
 * How often a loop looks, in the words someone would use.
 *
 * Not a free number of hours. "Every 37 hours" is a thing the engine will
 * happily do and nobody has ever wanted, and offering it means every reader of
 * this page has to work out what it would mean.
 */
const EVERY = [
  { hours: 6, label: "Four times a day" },
  { hours: 12, label: "Twice a day" },
  { hours: 24, label: "Daily" },
  { hours: 48, label: "Every other day" },
  { hours: 168, label: "Weekly" },
  // Past a week only makes sense for a loop that does not crawl: a crawl older
  // than a week has stopped describing the site. A prospect list moves on a
  // scale of months, so a fortnight between checks is the natural cadence and
  // was not offerable until the engine's ceiling went up from one week.
  { hours: 336, label: "Every two weeks" },
  { hours: 504, label: "Every three weeks" },
  { hours: 720, label: "Monthly" },
];

/**
 * The competitor crawl export a gap loop starts from.
 *
 * Prefilled because there is one in use and typing a 44 character Drive id from
 * memory is how a loop ends up pointed at nothing. It is still a field rather
 * than a constant: two loops chasing two different rivals is the obvious next
 * thing to want, and the engine already takes it per run.
 */
const DEFAULT_IDEAS_SHEET_ID = "1vTmwt1Gi5GmFby-a3nTHRko_2KyDWfc9RRJGiLzrF14";

const CLASS_FIELDS: Array<{ key: DeclarableClass; label: string; placeholder: string }> = [
  { key: "casino_review", label: "Casino review", placeholder: "single-casino" },
  { key: "game_review", label: "Game review", placeholder: "single-game" },
  { key: "promocodes", label: "Promo codes", placeholder: "single-promo" },
  { key: "blog", label: "Blog", placeholder: "single-post" },
];

type Draft = {
  id?: string;
  name: string;
  mode: "gap" | "casino_gap" | "optimise" | "prospects";
  website_url: string;
  market: string;
  language: string;
  max_crawl_pages: number;
  pages_to_optimise: number;
  reuse_crawl_days: number;
  exclude_paths: string;
  brief_doc_id: string;
  everyHours: number;
  atHour: number;
  atMinute: number;
  enabled: boolean;
  body_classes: Record<DeclarableClass, string>;
  ideas_sheet_id: string;
  prospects_sheet_id: string;
  prospects_sheet_tab: string;
  stats_provider: StatsProvider;
  /** Typed as a list, sent as one. DataForSEO only. */
  markets: string;
  style_reference_url: string;
  publish_new_pages: boolean;
};

const BLANK: Draft = {
  name: "",
  mode: "gap",
  website_url: "",
  market: "gb",
  language: "en",
  max_crawl_pages: 0,
  pages_to_optimise: 3,
  reuse_crawl_days: 7,
  exclude_paths: "",
  brief_doc_id: "",
  everyHours: 24,
  atHour: 3,
  atMinute: 0,
  enabled: true,
  body_classes: { casino_review: "", game_review: "", promocodes: "", blog: "" },
  ideas_sheet_id: DEFAULT_IDEAS_SHEET_ID,
  prospects_sheet_id: "",
  prospects_sheet_tab: "",
  stats_provider: "ahrefs",
  markets: "",
  style_reference_url: "",
  publish_new_pages: false,
};

/**
 * Whether a crawl limit means "the whole site".
 *
 * Zero means it, and only zero. This used to count a thousand as well, and
 * that was a workaround rather than a rule: the engine resolved a zero to a
 * thousand before storing it, so a loop saved with the box ticked came back
 * unticked with 1000 beside it, reading exactly like a setting that refused to
 * save. The engine keeps the zero now, so the workaround is gone with the
 * thing it was working around.
 *
 * A loop saved before that fix still holds 1000, and now shows as 1000 rather
 * than as the whole site. That is what it holds and what it will crawl, so it
 * is the honest reading; ticking the box again is what raises it to the
 * engine's ceiling. The alternative — treating a stored 1000 as "the whole
 * site" — would quietly turn every one of those loops into a ten thousand page
 * crawl the next time somebody saved it, which is a surprise in the direction
 * that costs money.
 */
function isWholeSite(pages: number): boolean {
  return pages === 0;
}

/**
 * The same loop again, as a new one.
 *
 * Opened in the form rather than saved on the spot. A duplicate is made to
 * change something — a second competitor, a different market, the casino half
 * of the same site — and a copy that saved itself would put the thing you were
 * about to edit into the schedule before you edited it.
 *
 * Paused, and named as a copy. A duplicate that arrives switched on is a
 * second crawl of the same site tonight, which is the one outcome nobody
 * pressing Duplicate is asking for.
 *
 * The password is not copied because it is never here to copy. The save
 * attaches whatever login is stored for that site, which is also the more
 * correct answer: a copy gets the current credentials rather than whatever
 * the original was created with.
 */
function copyOf(schedule: Schedule): Draft {
  const from = draftOf(schedule);
  return {
    ...from,
    id: undefined,
    name: `${schedule.name} copy`.slice(0, 120),
    enabled: false,
  };
}

function draftOf(schedule: Schedule): Draft {
  return {
    id: schedule.id,
    name: schedule.name,
    mode: schedule.mode,
    website_url: schedule.website_url,
    market: schedule.market,
    language: schedule.language,
    max_crawl_pages: schedule.max_crawl_pages,
    pages_to_optimise: schedule.pages_to_optimise,
    reuse_crawl_days: schedule.reuse_crawl_days,
    exclude_paths: (schedule.exclude_paths ?? []).join(", "),
    brief_doc_id: schedule.brief_doc_id,
    everyHours: schedule.everyHours,
    atHour: schedule.atHour,
    atMinute: schedule.atMinute,
    enabled: schedule.enabled,
    // An existing loop keeps whatever it was saved with, blank included: blank
    // means "use the host's sheet", and filling the default in over the top
    // would quietly change which competitor it chases.
    ideas_sheet_id: schedule.ideas_sheet_id ?? "",
    prospects_sheet_id: schedule.prospects_sheet_id ?? "",
    prospects_sheet_tab: schedule.prospects_sheet_tab ?? "",
    stats_provider: schedule.stats_provider ?? "ahrefs",
    markets: (schedule.markets ?? []).join(", "),
    style_reference_url: schedule.style_reference_url ?? "",
    publish_new_pages: schedule.publish_new_pages ?? false,
    body_classes: {
      casino_review: (schedule.body_classes?.casino_review ?? []).join(" "),
      game_review: (schedule.body_classes?.game_review ?? []).join(" "),
      promocodes: (schedule.body_classes?.promocodes ?? []).join(" "),
      blog: (schedule.body_classes?.blog ?? []).join(" "),
    },
  };
}

function when(iso: string | null): string {
  if (!iso) return "never";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** "in 4 hours", which is the thing anyone actually wants to know. */
function untilNext(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(ms)) return "";
  if (ms <= 0) return "due now";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `in ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `in ${hours} hour${hours === 1 ? "" : "s"}`;
  return `in ${Math.round(hours / 24)} days`;
}

/**
 * The part of an address that says which site it is.
 *
 * A trailing slash, a www, a capital letter and http rather than https are all
 * the same site, and the account list stores none of them — normaliseDomain on
 * the server has already stripped them. So anything compared against it has to
 * be stripped the same way, or the same site reads as two.
 */
function hostOf(url: string): string {
  return String(url || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");
}

/** What /api/sites returns. The password is never part of it. */
type Site = {
  domain: string;
  username: string;
  readable: boolean;
};

export default function LoopView() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  /**
   * The page failing to load, which is a state rather than an event: it stays
   * true until it is not, and a toast that vanished after four seconds would
   * leave an empty list with no explanation. Everything that happens *because
   * of something you did* is a toast instead.
   */
  const [error, setError] = useState<string | null>(null);
  /**
   * The loop awaiting a yes on deleting it.
   *
   * The whole schedule rather than its id, so the dialog can name it. "Delete
   * this loop?" is a question about something; "Delete Nightly gap fill?" is a
   * question you can answer.
   */
  const [deleting, setDeleting] = useState<Schedule | null>(null);
  /**
   * The sites a loop may publish to.
   *
   * Read from the same store the Website Accounts page writes, because those
   * are exactly the sites a stored WordPress login exists for — and a loop
   * without one fires on schedule and fails at the last step.
   */
  const [sites, setSites] = useState<Site[]>([]);
  const { toasts, push, dismiss } = useToasts();

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/schedules", { cache: "no-store" });
      if (response.status === 401) {
        window.location.href = "/login";
        return;
      }
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error ?? `Schedules API returned ${response.status}.`);
      setSchedules(payload.schedules ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the loops.");
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Loaded once rather than on the poll.
   *
   * The site list changes when somebody adds a login, which is not something
   * that happens while this page sits open, and re-reading it every minute
   * would be a request a minute for an answer that never moves.
   */
  const loadSites = useCallback(async () => {
    try {
      const response = await fetch("/api/sites", { cache: "no-store" });
      if (!response.ok) return;
      const payload = (await response.json()) as { sites?: Site[] };
      setSites(payload.sites ?? []);
    } catch {
      // The form says no sites are registered, which is the same thing from
      // where the person is standing and is better than an error about a list
      // they did not ask for.
    }
  }, []);

  useEffect(() => {
    void load();
    void loadSites();
    // Slow on purpose. Nothing here changes faster than hourly, and the only
    // moving part is a countdown this recomputes locally anyway.
    const timer = setInterval(() => void load(), 60_000);
    return () => clearInterval(timer);
  }, [load, loadSites]);

  /**
   * The registered sites, and whatever this loop already points at.
   *
   * A loop edited after its site was removed from Website Accounts, or created
   * back when this was a free-text box, holds a URL with no matching option —
   * and the Select renders a value it has no option for as an empty control.
   * That reads as "nothing chosen" on a loop aimed somewhere perfectly
   * definite, so its own address goes in the list, labelled unregistered.
   *
   * Matched on the host rather than on the string. Comparing the two literally
   * put the same site in the list twice: once from the account list as
   * "example.com — admin" and once from the loop as "example.com — not
   * registered", because the stored URL carried a trailing slash and
   * "https://example.com/" is not "https://example.com". A www prefix, a
   * capital letter or http did the same. None of those are a different site.
   */
  const siteOptions = useMemo(() => {
    const options = sites.map((site) => ({
      value: `https://${site.domain}`,
      label: site.domain,
      hint: site.readable ? site.username : "login unreadable",
    }));

    const chosen = draft?.website_url?.trim();
    if (chosen && !options.some((o) => hostOf(o.value) === hostOf(chosen))) {
      options.unshift({ value: chosen, label: hostOf(chosen), hint: "not registered" });
    }
    return options;
  }, [sites, draft?.website_url]);

  /**
   * Which option the Select should show as chosen.
   *
   * The registered option's exact value where the host matches, so a loop
   * holding "https://example.com/" highlights the "example.com" row rather than
   * neither. Left as the draft's own value when nothing matches, which is the
   * unregistered entry added above.
   */
  const chosenSite = useMemo(() => {
    const chosen = draft?.website_url?.trim() ?? "";
    if (!chosen) return "";
    return siteOptions.find((o) => hostOf(o.value) === hostOf(chosen))?.value ?? chosen;
  }, [siteOptions, draft?.website_url]);

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!draft) return;

    setBusy(true);
    try {
      const response = await fetch("/api/schedules", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(draft),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error ?? "The loop could not be saved.");
      setDraft(null);
      push("ok", `Saved. Next run ${when(payload.schedule.nextRunAt)}.`);
      await load();
    } catch (err) {
      push("bad", err instanceof Error ? err.message : "The loop could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  /**
   * On or off, saved straight away.
   *
   * Sends the id and the flag and nothing else: the engine merges a partial
   * save onto what it already holds, so pausing a loop must not carry a stale
   * copy of the rest of it back over the top.
   *
   * The row is updated before the request rather than after it. A switch that
   * waits for a round trip reads as broken, and load() puts it right if the
   * save fails.
   */
  async function toggle(schedule: Schedule, enabled: boolean) {
    setSchedules((current) =>
      current.map((s) => (s.id === schedule.id ? { ...s, enabled } : s)),
    );
    setBusy(true);
    try {
      const response = await fetch("/api/schedules", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // The id and the flag, and nothing else. The address used to be sent
        // alongside them only to satisfy a check on the other end that has no
        // business running on an update, and a loop with no website of its own
        // could not be switched off because of it.
        body: JSON.stringify({ id: schedule.id, enabled }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error ?? "That did not work.");
      push(
        "ok",
        enabled
          ? `${schedule.name} is on. Next run ${when(payload.schedule.nextRunAt)}.`
          : `${schedule.name} is paused.`,
      );
      await load();
    } catch (err) {
      push("bad", err instanceof Error ? err.message : "That did not work.");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function act(id: string, method: "POST" | "DELETE", success: string) {
    setBusy(true);
    try {
      const response = await fetch(`/api/schedules/${encodeURIComponent(id)}`, { method });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error ?? "That did not work.");
      push("ok", success);
      await load();
    } catch (err) {
      push("bad", err instanceof Error ? err.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    const name = deleting.name;
    await act(deleting.id, "DELETE", `${name} deleted.`);
    setDeleting(null);
  }

  return (
    <div className="stack">
      <Toasts toasts={toasts} onDismiss={dismiss} />

      <ConfirmDialog
        open={!!deleting}
        title={`Delete ${deleting?.name ?? "this loop"}?`}
        confirmLabel="Delete loop"
        busyLabel="Deleting…"
        cancelLabel="Keep it"
        busy={busy}
        onConfirm={confirmDelete}
        onDismiss={() => (busy ? undefined : setDeleting(null))}
        body={
          <>
            <p>
              Its schedule and settings go with it, and it stops firing. The
              pages it has already written stay where they are, and so do their
              runs in the log.
            </p>
            <p className="confirm-quiet">
              {MODE_NAME[deleting?.mode ?? "optimise"]} on{" "}
              <strong>{deleting?.website_url}</strong>, every{" "}
              {EVERY.find((e) => e.hours === deleting?.everyHours)?.label.toLowerCase() ??
                `${deleting?.everyHours} hours`}
              .
            </p>
            <p className="confirm-quiet">
              To stop it without losing it, switch it off instead.
            </p>
          </>
        }
      />

      <div className="card">
        <div className="card-head">
          <div>
            <h2>Loops</h2>
            <p>
              Runs that start themselves, on a schedule. They run on the engine,
              so they keep firing whether or not anyone has this page open.
            </p>
          </div>
          {draft ? null : (
            <button type="button" className="btn" onClick={() => setDraft({ ...BLANK })}>
              New loop
            </button>
          )}
        </div>

        <div className="card-body">
          {error ? <div className="notice bad">{error}</div> : null}

          {loading ? (
            <SkeletonCards count={2} />
          ) : schedules.length === 0 && !draft ? (
            <div className="empty">
              No loops yet. A loop is the console doing what you would do by hand
              on a Monday: check a competitor for games you have not covered, and
              write the ones you are missing.
            </div>
          ) : (
            <div className="loop-list">
              {schedules.map((schedule) => (
                <div className="loop" key={schedule.id}>
                  <div className="loop-head">
                    <div>
                      <label className="switch" title={
                        schedule.enabled
                          ? "Firing on schedule. Switch off to pause it."
                          : "Paused. It keeps its settings and stops firing."
                      }>
                        <input
                          type="checkbox"
                          checked={schedule.enabled}
                          disabled={busy}
                          onChange={(e) => toggle(schedule, e.target.checked)}
                        />
                        <span className="switch-label">
                          {schedule.enabled ? "On" : "Paused"}
                        </span>
                      </label>
                      <strong>{schedule.name}</strong>
                      <span className="pill pill-idle">
                        {MODE_NAME[schedule.mode]}
                      </span>
                    </div>
                    <div className="loop-actions">
                      <button
                        type="button"
                        className="btn btn-ghost"
                        disabled={busy}
                        onClick={() => act(schedule.id, "POST", "Started. Watch it on the Runs page.")}
                      >
                        Run now
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        disabled={busy}
                        onClick={() => setDraft(draftOf(schedule))}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        disabled={busy}
                        title="Open a copy of this loop, paused, for you to change and save."
                        onClick={() => setDraft(copyOf(schedule))}
                      >
                        Duplicate
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        disabled={busy}
                        onClick={() => setDeleting(schedule)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>

                  {/* What this loop is, in one line. Three of the four are
                      described by a site and a page count; the fourth has
                      neither, so it is described by what it reads and who it
                      asks. A row of blanks and "up to 3 pages" would be a
                      summary of a different loop. */}
                  <div className="loop-facts">
                    {touchesSite(schedule.mode) ? (
                      <>
                        <span>{schedule.website_url}</span>
                        <span>
                          up to {schedule.pages_to_optimise || "no cap on"} page
                          {schedule.pages_to_optimise === 1 ? "" : "s"} each time
                        </span>
                      </>
                    ) : (
                      <>
                        <span>
                          {schedule.prospects_sheet_id
                            ? `sheet ${schedule.prospects_sheet_id.slice(0, 12)}…`
                            : "the engine's own sheet"}
                        </span>
                        <span>
                          via {schedule.stats_provider === "dataforseo" ? "DataForSEO" : "Ahrefs"}
                        </span>
                      </>
                    )}
                    <span>
                      {EVERY.find((e) => e.hours === schedule.everyHours)?.label ??
                        `Every ${schedule.everyHours}h`}
                      {schedule.everyHours >= 24
                        ? ` at ${String(schedule.atHour).padStart(2, "0")}:${String(schedule.atMinute).padStart(2, "0")}`
                        : ` at :${String(schedule.atMinute).padStart(2, "0")}`}
                    </span>
                    <span>
                      next {when(schedule.nextRunAt)} ({untilNext(schedule.nextRunAt)})
                    </span>
                    <span>last {when(schedule.lastRunAt)}</span>
                    {/* Only where it matters. A loop that publishes nothing is
                        not missing a password. */}
                    {touchesSite(schedule.mode) && !schedule.wp_password_set ? (
                      <span className="loop-warn">no WordPress login — it will publish nothing</span>
                    ) : null}
                  </div>

                  {schedule.lastNote ? (
                    <div className="loop-note">{schedule.lastNote}</div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {draft ? (
        <div className="card">
          <div className="card-head">
            <div>
              <h2>{draft.id ? "Edit loop" : "New loop"}</h2>
              <p>
                The WordPress login is taken from the site&rsquo;s saved account,
                the same one a manual run uses. Nothing is typed twice.
              </p>
            </div>
            <div className="spacer" />
            <label className="switch">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(e) => set("enabled", e.target.checked)}
              />
              <span className="switch-label">
                {draft.enabled ? "On" : "Paused"}
              </span>
            </label>
          </div>

          <div className="card-body">
            <form onSubmit={save} noValidate>
              <div className="field">
                <label htmlFor="loop_name">Name</label>
                <input
                  id="loop_name"
                  type="text"
                  value={draft.name}
                  placeholder="Nightly gap fill"
                  onChange={(e) => set("name", e.target.value)}
                />
              </div>

              {touchesSite(draft.mode) ? (
                <div className="field">
                  <label id="loop_site_label">Website</label>
                  {/* A list rather than a box.
                      A loop publishes to the site it names, and publishing needs
                      a WordPress login — which only exists for a site registered
                      on the Website Accounts page. Typed by hand, a URL that was
                      one character out, or simply not registered, produced a loop
                      that fired on schedule and failed at the last step every
                      time. Choosing from the registered sites makes that
                      impossible to get wrong. */}
                  {siteOptions.length ? (
                    <Select
                      id="loop_site"
                      labelledBy="loop_site_label"
                      value={chosenSite}
                      onChange={(v) => set("website_url", v)}
                      options={siteOptions}
                    />
                  ) : (
                    <div className="notice warn">
                      <strong>No websites are registered.</strong> A loop
                      publishes with a stored WordPress login, so add the site
                      under Website Accounts first.
                    </div>
                  )}
                  <div className="note">
                    Our site &mdash; the one pages are published to, chosen from
                    the logins on the Website Accounts page. On a gap fill the
                    competitor comes from the ideas sheet, not from here.
                  </div>
                </div>
              ) : null}

              <div className="field">
                <label id="loop_mode_label">What it does</label>
                <Select
                  id="loop_mode"
                  labelledBy="loop_mode_label"
                  value={draft.mode}
                  onChange={(v) => set("mode", v as Draft["mode"])}
                  options={[
                    {
                      value: "gap",
                      label: "Game gap filler",
                      hint: "writes the game reviews we do not have",
                    },
                    {
                      value: "casino_gap",
                      label: "Casino gap filler",
                      hint: "writes the casino reviews we do not have",
                    },
                    { value: "optimise", label: "Optimiser", hint: "rewrites pages we do" },
                    {
                      value: "prospects",
                      label: "Prospect checker",
                      hint: "keeps a link prospect list up to date",
                    },
                  ]}
                />
                <div className="note">
                  {draft.mode === "gap"
                    ? "Reads the competitor crawl in the ideas sheet, compares it against our own crawl, and writes a full review for each game we are missing. Nothing missing is a success, not an error."
                    : draft.mode === "casino_gap"
                      ? "The same comparison against the same sheet, looking for casino reviews instead. Each one it writes starts with a visit to the operator's own site, so a casino that is not in the casino sheet is skipped: there is nowhere to go and look."
                      : draft.mode === "prospects"
                        ? "Reads a column of domains, asks what each one is currently worth, and writes the Domain Rating, organic traffic and top countries back beside it. It touches no website, crawls nothing and publishes nothing, so it costs a handful of API calls and finishes in seconds."
                        : "The same thing the Runs page does: crawls the site and rewrites the pages it finds."}
                </div>
              </div>

              {/*
                * The prospect list, and who to ask about it.
                *
                * Both settings sit together because they are one decision: the
                * sheet says which domains, the provider says whose numbers go
                * into it, and changing the provider halfway through changes
                * what the column means.
                */}
              {draft.mode === "prospects" ? (
                <>
                  <div className="row-2">
                    <div className="field">
                      <label htmlFor="loop_prospects">Prospects sheet ID</label>
                      <input
                        id="loop_prospects"
                        type="text"
                        className="mono"
                        value={draft.prospects_sheet_id}
                        placeholder="Drive file ID of the list of domains"
                        onChange={(e) => set("prospects_sheet_id", e.target.value.trim())}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="loop_prospects_tab">Tab</label>
                      <input
                        id="loop_prospects_tab"
                        type="text"
                        className="mono"
                        value={draft.prospects_sheet_tab}
                        placeholder="Blank for the first tab"
                        onChange={(e) => set("prospects_sheet_tab", e.target.value.trim())}
                      />
                    </div>
                  </div>
                  <div className="note" style={{ marginTop: -4 }}>
                    One column headed Domain, and the first row naming the
                    columns. The figures are written back into columns beside it,
                    which are created if they are not there. Nothing else in the
                    sheet is touched, and no rows are ever added. Share it with
                    the service account with edit rights, or it can be read and
                    not written.
                  </div>

                  <div className="field">
                    <label id="loop_provider_label">Ask</label>
                    <Select
                      id="loop_provider"
                      labelledBy="loop_provider_label"
                      value={draft.stats_provider}
                      onChange={(v) => set("stats_provider", v as StatsProvider)}
                      options={[
                        {
                          value: "ahrefs",
                          label: "Ahrefs",
                          hint: "the numbers in your Ahrefs tab",
                        },
                        {
                          value: "dataforseo",
                          label: "DataForSEO",
                          hint: "already paid for, different scale",
                        },
                      ]}
                    />
                    <div className="note">
                      {draft.stats_provider === "ahrefs"
                        ? "Domain Rating on the 0 to 100 scale you already read, organic traffic, and the real top countries. Needs an Ahrefs API key on the Keys page, which is billed separately from an Ahrefs seat."
                        : "Already configured, so nothing to buy. Its rank is its own, computed from its own link index, and a domain Ahrefs puts at 62 will not come back as 62. Top countries are worked out by asking each market below in turn, so that column is only as wide as the list."}
                    </div>
                  </div>

                  {draft.stats_provider === "dataforseo" ? (
                    <div className="field">
                      <label htmlFor="loop_markets">Markets to measure</label>
                      <input
                        id="loop_markets"
                        type="text"
                        className="mono"
                        value={draft.markets}
                        placeholder="us, gb, ca, au, de"
                        onChange={(e) => set("markets", e.target.value)}
                      />
                      <div className="note">
                        Two-letter codes, separated by commas. Each one is
                        another API call per check, and the traffic figure is the
                        sum of these markets rather than a worldwide total: a
                        domain whose audience is entirely outside this list comes
                        back as nothing. Leave it blank for a shortlist of the
                        big English-speaking markets and three European ones.
                      </div>
                    </div>
                  ) : null}
                </>
              ) : null}

              {fillsGaps(draft.mode) ? (
                <div className="field">
                  <label htmlFor="loop_ideas">Ideas sheet ID</label>
                  <input
                    id="loop_ideas"
                    type="text"
                    className="mono"
                    value={draft.ideas_sheet_id}
                    placeholder="Drive file ID of the competitor crawl export"
                    onChange={(e) => set("ideas_sheet_id", e.target.value.trim())}
                  />
                  <div className="note">
                    The competitor this loop chases: a crawl export with Address,
                    Meta Title and H1 columns, shared with the service account.
                    The ID only, not the URL. Leave it blank to use whichever
                    sheet the engine is configured with.
                  </div>
                </div>
              ) : null}

              {touchesSite(draft.mode) ? (
                <div className="field">
                  <label htmlFor="loop_style_ref">Design reference page</label>
                  <input
                    id="loop_style_ref"
                    type="url"
                    className="mono"
                    value={draft.style_reference_url}
                    placeholder="https://example.com/game/an-existing-page/"
                    onChange={(e) => set("style_reference_url", e.target.value.trim())}
                  />
                  <div className="note">
                    Optional. An existing page whose look new pages should copy —
                    one you have checked and are happy with. Leave it blank and the
                    run picks an example itself, which is whichever page happened
                    to match the competitor and is not always one you would choose.
                    Either way the template comes from what the post type agrees
                    on; this only settles the details the type disagrees about.
                  </div>
                </div>
              ) : null}

              <div className="row-2">
                <div className="field">
                  <label id="loop_every_label">How often</label>
                  <Select
                    id="loop_every"
                    labelledBy="loop_every_label"
                    value={String(draft.everyHours)}
                    onChange={(v) => set("everyHours", Number(v))}
                    options={EVERY.map((e) => ({ value: String(e.hours), label: e.label }))}
                  />
                </div>

                <div className="field">
                  <label htmlFor="loop_at">At</label>
                  <div className="limit-row">
                    {draft.everyHours >= 24 ? (
                      <input
                        id="loop_at"
                        type="number"
                        min={0}
                        max={23}
                        value={draft.atHour}
                        onChange={(e) => set("atHour", Number(e.target.value))}
                      />
                    ) : null}
                    <input
                      type="number"
                      min={0}
                      max={59}
                      value={draft.atMinute}
                      onChange={(e) => set("atMinute", Number(e.target.value))}
                    />
                  </div>
                  <div className="note">
                    {draft.everyHours >= 24
                      ? "Hour and minute, in the droplet's timezone."
                      : "Minute past the hour."}
                  </div>
                </div>
              </div>

              <div className="row-2">
                <div className="field">
                  <label id="loop_market_label">Market</label>
                  <Select
                    id="loop_market"
                    labelledBy="loop_market_label"
                    value={draft.market}
                    onChange={(v) => set("market", v)}
                    options={MARKETS.map((m) => ({ value: m.code, label: m.label, hint: m.code }))}
                  />
                </div>
                <div className="field">
                  <label id="loop_language_label">Language</label>
                  <Select
                    id="loop_language"
                    labelledBy="loop_language_label"
                    value={draft.language}
                    onChange={(v) => set("language", v)}
                    options={LANGUAGES.map((l) => ({ value: l.code, label: l.label, hint: l.code }))}
                  />
                </div>
              </div>

              {touchesSite(draft.mode) ? (
                <div className="field">
                  <label htmlFor="loop_crawl">Crawl limit</label>
                  <div className="limit-row">
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={isWholeSite(draft.max_crawl_pages)}
                        onChange={(e) => set("max_crawl_pages", e.target.checked ? 0 : 200)}
                      />
                      Crawl the whole site
                    </label>
                    <input
                      id="loop_crawl"
                      type="number"
                      min={1}
                      max={100000}
                      disabled={isWholeSite(draft.max_crawl_pages)}
                      value={isWholeSite(draft.max_crawl_pages) ? "" : draft.max_crawl_pages}
                      placeholder="all"
                      onChange={(e) => set("max_crawl_pages", Number.parseInt(e.target.value, 10) || 0)}
                    />
                  </div>
                  <div className="note">
                    {fillsGaps(draft.mode)
                      ? "How much of OUR site is crawled to work out what we already have. Cap this and anything past the cap looks missing, which is how a gap run comes to write a page you already had. Leave it on the whole site unless you have a reason: the run says in its log if a crawl ever reaches the engine's ceiling."
                      : "How many pages are crawled to choose from."}
                  </div>
                </div>
              ) : null}

              {touchesSite(draft.mode) ? (
                <div className="field">
                  <label htmlFor="loop_cap">
                    {fillsGaps(draft.mode) ? "New pages each time" : "Pages to optimise each time"}
                  </label>
                  <div className="limit-row">
                    <input
                      id="loop_cap"
                      type="number"
                      min={0}
                      max={100000}
                      value={draft.pages_to_optimise}
                      onChange={(e) => set("pages_to_optimise", Number(e.target.value))}
                    />
                  </div>
                  <div className="note">
                    Every page here costs Claude, Gemini and DataForSEO credits, and
                    this fires on its own. A cap is the difference between a loop and
                    a surprise. 0 means no cap.
                  </div>
                </div>
              ) : null}

              {touchesSite(draft.mode) ? (
                <div className="field">
                  <label htmlFor="loop_reuse">Reuse a crawl up to</label>
                  <div className="limit-row">
                    <input
                      id="loop_reuse"
                      type="number"
                      min={0}
                      max={90}
                      value={draft.reuse_crawl_days}
                      onChange={(e) => set("reuse_crawl_days", Number(e.target.value))}
                    />
                    <span className="note" style={{ margin: 0 }}>days old</span>
                  </div>
                  <div className="note">
                    What keeps a nightly loop cheap. A crawl of our own site from
                    yesterday is good enough to tell whether we cover a game. 0
                    crawls fresh every time.
                  </div>
                </div>
              ) : null}

              {fillsGaps(draft.mode) ? (
                <div className="field">
                  <label className="check" htmlFor="loop_publish">
                    <input
                      id="loop_publish"
                      type="checkbox"
                      checked={draft.publish_new_pages}
                      onChange={(e) => set("publish_new_pages", e.target.checked)}
                    />
                    Publish new pages
                  </label>
                  <div className="note">
                    {draft.publish_new_pages
                      ? "New pages go straight onto the site. This loop fires on its own, so nobody reads them first."
                      : "Off. New pages are created as drafts and wait in WordPress until you publish them — which is why a run can finish successfully and the page show nothing."}
                  </div>
                </div>
              ) : null}

              {touchesSite(draft.mode) ? (
                <div className="field field-sep">
                  <label>Page classes by body class</label>
                  <div className="note" style={{ marginTop: 0, marginBottom: 9 }}>
                    Optional, and only used by the optimiser — a gap fill writes
                    game reviews and has nothing to classify.
                  </div>
                  <div className="row-2">
                    {CLASS_FIELDS.map((field) => (
                      <div className="field" key={field.key}>
                        <label htmlFor={`loop_bc_${field.key}`}>{field.label}</label>
                        <input
                          id={`loop_bc_${field.key}`}
                          type="text"
                          className="mono"
                          placeholder={field.placeholder}
                          value={draft.body_classes[field.key]}
                          onChange={(e) =>
                            set("body_classes", {
                              ...draft.body_classes,
                              [field.key]: e.target.value,
                            })
                          }
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="loop-actions">
                <button type="submit" className="btn" disabled={busy}>
                  {busy ? "Saving…" : draft.id ? "Save loop" : "Create loop"}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={busy}
                  onClick={() => setDraft(null)}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
