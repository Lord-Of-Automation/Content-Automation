"use client";

import { useEffect, useRef, useState } from "react";

import ConfirmDialog from "@/components/ConfirmDialog";
import GroupDialog from "@/components/GroupDialog";

export type BulkAction =
  | "cloudflare-add"
  | "cloudflare-point"
  | "renew-auto-on"
  | "renew-auto-off";

export interface BulkTarget {
  domain: string;
  provider: string;
}

type Outcome = { domain: string; ok: boolean; note: string };

/**
 * What each action does, and what it says before doing it.
 *
 * The warning is not decoration. Pointing three hundred domains at new name
 * servers is the single most consequential thing this console can do, and it
 * cannot be undone by pressing the button again — the old answer is cached
 * across the internet for as long as its lifetime says.
 */
const ACTIONS: Record<
  BulkAction,
  { label: string; icon: string; verb: string; warn?: string; danger?: boolean }
> = {
  "cloudflare-add": {
    label: "Add to Cloudflare",
    icon: "M7 17a5 5 0 0 1 .3-9.9 6 6 0 0 1 11.4 2A4 4 0 0 1 18 17z",
    verb: "Create a Cloudflare zone for each",
    warn:
      "Nothing goes live from this. Each zone is created and waits for its own " +
      "name servers, which Cloudflare assigns per domain — use Point at " +
      "Cloudflare afterwards to set them.",
  },
  "cloudflare-point": {
    label: "Point at Cloudflare",
    icon: "M12 2v20M2 12h20",
    verb: "Change the name servers to whatever Cloudflare assigned each zone",
    warn:
      "This moves each site and its email together, and resolvers keep the old " +
      "answer for up to 48 hours. Every domain gets its own pair, read from its " +
      "own zone — a domain with no zone is skipped rather than guessed at.",
    danger: true,
  },
  "renew-auto-on": {
    label: "Auto-renew on",
    icon: "M4 12a8 8 0 0 1 14-5M20 12a8 8 0 0 1-14 5M18 4v4h-4M6 20v-4h4",
    verb: "Turn auto-renew on for each",
  },
  "renew-auto-off": {
    label: "Auto-renew off",
    icon: "M4 12a8 8 0 0 1 14-5M20 12a8 8 0 0 1-14 5M18 4v4h-4M6 20v-4h4",
    verb: "Turn auto-renew off for each",
    warn:
      "A domain with auto-renew off expires unless somebody renews it by hand. " +
      "Expiry is the one thing on this page that cannot be reversed after long " +
      "enough.",
    danger: true,
  },
};

/** Batches of twelve, matching the server. Anything larger runs past its limit. */
const BATCH = 12;

export default function BulkBar({
  targets,
  onClear,
  onDone,
  onExport,
}: {
  targets: BulkTarget[];
  onClear: () => void;
  onDone: () => void;
  /** Built by the table, which is the only thing holding every column. */
  onExport: () => void;
}) {
  /**
   * Grouping is not one of the actions above.
   *
   * Those all reach a registrar or Cloudflare and change something outside this
   * console, which is why they are batched, confirmed and reported per domain.
   * A group is a label held here. It needs none of that, and putting it through
   * the same machinery would dress a harmless thing up as a dangerous one.
   */
  const [grouping, setGrouping] = useState(false);
  const [pending, setPending] = useState<BulkAction | null>(null);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [results, setResults] = useState<Outcome[] | null>(null);
  const stop = useRef(false);

  useEffect(() => {
    // A selection that changes mid-run would send domains nobody chose.
    stop.current = false;
  }, [targets]);

  async function run(action: BulkAction) {
    setRunning(true);
    setDone(0);
    setResults(null);
    const collected: Outcome[] = [];

    try {
      for (let i = 0; i < targets.length; i += BATCH) {
        if (stop.current) break;

        const response = await fetch("/api/domains/bulk", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action, targets: targets.slice(i, i + BATCH) }),
        });
        const payload = await response.json();

        if (!response.ok) {
          collected.push({
            domain: `${targets.length - i} remaining`,
            ok: false,
            note: payload.error ?? `The server answered ${response.status}.`,
          });
          break;
        }

        collected.push(...(payload.results ?? []));
        setDone(collected.length);
        setResults([...collected]);
      }
    } finally {
      setRunning(false);
      setResults(collected);
      setPending(null);
      onDone();
    }
  }

  const spec = pending ? ACTIONS[pending] : null;
  const failed = results?.filter((r) => !r.ok) ?? [];

  return (
    <>
      <div className="bulkbar" role="region" aria-label="Actions for the selected domains">
        <div className="bulkbar-inner">
          <button type="button" className="bulkbar-count" onClick={onClear}>
            <strong>{targets.length}</strong> selected
            <span className="bulkbar-x" aria-hidden>
              ×
            </span>
          </button>

          {running ? (
            <div className="bulkbar-progress">
              <span>
                {done} of {targets.length}
              </span>
              <span className="bulkbar-track">
                <span
                  className="bulkbar-fill"
                  style={{ width: `${Math.round((done / Math.max(1, targets.length)) * 100)}%` }}
                />
              </span>
              <button
                type="button"
                className="bulkbar-action"
                onClick={() => {
                  stop.current = true;
                }}
              >
                Stop
              </button>
            </div>
          ) : (
            <>
              <button
                type="button"
                className="bulkbar-action"
                onClick={() => setGrouping(true)}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                  <path d="M3 7h7v5H3zM14 7h7v5h-7zM3 16h7v4H3zM14 16h7v4h-7z" />
                </svg>
                Group
              </button>
              <button type="button" className="bulkbar-action" onClick={onExport}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                  <path d="M12 3v12M8 11l4 4 4-4M4 21h16" />
                </svg>
                Export CSV
              </button>
              <span className="bulkbar-sep" aria-hidden />
              {(Object.keys(ACTIONS) as BulkAction[]).map((key) => (
              <button
                key={key}
                type="button"
                className={
                  ACTIONS[key].danger ? "bulkbar-action is-danger" : "bulkbar-action"
                }
                onClick={() => setPending(key)}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                  <path d={ACTIONS[key].icon} />
                </svg>
                {ACTIONS[key].label}
              </button>
              ))}
            </>
          )}
        </div>
      </div>

      {/* Kept on screen after the run, because the failures are the reason
          anybody reads a bulk result and a toast would take them away. */}
      {results && !running ? (
        <div className="bulk-result">
          <div className="bulk-result-head">
            <strong>
              {results.length - failed.length} done, {failed.length} failed
            </strong>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setResults(null)}>
              Dismiss
            </button>
          </div>
          {failed.length ? (
            <ul className="bulk-result-list">
              {failed.slice(0, 40).map((f) => (
                <li key={f.domain}>
                  <code>{f.domain}</code> {f.note}
                </li>
              ))}
              {failed.length > 40 ? <li>and {failed.length - 40} more</li> : null}
            </ul>
          ) : null}
        </div>
      ) : null}

      {grouping ? (
        <GroupDialog
          domains={targets.map((t) => t.domain)}
          onClose={() => setGrouping(false)}
          onSaved={onDone}
        />
      ) : null}

      <ConfirmDialog
        open={!!pending}
        title={`${spec?.label} for ${targets.length} domain${targets.length === 1 ? "" : "s"}?`}
        confirmLabel={spec?.label ?? "Do it"}
        busyLabel="Working…"
        cancelLabel="Cancel"
        busy={running}
        onDismiss={() => setPending(null)}
        body={
          <>
            <p>{spec?.verb} of the selected domains.</p>
            <p className="confirm-quiet">
              {targets
                .slice(0, 6)
                .map((t) => t.domain)
                .join(", ")}
              {targets.length > 6 ? `, and ${targets.length - 6} more` : ""}
            </p>
            {spec?.warn ? <p className="confirm-warn">{spec.warn}</p> : null}
          </>
        }
        onConfirm={() => {
          if (pending) void run(pending);
        }}
      />
    </>
  );
}
