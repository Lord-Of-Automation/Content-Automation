/**
 * Buying a domain, which is the one thing this console does that spends money.
 *
 * Separate from godaddy.ts on purpose. That file reads: it lists what the
 * account holds and asks what a suffix costs, and every call in it can be made
 * twice with no consequence. Nothing in this file is like that. A registration
 * is a charge against a card and a name somebody else can no longer have, and
 * keeping the two apart means the difference is visible in the import line
 * rather than only in a comment.
 *
 * GoDaddy splits a purchase into three calls, and the split is the safety.
 *
 *   1. Ask for a quote. It answers with a price, the agreements that have to
 *      be accepted, and a token that stands for that exact price for ten
 *      minutes.
 *   2. Register, quoting the token. The price cannot have moved underneath,
 *      because the token is the price.
 *   3. Poll, because it finishes in the background.
 *
 * What that buys is a confirmation somebody can actually read. A dialog saying
 * "this will cost 12.17 USD" is only honest if that figure is the one that
 * will be charged, and the token is what makes it the same figure.
 *
 * The money itself never passes through here. GoDaddy charges the payment
 * method on the account: there is no card field in the API, and a quote on an
 * account with no billing set up fails before any of this is reached.
 */

import { credentialFor } from "./providers";

const HOST = "https://api.godaddy.com";

/** Raised when the account cannot buy, as opposed to the request being wrong. */
export class GoDaddyBuyError extends Error {}

export interface Quote {
  domain: string;
  available: boolean;
  /** Millionths, the way every other GoDaddy price in this console arrives. */
  price: number | null;
  currency: string;
  period: number;
  /** Single use, ten minutes. The price is only a promise while this is valid. */
  quoteToken: string;
  expiresAt: string;
  /** Their codes, which have to be echoed back verbatim on the purchase. */
  agreements: string[];
  /** What each agreement is called, for the dialog that asks somebody to accept it. */
  agreementTitles: string[];
}

export interface Registration {
  registrationId: string;
  domain: string;
  /** CONFIRMED while it is happening, then COMPLETED or FAILED. */
  status: string;
}

/**
 * The header GoDaddy wants, worked out once.
 *
 * The same two credential shapes the reading half deals with. A Personal
 * Access Token goes as a bearer token; the older pair goes as sso-key. Unlike
 * the reading half this does not try both in turn — a purchase is not a
 * request to make twice to find out which header works.
 */
async function authorization(): Promise<string> {
  const key = (await credentialFor("godaddy"))?.token?.trim() || process.env.GODADDY_API_KEY?.trim();
  const secret = process.env.GODADDY_API_SECRET?.trim();

  if (!key) {
    throw new GoDaddyBuyError(
      "No GoDaddy token is set, so nothing can be bought. Add one on the Keys page.",
    );
  }
  if (secret) return `sso-key ${key}:${secret}`;
  if (key.startsWith("gd_pat_")) return `Bearer ${key}`;

  throw new GoDaddyBuyError(
    "That GoDaddy credential is the older key-and-secret kind and its secret is " +
      "not set, so a purchase cannot be signed. Use a Personal Access Token, " +
      "which starts gd_pat_, or set GODADDY_API_SECRET.",
  );
}

/** Millionths, out of whatever shape the price came in. */
function micros(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return Math.round(raw);

  if (typeof raw === "object") {
    const box = raw as Record<string, unknown>;
    for (const name of ["micros", "amount", "value", "listPrice", "current"]) {
      const found = micros(box[name]);
      if (found !== null) return found;
    }
  }
  return null;
}

function currencyIn(raw: unknown, fallback = "USD"): string {
  if (raw && typeof raw === "object") {
    const found = (raw as Record<string, unknown>).currency;
    if (typeof found === "string" && found.trim()) return found.trim().toUpperCase();
  }
  return fallback;
}

/**
 * What GoDaddy said, in words worth putting in front of somebody.
 *
 * The two that matter here are the ones nobody can guess at: an account with
 * no payment method, and an account not allowed to buy through the API at all.
 * Both arrive as a plain 4xx with a code, and both are fixed somewhere other
 * than this console.
 */
function explain(status: number, body: string): string {
  let code = "";
  let message = "";
  try {
    const parsed = JSON.parse(body) as { code?: string; message?: string };
    code = String(parsed.code ?? "");
    message = String(parsed.message ?? "");
  } catch {
    message = body.slice(0, 300);
  }

  if (/NO_PAYMENT_PROFILE|PAYMENT/i.test(code)) {
    return (
      "That GoDaddy account has no payment method on file, so nothing can be " +
      "charged. Add one in the GoDaddy account itself — a card cannot be given " +
      "to this API."
    );
  }
  if (status === 401 || status === 403) {
    return (
      "GoDaddy refused that token for buying. Reading domains and buying them " +
      "are separate permissions, and buying also needs the account to be " +
      "eligible for paid API calls." + (message ? ` It said: ${message}` : "")
    );
  }
  if (status === 409) {
    return `That domain is no longer available${message ? `: ${message}` : "."}`;
  }
  if (status === 429) {
    return "GoDaddy is rate limiting this token. Wait a minute and try again.";
  }
  return `GoDaddy answered ${status}${code ? ` (${code})` : ""}${message ? `: ${message}` : ""}`;
}

async function call(
  path: string,
  init: { method: string; body?: unknown; headers?: Record<string, string> },
): Promise<Record<string, unknown>> {
  const response = await fetch(`${HOST}${path}`, {
    method: init.method,
    headers: {
      authorization: await authorization(),
      accept: "application/json",
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });

  const text = await response.text().catch(() => "");
  if (!response.ok) throw new GoDaddyBuyError(explain(response.status, text));

  try {
    return text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    throw new GoDaddyBuyError("GoDaddy answered with something that was not JSON.");
  }
}

/**
 * A price that will still be the price when somebody presses the button.
 *
 * Contacts are deliberately not sent. Leaving the profile out tells GoDaddy to
 * register in the account's own identity, which is what every domain this
 * console has ever bought by hand already is. Sending a half-filled contact
 * block instead would be a worse registration, not a more configurable one.
 */
export async function quoteDomain(domain: string, period: number): Promise<Quote> {
  const name = String(domain ?? "").trim().toLowerCase();
  if (!name.includes(".")) throw new GoDaddyBuyError(`"${domain}" is not a domain name.`);

  const years = Math.max(1, Math.min(10, Math.round(Number(period) || 1)));

  const answer = await call("/v3/domains/registration-quotes", {
    method: "POST",
    body: { domain: name, period: years },
  });

  const agreements = Array.isArray(answer.requiredAgreements)
    ? (answer.requiredAgreements as Record<string, unknown>[])
    : [];

  return {
    domain: String(answer.domain ?? name),
    available: answer.available !== false,
    price: micros(answer.price),
    currency: currencyIn(answer.price),
    period: years,
    quoteToken: String(answer.quoteToken ?? ""),
    expiresAt: String(answer.expiresAt ?? ""),
    agreements: agreements
      .map((one) => String(one.agreementType ?? one.type ?? one.key ?? ""))
      .filter(Boolean),
    agreementTitles: agreements
      .map((one) => String(one.title ?? one.name ?? one.agreementType ?? ""))
      .filter(Boolean),
  };
}

/**
 * The charge.
 *
 * The idempotency key comes from the caller rather than being made here. It
 * has to survive a retry to be worth anything: a key minted inside this
 * function would be a different key on the second attempt, which is exactly
 * the case it exists to protect against — a request that timed out on the way
 * back, after the domain had already been bought.
 */
export async function registerDomain(options: {
  domain: string;
  period: number;
  quoteToken: string;
  agreements: string[];
  idempotencyKey: string;
}): Promise<Registration> {
  if (!options.quoteToken) {
    throw new GoDaddyBuyError("That quote has no token, so there is no price to hold to.");
  }
  if (!options.idempotencyKey) {
    throw new GoDaddyBuyError("A purchase needs an idempotency key, so a retry cannot buy twice.");
  }

  const answer = await call("/v3/domains/registrations", {
    method: "POST",
    headers: { "Idempotency-Key": options.idempotencyKey },
    body: {
      domain: options.domain,
      period: options.period,
      quoteToken: options.quoteToken,
      consent: {
        agreementTypes: options.agreements,
        // Now, because now is when somebody pressed the button. GoDaddy keeps
        // this as the record of when the terms were accepted.
        agreedAt: new Date().toISOString(),
      },
    },
  });

  return {
    registrationId: String(answer.registrationId ?? ""),
    domain: String(answer.domain ?? options.domain),
    status: String(answer.status ?? "CONFIRMED"),
  };
}

/** Where a registration got to. CONFIRMED means still going. */
export async function registrationStatus(registrationId: string): Promise<Registration> {
  const id = String(registrationId ?? "").trim();
  if (!id) throw new GoDaddyBuyError("No registration was named.");

  const answer = await call(`/v3/domains/registrations/${encodeURIComponent(id)}`, {
    method: "GET",
  });

  return {
    registrationId: String(answer.registrationId ?? id),
    domain: String(answer.domain ?? ""),
    status: String(answer.status ?? "CONFIRMED"),
  };
}
