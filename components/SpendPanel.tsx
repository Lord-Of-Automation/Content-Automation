"use client";

import { useCallback, useEffect, useState } from "react";

type RunSpend = {
  id: string;
  actor: string | null;
  at: string | null;
  status: string;
  total: number | null;
  website: string | null;
};

type Spend = {
  runs: RunSpend[];
  total: number;
  byActor: { actor: string; total: number; runs: number }[];
  byMonth: { month: string; total: number; runs: number }[];
};

function money(value: number): string {
  if (value === 0) return "$0";
  if (value < 0.01) return "$" + value.toFixed(4);
  return "$" + value.toFixed(2);
}

function monthLabel(month: string): string {
  const date = new Date(`${month}-01T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return month;
  return date.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export default function SpendPanel() {
  const [spend, setSpend] = useState<Spend | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/spend?limit=25", { cache: "no-store" });
      if (response.status === 401) {
        window.location.href = "/login";
        return;
      }
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Could not load spend.");
      setSpend(payload as Spend);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load spend.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Not polled: pricing is the expensive call in this app, and the numbers only
  // move when a run finishes.
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>Spend</h2>
          <p>Across the last 25 runs, attributed by who started them.</p>
        </div>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => void load()}
          disabled={loading}
        >
          {loading ? "Pricing…" : "Refresh"}
        </button>
      </div>

      <div className="card-body">
        {error ? <div className="notice bad">{error}</div> : null}

        {loading && !spend ? (
          <div className="empty">
            Pricing the recent runs. The first pass reads each execution in full,
            so it is slow; results are cached after that.
          </div>
        ) : null}

        {spend ? (
          <>
            <div className="spend-total">
              <span className="spend-total-label">Total</span>
              <span className="spend-total-amount">{money(spend.total)}</span>
            </div>

            <div className="spend-split">
              <div>
                <h3 className="spend-head">By person</h3>
                {spend.byActor.length === 0 ? (
                  <p className="empty">Nothing priced yet.</p>
                ) : (
                  <ul className="spend-list">
                    {spend.byActor.map((row) => (
                      <li key={row.actor}>
                        <span className="spend-name">{row.actor}</span>
                        <span className="spend-runs">
                          {row.runs} run{row.runs === 1 ? "" : "s"}
                        </span>
                        <span className="spend-amount">{money(row.total)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <h3 className="spend-head">By month</h3>
                {spend.byMonth.length === 0 ? (
                  <p className="empty">Nothing priced yet.</p>
                ) : (
                  <ul className="spend-list">
                    {spend.byMonth.map((row) => (
                      <li key={row.month}>
                        <span className="spend-name">{monthLabel(row.month)}</span>
                        <span className="spend-runs">
                          {row.runs} run{row.runs === 1 ? "" : "s"}
                        </span>
                        <span className="spend-amount">{money(row.total)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
