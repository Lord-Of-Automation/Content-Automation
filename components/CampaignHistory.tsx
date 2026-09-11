"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import StatusBadge from "@/components/StatusBadge";
import type { Campaign } from "@/lib/mail";

/**
 * Every campaign that has run, and what came of it.
 *
 * Read out of the run records rather than kept a second time. A campaign is a
 * run — that is what gives it a log, a cost line and a cancel button — so its
 * history is the runs that were campaigns, and a separate list of them would be
 * a second account of the same thing, free to disagree with the first.
 *
 * What each row answers is "what did this cost me and what did I get": how many
 * publishers were chosen, how many were actually written to, and where the
 * article each one received lives. The drafts are the part worth keeping,
 * because they are the thing a publisher is reading while deciding.
 */

function when(value: string | null | undefined): string {
  if (!value) return "";
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return "";
  return at.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** How long it took, in the roughest terms that are still true. */
function took(from: string, to: string | null): string {
  if (!to) return "";
  const ms = new Date(to).getTime() - new Date(from).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "under a minute";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.round(minutes / 60);
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}

export default function CampaignHistory() {
  const [rows, setRows] = useState<Campaign[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/mail/campaigns", { cache: "no-store" });
      if (response.status === 401) {
        window.location.href = "/login";
        return;
      }
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "The campaigns could not be read.");
      setRows(payload.campaigns ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The campaigns could not be read.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <p className="provider-hint history-empty">Reading the campaigns…</p>;
  if (error) return <div className="notice bad mail-notice">{error}</div>;

  if (!rows.length) {
    return (
      <p className="provider-hint history-empty">
        No campaign has run yet. One appears here the moment you start one, and
        stays whatever happens to it.
      </p>
    );
  }

  return (
    <ul className="history">
      {rows.map((one) => {
        const showing = open === one.id;
        return (
          <li className="campaign-run" key={one.id}>
            <button
              type="button"
              className="campaign-run-head"
              onClick={() => setOpen(showing ? null : one.id)}
            >
              <StatusBadge status={one.status as never} />
              <span className="campaign-run-anchor">
                {one.anchor || "no anchor recorded"}
              </span>
              <span className="campaign-run-count">
                {/* Written to, out of chosen. Both, because the gap between
                    them is the thing worth noticing: publishers skipped for a
                    missing address or an unusable sender are work not done. */}
                {one.written.length} of {one.chosen} written to
                {one.skipped.length ? `, ${one.skipped.length} skipped` : ""}
              </span>
              <span className="campaign-run-at">
                {when(one.startedAt)}
                {took(one.startedAt, one.stoppedAt) ? ` · ${took(one.startedAt, one.stoppedAt)}` : ""}
              </span>
            </button>

            {one.error ? <p className="campaign-run-error">{one.error}</p> : null}

            {showing ? (
              <div className="campaign-run-body">
                <dl className="campaign-run-facts">
                  <div>
                    <dt>Link placed</dt>
                    <dd>
                      {one.anchorUrl ? (
                        <a href={one.anchorUrl} target="_blank" rel="noreferrer">
                          {one.anchor || one.anchorUrl}
                        </a>
                      ) : (
                        "—"
                      )}
                    </dd>
                  </div>
                  {one.brief ? (
                    <div>
                      <dt>Brief</dt>
                      <dd>{one.brief}</dd>
                    </div>
                  ) : null}
                  <div>
                    <dt>Run</dt>
                    <dd>
                      {/* The log, for the questions this summary cannot answer:
                          what each site turned out to be about, and what the
                          whole thing cost. */}
                      <Link href={`/runs?run=${encodeURIComponent(one.id)}`}>{one.id}</Link>
                    </dd>
                  </div>
                </dl>

                {one.written.length ? (
                  <>
                    <h4 className="campaign-run-h">Articles written</h4>
                    <ul className="campaign-drafts">
                      {one.written.map((row) => (
                        <li key={row.draft || row.domain}>
                          <span className="mono">{row.domain}</span>
                          {row.draft ? (
                            <a href={row.draft} target="_blank" rel="noreferrer">
                              Open the draft
                            </a>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}

                {one.skipped.length ? (
                  <>
                    <h4 className="campaign-run-h">Skipped</h4>
                    <ul className="campaign-drafts">
                      {one.skipped.map((row) => (
                        <li key={row.domain}>
                          <span className="mono">{row.domain}</span>
                          <em>{row.because}</em>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
