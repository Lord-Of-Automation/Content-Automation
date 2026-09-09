"use client";

import { useMemo, useState } from "react";

/**
 * Is this name free, and what would it cost.
 *
 * The name generator answers the same question about names it invented. This
 * answers it about the names you already have in mind, which is the more common
 * situation and was the one thing the console could not do: you had a list on
 * paper and typed it into a registrar's search box one line at a time.
 *
 * It reports the taken ones too. "No" is the answer most names get, and a
 * checker that only lists the winners leaves you working out which of yours are
 * missing from it.
 *
 * Nothing here buys anything. A free name links to GoDaddy's own page, because
 * a purchase is a decision with a bill attached and it belongs where the person
 * making it can see the terms.
 */

type Status = "free" | "taken" | "unknown";

type Checked = {
  domain: string;
  status: Status;
  price: number | null;
  renewal: number | null;
  currency: string;
  definitive: boolean;
  note: string;
};

/** GoDaddy prices in millionths. Rendered in the viewer's own locale. */
function money(micro: number | null, currency: string): string {
  if (micro === null) return "—";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(micro / 1_000_000);
  } catch {
    return `${(micro / 1_000_000).toFixed(2)} ${currency}`;
  }
}

/**
 * The extensions a bare word is tried against.
 *
 * Only used for words with no extension of their own: a line that already says
 * ".io" has already decided. Each one ticked multiplies how many names a word
 * becomes, which is why this is a short list of the ones people buy rather than
 * GoDaddy's several hundred.
 */
const COMMON = ["com", "net", "org", "co", "io", "casino", "bet", "club", "live", "site"];
const DEFAULT_TLDS = ["com", "net", "co"];

const TONE: Record<Status, string> = {
  free: "ok",
  taken: "idle",
  unknown: "warn",
};

const LABEL: Record<Status, string> = {
  free: "Free",
  taken: "Taken",
  unknown: "Unknown",
};

type Only = "all" | "free" | "taken";

export default function DomainCheck() {
  const [names, setNames] = useState("");
  const [tlds, setTlds] = useState<string[]>(DEFAULT_TLDS);
  const [extra, setExtra] = useState("");
  const [only, setOnly] = useState<Only>("all");

  const [rows, setRows] = useState<Checked[] | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chosen = useMemo(() => {
    const typed = extra
      .split(/[\s,.]+/)
      .map((t) => t.replace(/^\./, "").toLowerCase())
      .filter(Boolean);
    return [...new Set([...tlds, ...typed])];
  }, [extra, tlds]);

  const shown = useMemo(
    () => (rows ?? []).filter((r) => only === "all" || r.status === only),
    [only, rows],
  );

  const totals = useMemo(() => {
    const list = rows ?? [];
    return {
      free: list.filter((r) => r.status === "free").length,
      taken: list.filter((r) => r.status === "taken").length,
      unknown: list.filter((r) => r.status === "unknown").length,
    };
  }, [rows]);

  /** What the cheapest free one costs, which is the figure people scan for. */
  const cheapest = useMemo(() => {
    const priced = (rows ?? []).filter(
      (r): r is Checked & { price: number } => r.status === "free" && r.price !== null,
    );
    if (!priced.length) return null;
    return priced.reduce((low, r) => (r.price < low.price ? r : low));
  }, [rows]);

  async function check() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/domains/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ names, tlds: chosen }),
      });
      if (response.status === 401) {
        window.location.href = "/login";
        return;
      }
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? `The check returned ${response.status}.`);

      setRows(payload.rows as Checked[]);
      setNote(String(payload.note ?? ""));
      setOnly("all");
    } catch (e) {
      setError(e instanceof Error ? e.message : "The names could not be checked.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div className="card">
        <div className="card-head">
          <div>
            <h2>Availability</h2>
            <p>
              Whether a name can be bought, and what GoDaddy asks for it. Paste
              a list, or type a word and pick the extensions to try it against.
            </p>
          </div>
        </div>

        <div className="card-body">
          {error ? <div className="notice bad">{error}</div> : null}

          <div className="field">
            <label htmlFor="check-names">Names</label>
            <textarea
              id="check-names"
              className="url-list"
              rows={4}
              value={names}
              placeholder="mystake.com, slotsireland, bonuscompare.co.uk"
              onChange={(e) => setNames(e.target.value)}
              onKeyDown={(e) => {
                // Enter makes a new line, because the box is a list. The
                // shortcut is the one every multi-line form uses.
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !busy) {
                  e.preventDefault();
                  void check();
                }
              }}
            />
            <div className="note">
              One per line, or separated by commas. A whole address pasted out
              of the browser is fine. A line with no extension is tried against
              each one chosen below; a line that already carries one is checked
              exactly as written.
            </div>
          </div>

          <div className="field">
            <label>Extensions for the bare words</label>
            <div className="tldpick">
              {COMMON.map((tld) => (
                <button
                  key={tld}
                  type="button"
                  className={tlds.includes(tld) ? "tld is-on" : "tld"}
                  onClick={() =>
                    setTlds((current) =>
                      current.includes(tld)
                        ? current.filter((t) => t !== tld)
                        : [...current, tld],
                    )
                  }
                >
                  .{tld}
                </button>
              ))}
            </div>
            <input
              type="text"
              className="tld-extra"
              placeholder="or type others: .ie .co.uk .gg"
              value={extra}
              onChange={(e) => setExtra(e.target.value)}
            />
            <div className="note">
              Only used for lines that have no extension of their own.{" "}
              {chosen.length} selected.
            </div>
          </div>

          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void check()}
            disabled={busy || !names.trim() || !chosen.length}
          >
            {busy ? "Checking…" : "Check availability"}
          </button>
        </div>
      </div>

      {rows ? (
        <div className="card">
          <div className="card-head">
            <div>
              <h2>{rows.length} checked</h2>
              <p>
                {totals.free} free, {totals.taken} taken
                {totals.unknown ? `, ${totals.unknown} not answered` : ""}
                {cheapest ? ` · cheapest is ${cheapest.domain} at ${money(cheapest.price, cheapest.currency)}` : ""}
              </p>
            </div>
          </div>

          <div className="card-body tight">
            {note ? <div className="notice warn">{note}</div> : null}

            <div className="domain-bar">
              <div className="seg seg-sm">
                {(
                  [
                    ["all", `All ${rows.length}`],
                    ["free", `Free ${totals.free}`],
                    ["taken", `Taken ${totals.taken}`],
                  ] as Array<[Only, string]>
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    className={only === key ? "seg-btn is-on" : "seg-btn"}
                    onClick={() => setOnly(key)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {!shown.length ? (
              <div className="empty">Nothing in this filter.</div>
            ) : (
              <table className="logs logs-middle">
                <thead>
                  <tr>
                    <th>Domain</th>
                    <th className="mid">Status</th>
                    <th className="num">First year</th>
                    <th className="num">Renews for</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {shown.map((row) => (
                    <tr key={row.domain}>
                      <td>
                        <span className="domain-name">{row.domain}</span>
                        {row.note ? <div className="app-sub">{row.note}</div> : null}
                      </td>
                      <td className="mid">
                        <span className={`pill pill-${TONE[row.status]}`}>
                          {LABEL[row.status]}
                        </span>
                      </td>
                      {/* Both prices, because they are different numbers and
                          the second is the one paid every year after this one.
                          A first year discounted to nothing on a name that
                          renews at ninety is the trap this column exists to
                          show. */}
                      <td className="num">{money(row.price, row.currency)}</td>
                      <td className="num">{money(row.renewal, row.currency)}</td>
                      <td className="row-actions">
                        {row.status === "free" ? (
                          <a
                            className="btn btn-ghost btn-sm"
                            href={`https://www.godaddy.com/domainsearch/find?domainToCheck=${encodeURIComponent(row.domain)}`}
                            target="_blank"
                            rel="noreferrer noopener"
                          >
                            Buy at GoDaddy
                          </a>
                        ) : row.status === "taken" ? (
                          <a
                            className="btn btn-ghost btn-sm"
                            href={`https://${row.domain}`}
                            target="_blank"
                            rel="noreferrer noopener"
                          >
                            Visit
                          </a>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <p className="domain-note">
              Prices are GoDaddy&rsquo;s published rate for the extension at the
              moment of the check, before any discount, promotion or multi-year
              term. Nothing here buys a name: a free row links to GoDaddy&rsquo;s
              own page, where the price you are actually charged is the one shown
              at checkout.
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
