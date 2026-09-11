"use client";

import { useCallback, useEffect, useState } from "react";

import RunProgress from "@/components/RunProgress";
import StatusBadge from "@/components/StatusBadge";
import { useToasts } from "@/components/Toasts";
import type { ExecutionDetail } from "@/lib/n8n";
import type { Campaign } from "@/lib/mail";
import { runLabel } from "@/lib/runlabel";

/**
 * The runs this page started, and only those.
 *
 * The Runs page lists every run this platform has ever done — crawls,
 * rewrites, site builds — and a campaign is one row among hundreds of them.
 * Which is the right place for it and the wrong place to watch it from, since
 * watching means leaving the page you started it on and finding it again.
 *
 * Different from History next door, and the difference is the question each
 * answers. History is what came of a campaign: who was written to, where the
 * drafts are, who was skipped and why. This is the run itself: which step it is
 * on, what it has cost, and the button that stops it.
 *
 * Which runs are campaigns is decided on the engine, where the mode is written
 * down. The run list this console usually reads does not carry it, so the list
 * comes from the campaigns endpoint and the detail from the ordinary one.
 */

const POLL = 4000;

function terminal(status: string | undefined): boolean {
  return (
    status === "success" || status === "error" || status === "canceled" || status === "crashed"
  );
}

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

export default function MailingRuns() {
  const { push } = useToasts();

  const [runs, setRuns] = useState<Campaign[]>([]);
  const [at, setAt] = useState<string | null>(null);
  const [detail, setDetail] = useState<ExecutionDetail | null>(null);

  const [loading, setLoading] = useState(true);
  const [reading, setReading] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    try {
      const response = await fetch("/api/mail/campaigns", { cache: "no-store" });
      if (response.status === 401) {
        window.location.href = "/login";
        return [];
      }
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "The runs could not be read.");
      const rows: Campaign[] = payload.campaigns ?? [];
      setRuns(rows);
      setError(null);
      return rows;
    } catch (e) {
      setError(e instanceof Error ? e.message : "The runs could not be read.");
      return [];
    }
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    setReading(true);
    try {
      const response = await fetch(`/api/runs/${encodeURIComponent(id)}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "That run could not be read.");
      setDetail(payload.execution ?? null);
    } catch (e) {
      push("bad", e instanceof Error ? e.message : "That run could not be read.");
    } finally {
      setReading(false);
    }
  }, [push]);

  // The newest one on arrival, which is the one somebody has just started or
  // the one they last cared about.
  useEffect(() => {
    void (async () => {
      const rows = await loadList();
      setLoading(false);
      if (rows.length) {
        setAt(rows[0]!.id);
        await loadDetail(rows[0]!.id);
      }
    })();
  }, [loadList, loadDetail]);

  /*
   * Kept up to date only while something is actually happening.
   *
   * A campaign takes minutes and the page is worth leaving open for them. A
   * finished one never changes again, so polling it would be asking the same
   * question forever.
   */
  useEffect(() => {
    if (!at || terminal(detail?.status)) return;
    const timer = window.setInterval(() => {
      void loadDetail(at);
      void loadList();
    }, POLL);
    return () => window.clearInterval(timer);
  }, [at, detail?.status, loadDetail, loadList]);

  async function stop() {
    if (!at) return;
    setStopping(true);
    try {
      const response = await fetch(`/api/runs/${encodeURIComponent(at)}/stop`, { method: "POST" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "It could not be stopped.");
      push("ok", "Stopping. Publishers already written to keep their articles.");
      await loadDetail(at);
      await loadList();
    } catch (e) {
      push("bad", e instanceof Error ? e.message : "It could not be stopped.");
    } finally {
      setStopping(false);
    }
  }

  if (loading) return <p className="provider-hint history-empty">Reading the runs…</p>;
  if (error) return <div className="notice bad mail-notice">{error}</div>;

  if (!runs.length) {
    return (
      <p className="provider-hint history-empty">
        No campaign has run yet. One appears here the moment you start one, and
        this is where to watch it.
      </p>
    );
  }

  return (
    <div className="mail-runs mail-late">
      {/* The list stays beside the run rather than above it, so switching
          between two of them does not move the thing being read. */}
      <nav className="mail-runs-list" aria-label="Campaign runs">
        {runs.map((one) => (
          <button
            key={one.id}
            type="button"
            className={one.id === at ? "mail-run is-on" : "mail-run"}
            onClick={() => {
              setAt(one.id);
              void loadDetail(one.id);
            }}
          >
            <StatusBadge status={one.status as never} />
            <span className="mail-run-anchor">{one.anchor || "no anchor recorded"}</span>
            {/* Named the way the Runs page names it, so the same run can be
                found on the list that holds every kind of run. On its own line
                beneath the anchor: it shared the date's line to begin with and
                the two together came to more than the column is wide, so the
                pair ran out of the card. */}
            <span className="mail-run-id mono">{runLabel(one.id, true)}</span>
            <span className="mail-run-at">{when(one.startedAt)}</span>
          </button>
        ))}
      </nav>

      <div className="mail-runs-one">
        <RunProgress
          execution={detail}
          loading={reading && !detail}
          onCancel={stop}
          cancelling={stopping}
        />
      </div>
    </div>
  );
}
