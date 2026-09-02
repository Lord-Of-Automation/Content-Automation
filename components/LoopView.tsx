"use client";

import { useCallback, useEffect, useState } from "react";

import { LANGUAGES, MARKETS } from "@/lib/markets";
import type { Schedule } from "@/lib/schedules";
import { DECLARABLE_CLASSES, type DeclarableClass } from "@/lib/validate";
import { Select } from "@/components/Select";
import { Toasts, useToasts } from "@/components/Toasts";
import ConfirmDialog from "@/components/ConfirmDialog";

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
  mode: "gap" | "optimise";
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
  style_reference_url: string;
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
  style_reference_url: "",
};

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
    style_reference_url: schedule.style_reference_url ?? "",
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

  useEffect(() => {
    void load();
    // Slow on purpose. Nothing here changes faster than hourly, and the only
    // moving part is a countdown this recomputes locally anyway.
    const timer = setInterval(() => void load(), 60_000);
    return () => clearInterval(timer);
  }, [load]);

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
        body: JSON.stringify({ id: schedule.id, website_url: schedule.website_url, enabled }),
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
              {deleting?.mode === "gap" ? "Game gap filler" : "Optimiser"} on{" "}
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
            <div className="empty">Loading…</div>
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
                        {schedule.mode === "gap" ? "Game gap filler" : "Optimiser"}
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
                        onClick={() => setDeleting(schedule)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>

                  <div className="loop-facts">
                    <span>{schedule.website_url}</span>
                    <span>
                      {EVERY.find((e) => e.hours === schedule.everyHours)?.label ??
                        `Every ${schedule.everyHours}h`}
                      {schedule.everyHours >= 24
                        ? ` at ${String(schedule.atHour).padStart(2, "0")}:${String(schedule.atMinute).padStart(2, "0")}`
                        : ` at :${String(schedule.atMinute).padStart(2, "0")}`}
                    </span>
                    <span>
                      up to {schedule.pages_to_optimise || "no cap on"} page
                      {schedule.pages_to_optimise === 1 ? "" : "s"} each time
                    </span>
                    <span>
                      next {when(schedule.nextRunAt)} ({untilNext(schedule.nextRunAt)})
                    </span>
                    <span>last {when(schedule.lastRunAt)}</span>
                    {schedule.wp_password_set ? null : (
                      <span className="loop-warn">no WordPress login — it will publish nothing</span>
                    )}
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

              <div className="field">
                <label htmlFor="loop_url">Website URL</label>
                <input
                  id="loop_url"
                  type="url"
                  className="mono"
                  value={draft.website_url}
                  placeholder="https://example.com"
                  onChange={(e) => set("website_url", e.target.value)}
                />
                <div className="note">
                  Our site — the one pages are published to. On a gap fill the
                  competitor comes from the ideas sheet, not from here.
                </div>
              </div>

              <div className="field">
                <label id="loop_mode_label">What it does</label>
                <Select
                  id="loop_mode"
                  labelledBy="loop_mode_label"
                  value={draft.mode}
                  onChange={(v) => set("mode", v as Draft["mode"])}
                  options={[
                    { value: "gap", label: "Game gap filler", hint: "writes pages we do not have" },
                    { value: "optimise", label: "Optimiser", hint: "rewrites pages we do" },
                  ]}
                />
                <div className="note">
                  {draft.mode === "gap"
                    ? "Reads the competitor crawl in the ideas sheet, compares it against our own crawl, and writes a full review for each game we are missing. Nothing missing is a success, not an error."
                    : "The same thing the Runs page does: crawls the site and rewrites the pages it finds."}
                </div>
              </div>

              {draft.mode === "gap" ? (
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

              <div className="field">
                <label htmlFor="loop_crawl">Crawl limit</label>
                <div className="limit-row">
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={draft.max_crawl_pages === 0}
                      onChange={(e) => set("max_crawl_pages", e.target.checked ? 0 : 200)}
                    />
                    Crawl the whole site
                  </label>
                  <input
                    id="loop_crawl"
                    type="number"
                    min={1}
                    max={1000}
                    disabled={draft.max_crawl_pages === 0}
                    value={draft.max_crawl_pages === 0 ? "" : draft.max_crawl_pages}
                    placeholder="all"
                    onChange={(e) => set("max_crawl_pages", Number.parseInt(e.target.value, 10) || 0)}
                  />
                </div>
                <div className="note">
                  {draft.mode === "gap"
                    ? "How much of OUR site is crawled to work out what we already have. Cap this and anything past the cap looks missing — which is how a gap run ends up writing over a page you already had. Leave it on the whole site unless you have a reason."
                    : "How many pages are crawled to choose from."}
                </div>
              </div>

              <div className="field">
                <label htmlFor="loop_cap">
                  {draft.mode === "gap" ? "New pages each time" : "Pages to optimise each time"}
                </label>
                <div className="limit-row">
                  <input
                    id="loop_cap"
                    type="number"
                    min={0}
                    max={1000}
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
