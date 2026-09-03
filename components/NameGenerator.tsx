"use client";

import { useMemo, useState } from "react";

type Candidate = {
  domain: string;
  suffix: string;
  price: number | null;
  renewalPrice: number | null;
  currency: string;
  length: number;
  origin: "suggested" | "combined" | "exact";
};

/** Both registrars price in millionths. Rendered in the viewer's own locale. */
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
 * The extensions worth offering by default.
 *
 * Not GoDaddy's whole list, which runs to hundreds. Each one you tick
 * multiplies how many names get checked, so the chooser is a short list of the
 * ones people actually buy, with a box for anything else.
 */
const COMMON = ["com", "net", "org", "co", "io", "casino", "bet", "club", "live", "site"];
const DEFAULT_TLDS = ["com", "net", "co"];

type Order = "short" | "cheap" | "renew";

const ORIGIN_NOTE: Record<Candidate["origin"], string> = {
  exact: "what you typed",
  combined: "your words, rearranged",
  suggested: "GoDaddy's suggestion",
};

export default function NameGenerator() {
  const [seed, setSeed] = useState("");
  const [tlds, setTlds] = useState<string[]>(DEFAULT_TLDS);
  const [extra, setExtra] = useState("");
  const [order, setOrder] = useState<Order>("short");

  const [results, setResults] = useState<Candidate[] | null>(null);
  const [checked, setChecked] = useState(0);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chosen = useMemo(() => {
    const typed = extra
      .split(/[\s,]+/)
      .map((t) => t.replace(/^\./, "").toLowerCase())
      .filter(Boolean);
    return [...new Set([...tlds, ...typed])].slice(0, 8);
  }, [tlds, extra]);

  const ranked = useMemo(() => {
    if (!results) return [];
    const list = [...results];
    if (order === "short") {
      list.sort((a, b) => a.length - b.length || a.domain.localeCompare(b.domain));
    } else if (order === "cheap") {
      list.sort(
        (a, b) => (a.price ?? Infinity) - (b.price ?? Infinity) || a.length - b.length,
      );
    } else {
      list.sort(
        (a, b) =>
          (a.renewalPrice ?? Infinity) - (b.renewalPrice ?? Infinity) || a.length - b.length,
      );
    }
    return list;
  }, [results, order]);

  async function search() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/domains/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ seed, tlds: chosen }),
      });
      if (response.status === 401) {
        window.location.href = "/login";
        return;
      }
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "The search did not work.");
      setResults(payload.candidates ?? []);
      setChecked(payload.checked ?? 0);
      setNote(payload.note ?? "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "The search did not work.");
      setResults(null);
    } finally {
      setBusy(false);
    }
  }

  function toggleTld(tld: string) {
    setTlds((current) =>
      current.includes(tld) ? current.filter((t) => t !== tld) : [...current, tld],
    );
  }

  return (
    <div className="stack">
      <div className="card">
        <div className="card-head">
          <div>
            <h2>Name generator</h2>
            <p>
              Names built from your words and from GoDaddy&rsquo;s suggestions,
              then checked so only the free ones come back &mdash; with what
              each costs to buy and to keep.
            </p>
          </div>
        </div>

        <div className="card-body">
          {error ? <div className="notice bad">{error}</div> : null}

          <div className="field">
            <label htmlFor="seed">Words to build from</label>
            <input
              id="seed"
              type="text"
              placeholder="lucky spins"
              value={seed}
              onChange={(e) => setSeed(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && seed.trim() && !busy) void search();
              }}
            />
            <div className="note">
              One or two words works best. They are combined, reversed and
              decorated, and sent to GoDaddy&rsquo;s suggestion engine as typed.
            </div>
          </div>

          <div className="field">
            <label>Extensions</label>
            <div className="tldpick">
              {COMMON.map((tld) => (
                <button
                  key={tld}
                  type="button"
                  className={tlds.includes(tld) ? "tld is-on" : "tld"}
                  onClick={() => toggleTld(tld)}
                >
                  .{tld}
                </button>
              ))}
            </div>
            <input
              type="text"
              className="tld-extra"
              placeholder="or type others: .uk .gg .fun"
              value={extra}
              onChange={(e) => setExtra(e.target.value)}
            />
            <div className="note">
              {/* Said out loud because it is the one setting that decides how
                  long the search takes and how deep it goes. */}
              Each extension multiplies how many names get checked, so at most
              eight are used. {chosen.length} selected.
            </div>
          </div>

          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void search()}
            disabled={busy || !seed.trim() || !chosen.length}
          >
            {busy ? "Checking…" : "Find free names"}
          </button>
        </div>
      </div>

      {results ? (
        <div className="card">
          <div className="card-head">
            <div>
              <h2>{results.length} free</h2>
              <p>
                Out of {checked} names checked. {note}
              </p>
            </div>
            <div className="seg seg-sm">
              {(
                [
                  ["short", "Shortest"],
                  ["cheap", "Cheapest to buy"],
                  ["renew", "Cheapest to keep"],
                ] as Array<[Order, string]>
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  className={order === key ? "seg-btn is-on" : "seg-btn"}
                  onClick={() => setOrder(key)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="card-body tight">
            {!results.length ? (
              <div className="empty">
                Every name built from those words is taken. Try another word, or
                add an extension.
              </div>
            ) : (
              <table className="logs">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th className="num">Length</th>
                    <th className="num">First year</th>
                    <th className="num">Renews for</th>
                    <th>Came from</th>
                  </tr>
                </thead>
                <tbody>
                  {ranked.map((c) => (
                    <tr key={c.domain}>
                      <td>
                        {/* Straight to GoDaddy's basket for that exact name.
                            Buying is the next thing anyone does here, and this
                            page deliberately cannot do it. */}
                        <a
                          className="domain-name"
                          href={`https://www.godaddy.com/domainsearch/find?domainToCheck=${encodeURIComponent(c.domain)}`}
                          target="_blank"
                          rel="noreferrer noopener"
                        >
                          {c.domain}
                        </a>
                      </td>
                      <td className="num">{c.length}</td>
                      <td className="num">{money(c.price, c.currency)}</td>
                      <td className="num">{money(c.renewalPrice, c.currency)}</td>
                      <td className="detail">
                        <span className="registrar">{ORIGIN_NOTE[c.origin]}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <p className="domain-note">
              Availability and price come from GoDaddy and are read only &mdash;
              nothing here registers anything. The first year is often a
              promotion and the renewal is what you pay every year after, which
              is why both are shown.
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
