"use client";

import { useMemo, useRef, useState } from "react";

import { useAsk } from "@/components/Ask";
import { Toasts, useToasts } from "@/components/Toasts";

/**
 * Is this name free, and what would it cost.
 *
 * The name generator answers that about names it invented. This answers it
 * about the name you already have in mind, which is the more common situation
 * and the one thing this console could not do: you had a name on paper and
 * typed it into a registrar's search box.
 *
 * Shaped like a registrar's own search on purpose, because that is the shape of
 * the question. One box, one answer, and somewhere to go when the answer is no.
 * The name asked for gets a card of its own; the same name on other endings
 * follows underneath, which is what people want next and costs nothing extra to
 * find out, since availability is priced per call rather than per name.
 *
 * Nothing here buys anything. A free name links to GoDaddy's own page, because
 * a purchase is a decision with a bill attached and belongs where the person
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

type Answer = {
  asked: Checked[];
  others: Checked[];
  stem: string;
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
 * The endings a name is offered on when the one asked for is gone.
 *
 * A short list of the ones people buy rather than GoDaddy's several hundred,
 * with the two this business actually uses among them.
 */
const COMMON = ["com", "net", "org", "co", "io", "casino", "bet", "club", "live", "site"];
const DEFAULT_TLDS = ["com", "net", "org", "co", "io", "casino", "bet"];

const BADGE: Record<Status, { label: string; tone: string }> = {
  free: { label: "Available", tone: "free" },
  taken: { label: "Taken", tone: "taken" },
  unknown: { label: "Not checked", tone: "unknown" },
};

const PILL: Record<Status, string> = { free: "ok", taken: "idle", unknown: "warn" };

/** The name, split so the ending can be coloured the way a registrar does. */
function Name({ domain }: { domain: string }) {
  const dot = domain.indexOf(".");
  if (dot < 0) return <span className="dname">{domain}</span>;
  return (
    <span className="dname">
      {domain.slice(0, dot)}
      <span className="dname-tld">{domain.slice(dot)}</span>
    </span>
  );
}

/**
 * What is worth saying about a name, in facts rather than in praise.
 *
 * A registrar's version of this section sells. There is nothing to sell here,
 * so it says only what is true of the name in front of you and might weigh on
 * the decision. The renewal line is the one that earns its place: a first year
 * at a penny on a name that renews at ninety is the trap this page exists to
 * show.
 */
function reasons(row: Checked): string[] {
  const dot = row.domain.indexOf(".");
  const label = dot < 0 ? row.domain : row.domain.slice(0, dot);
  const suffix = dot < 0 ? "" : row.domain.slice(dot + 1);

  if (row.status === "taken") {
    return ["Somebody already owns it. The endings below are the ones still free."];
  }
  if (row.status === "unknown") {
    return [row.note || "GoDaddy did not answer for this one."];
  }

  const out: string[] = [];
  if (suffix === "com") out.push("Uses .com, which is still what people type first.");
  out.push(
    `${label.length} character${label.length === 1 ? "" : "s"} before the dot` +
      (label.length <= 10 ? ", short enough to say out loud." : "."),
  );
  if (!/[0-9]/.test(label) && !label.includes("-")) {
    out.push("No digits and no hyphens, so it survives being read down a phone.");
  }
  if (row.renewal !== null && row.price !== null && row.renewal > row.price) {
    out.push(
      `The first year is the cheap one. It renews at ${money(row.renewal, row.currency)} a year after that.`,
    );
  }
  if (!row.definitive) {
    out.push("GoDaddy answered from its cache, so check again at the till.");
  }
  return out;
}

/** One result: the name, what it costs, and the way to buy it. */
function Card({
  row,
  lead,
  onBuy,
  buying,
  bought,
}: {
  row: Checked;
  lead?: boolean;
  /** Buys it. Absent on the cards that are only showing an alternative. */
  onBuy?: (domain: string) => void;
  /** What this card is doing, if it is the one being bought. */
  buying?: "quoting" | "buying" | "waiting" | null;
  bought?: boolean;
}) {
  const badge = BADGE[row.status];
  return (
    <div className={lead ? "dcard is-lead" : "dcard"}>
      <span className={`dbadge is-${badge.tone}`}>{badge.label}</span>

      <h3>
        <Name domain={row.domain} />
      </h3>

      <div className="dprice">
        {row.status === "free" ? (
          <>
            <span className="dprice-now">{money(row.price, row.currency)}</span>
            <span className="dprice-note">
              first year
              {row.renewal !== null
                ? `, then ${money(row.renewal, row.currency)} a year`
                : ""}
            </span>
          </>
        ) : (
          <span className="dprice-none">
            {row.status === "taken" ? "Not for sale here" : "No price"}
          </span>
        )}
      </div>

      {row.status === "free" && bought ? (
        <span className="btn dbuy is-bought">Bought</span>
      ) : row.status === "free" && onBuy ? (
        <>
          {/* Bought here, on the account whose token this console already
              holds. The link below stays for the things this cannot do:
              choosing a different registrant, adding privacy, paying with
              something other than the card on file. */}
          <button
            type="button"
            className="btn btn-primary dbuy"
            disabled={!!buying}
            onClick={() => onBuy(row.domain)}
          >
            {buying === "quoting"
              ? "Checking the price…"
              : buying === "buying"
                ? "Buying…"
                : buying === "waiting"
                  ? "Registering…"
                  : `Buy for ${money(row.price, row.currency)}`}
          </button>
          <a
            className="dbuy-else"
            href={`https://www.godaddy.com/domainsearch/find?domainToCheck=${encodeURIComponent(row.domain)}`}
            target="_blank"
            rel="noreferrer noopener"
          >
            or buy it at GoDaddy
          </a>
        </>
      ) : row.status === "free" ? (
        <a
          className="btn btn-primary dbuy"
          href={`https://www.godaddy.com/domainsearch/find?domainToCheck=${encodeURIComponent(row.domain)}`}
          target="_blank"
          rel="noreferrer noopener"
        >
          Buy at GoDaddy
        </a>
      ) : row.status === "taken" ? (
        <a
          className="btn btn-ghost dbuy"
          href={`https://${row.domain}`}
          target="_blank"
          rel="noreferrer noopener"
        >
          See what is there
        </a>
      ) : null}

      <div className="dwhy">
        <strong>What to know</strong>
        <ul>
          {reasons(row).map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** Where a purchase has got to, for the one domain being bought. */
type Buying = { domain: string; stage: "quoting" | "buying" | "waiting" } | null;

export default function DomainCheck() {
  const ask = useAsk();
  const { toasts, push, dismiss } = useToasts();

  const [buying, setBuying] = useState<Buying>(null);
  const [bought, setBought] = useState<Set<string>>(new Set());

  /*
   * One idempotency key per domain, kept for as long as the page is open.
   *
   * The key is the whole defence against buying twice. A registration that
   * times out on the way back has still been made, and a retry carrying a new
   * key would be a second purchase rather than a second attempt at the first —
   * so the key belongs to the domain, not to the attempt.
   */
  const keys = useRef(new Map<string, string>());

  function keyFor(domain: string): string {
    const had = keys.current.get(domain);
    if (had) return had;
    const made = crypto.randomUUID();
    keys.current.set(domain, made);
    return made;
  }

  const [query, setQuery] = useState("");
  const [tlds, setTlds] = useState<string[]>(DEFAULT_TLDS);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState(false);

  /**
   * Buying one.
   *
   * A quote first, so the dialog can name the price that will actually be
   * charged rather than the one the availability check happened to mention.
   * The two are usually the same and the difference is the point: a quote is a
   * promise for ten minutes, and a price on a card is a guess.
   *
   * Then the purchase, then polling, because GoDaddy finishes a registration
   * in the background. Nothing here says the domain is bought until GoDaddy
   * says so.
   */
  async function buy(domain: string, years = 1) {
    if (buying) return;

    setBuying({ domain, stage: "quoting" });
    try {
      const asked = await fetch("/api/domains/buy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "quote", domain, period: years }),
      });
      const quoted = await asked.json();
      if (!asked.ok) throw new Error(quoted.error ?? "That price could not be checked.");

      const quote = quoted.quote as {
        price: number | null;
        currency: string;
        period: number;
        quoteToken: string;
        agreements: string[];
        agreementTitles: string[];
      };

      setBuying(null);
      const sure = await ask.confirm({
        title: `Buy ${domain} for ${money(quote.price, quote.currency)}?`,
        body: (
          <>
            <p className="confirm-quiet">
              {quote.period === 1 ? "One year" : `${quote.period} years`}, charged
              now to the payment method on the GoDaddy account. This is the
              price GoDaddy has just quoted and held, not an estimate.
            </p>
            <p className="confirm-quiet">
              It renews at whatever the renewal price is then, which is not this
              number. Turn auto-renew off at GoDaddy if that is not wanted.
            </p>
            {quote.agreementTitles.length ? (
              <p className="confirm-quiet">
                Buying accepts {quote.agreementTitles.join(", ")}.
              </p>
            ) : null}
          </>
        ),
        confirmLabel: "Buy it",
      });
      if (!sure) return;

      setBuying({ domain, stage: "buying" });
      const made = await fetch("/api/domains/buy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          domain,
          period: quote.period,
          quoteToken: quote.quoteToken,
          agreements: quote.agreements,
          idempotencyKey: keyFor(domain),
        }),
      });
      const started = await made.json();
      if (!made.ok) throw new Error(started.error ?? "That domain could not be bought.");

      // GoDaddy answers before it has finished. Waited out here rather than
      // reported as done, because "bought" should mean bought.
      setBuying({ domain, stage: "waiting" });
      const id = String(started.registration?.registrationId ?? "");
      const landed = id ? await settle(id) : "COMPLETED";

      if (landed === "FAILED") {
        throw new Error(`GoDaddy could not finish registering ${domain}.`);
      }

      setBought((was) => new Set(was).add(domain));
      push("ok", `${domain} is yours. It appears on the Domains page shortly.`);
    } catch (e) {
      push("bad", e instanceof Error ? e.message : "That domain could not be bought.");
    } finally {
      setBuying(null);
    }
  }

  /** Asks until it is one thing or the other, and gives up rather than hanging. */
  async function settle(id: string): Promise<string> {
    for (let tries = 0; tries < 40; tries += 1) {
      await new Promise((wait) => setTimeout(wait, 1500));
      try {
        const response = await fetch(`/api/domains/buy?id=${encodeURIComponent(id)}`, {
          cache: "no-store",
        });
        const payload = await response.json();
        if (!response.ok) continue;
        const status = String(payload.registration?.status ?? "");
        if (status === "COMPLETED" || status === "FAILED") return status;
      } catch {
        // A dropped poll is not a failed purchase. It asks again.
      }
    }
    // A minute of CONFIRMED and no answer. The charge has been made and the
    // name is coming; saying it failed would be worse than saying it is slow.
    return "SLOW";
  }

  const lead = answer?.asked[0] ?? null;

  const free = useMemo(
    () => (answer?.others ?? []).filter((r) => r.status === "free"),
    [answer],
  );
  const rest = useMemo(
    () => (answer?.others ?? []).filter((r) => r.status !== "free"),
    [answer],
  );

  async function search() {
    const text = query.trim();
    if (!text || busy) return;

    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/domains/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ names: text, tlds }),
      });
      if (response.status === 401) {
        window.location.href = "/login";
        return;
      }
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? `The check returned ${response.status}.`);

      setAnswer(payload as Answer);
    } catch (e) {
      setAnswer(null);
      setError(e instanceof Error ? e.message : "The name could not be checked.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      {/* The search, and almost nothing else, because on arrival there is only
          one thing to do here. The endings live behind the button beside it:
          they are a setting somebody adjusts once, not part of asking. */}
      <div className="dsearch">
        <button
          type="button"
          className={settings ? "dsearch-tune is-on" : "dsearch-tune"}
          aria-expanded={settings}
          title="Which endings to offer when the name is taken"
          onClick={() => setSettings((on) => !on)}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
            <path d="M4 8h9M17 8h3M4 16h3M11 16h9" />
            <circle cx="15" cy="8" r="2" />
            <circle cx="9" cy="16" r="2" />
          </svg>
        </button>

        <div className="dsearch-box">
          <svg className="dsearch-glass" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <path d="M16.5 16.5L21 21" />
          </svg>
          <input
            type="search"
            value={query}
            placeholder="Type a name, with or without its ending"
            aria-label="Domain to check"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void search();
              }
            }}
          />
          <button
            type="button"
            className="dsearch-go"
            onClick={() => void search()}
            disabled={busy || !query.trim()}
          >
            {busy ? "Searching…" : "Search domains"}
          </button>
        </div>
      </div>

      {settings ? (
        <div className="card">
          <div className="card-body">
            <div className="field">
              <label>Endings to offer</label>
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
              <div className="note">
                These are the alternatives offered underneath the answer. A name
                typed with its own ending is always checked exactly as written.
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {error ? <div className="notice bad">{error}</div> : null}

      {answer && lead ? (
        <>
          <h2 className="dhead">
            {lead.status === "free"
              ? `${lead.domain} is yours to take`
              : lead.status === "taken"
                ? `${lead.domain} is already registered`
                : `${lead.domain} could not be checked`}
          </h2>

          <div className="dcards">
            {answer.asked.map((row, i) => (
              <Card
                  key={row.domain}
                  row={row}
                  lead={i === 0}
                  onBuy={buy}
                  buying={buying?.domain === row.domain ? buying.stage : null}
                  bought={bought.has(row.domain)}
                />
            ))}

            {/* Beside the answer rather than below it when the answer was no.
                The next thing wanted is the nearest thing available, and it
                should not need a scroll. */}
            {lead.status !== "free" && free.length ? (
              <Card
                row={free[0]!}
                onBuy={buy}
                buying={buying?.domain === free[0]!.domain ? buying.stage : null}
                bought={bought.has(free[0]!.domain)}
              />
            ) : null}
          </div>

          {free.length || rest.length ? (
            <div className="card">
              <div className="card-head">
                <div>
                  <h2>Other endings for {answer.stem}</h2>
                  <p>
                    {free.length
                      ? `${free.length} of these can be bought right now.`
                      : "None of these are free either."}
                  </p>
                </div>
              </div>

              <div className="card-body tight">
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
                    {[...free, ...rest].map((row) => (
                      <tr key={row.domain}>
                        <td>
                          <Name domain={row.domain} />
                          {row.note ? <div className="app-sub">{row.note}</div> : null}
                        </td>
                        <td className="mid">
                          <span className={`pill pill-${PILL[row.status]}`}>
                            {BADGE[row.status].label}
                          </span>
                        </td>
                        {/* Both prices, because they are different numbers and
                            the second is the one paid every year after this. */}
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
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <p className="domain-note">
                  Prices are GoDaddy&rsquo;s published rate for the ending at the
                  moment of the check, before any discount, promotion or
                  multi-year term. Buying one here charges the payment method
                  on the GoDaddy account, at the price GoDaddy quotes and holds
                  when you press the button rather than the one on this row.
                </p>
              </div>
            </div>
          ) : null}
        </>
      ) : null}

      <Toasts toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
