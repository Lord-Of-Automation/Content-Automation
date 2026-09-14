"use client";

import { useRef, useState } from "react";

import { useAsk } from "@/components/Ask";

/**
 * Buying a domain, from wherever a domain is shown.
 *
 * Two pages offer names to buy: the availability check, where you look a name
 * up, and the generator, where the platform suggests them. Both want the same
 * thing to happen when somebody presses Buy, and a second copy of that is the
 * last thing this codebase needs — a flow that charges a card and cannot be
 * undone should exist once, so a fix to it is a fix everywhere.
 *
 * The steps are GoDaddy's and the split is the safety. A quote answers with a
 * price and a token that stands for it for ten minutes; the registration
 * quotes the token, so the price cannot move underneath; the result is polled,
 * because it finishes in the background. That is what lets the dialog name the
 * figure that will actually be charged.
 */

/** Millionths, rendered in the viewer's own locale. How every price here arrives. */
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

/** Which domain is being bought and how far it has got. */
export type Buying = {
  domain: string;
  stage: "quoting" | "buying" | "waiting";
} | null;

type Quote = {
  price: number | null;
  currency: string;
  period: number;
  quoteToken: string;
  agreements: string[];
  agreementTitles: string[];
};

export function useBuyDomain(push: (tone: "ok" | "bad", text: string) => void) {
  const ask = useAsk();

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

  /**
   * Buying one.
   *
   * A quote first, so the dialog can name the price that will actually be
   * charged rather than the one a listing happened to mention. The two are
   * usually the same and the difference is the point: a quote is a promise for
   * ten minutes, and a price in a table is a guess.
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

      const quote = quoted.quote as Quote;

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

  return {
    buy,
    /** What is being bought right now, if anything. */
    buying,
    /** Everything bought since this page was opened. */
    bought,
    /** The label a Buy button should carry, for one domain. */
    labelFor(domain: string, price: number | null, currency: string): string {
      if (bought.has(domain)) return "Bought";
      if (buying?.domain !== domain) return `Buy for ${money(price, currency)}`;
      if (buying.stage === "quoting") return "Checking the price…";
      if (buying.stage === "buying") return "Buying…";
      return "Registering…";
    },
  };
}
