/**
 * Whether a domain can be bought, and for how much.
 *
 * One call answers both, for up to a hundred names at a time, which is what
 * makes checking a list worth doing here instead of typing each one into a
 * registrar's search box.
 *
 * The check is a read. Nothing in this file registers anything, and nothing in
 * this console does: buying a name is a decision with a bill attached and it
 * belongs on GoDaddy's own page, which every free row links to.
 *
 * Two callers share it. The name generator, which invents names and keeps the
 * free ones, and the availability page, which checks the names you already have
 * in mind and reports the taken ones too. They want opposite halves of the same
 * answer, so the answer is returned whole and each keeps what it needs.
 */

import { credentialFor } from "./providers";

const HOST = "https://api.godaddy.com";

/** GoDaddy's ceiling for one bulk availability request. */
export const BATCH = 100;

/** Enough to paste a list, few enough that one check stays one page of work. */
export const MOST_NAMES = 200;

export interface Availability {
  domain: string;
  available: boolean;
  /** Micro-units. 12990000 is 12.99. Null when GoDaddy priced nothing. */
  price: number | null;
  renewal: number | null;
  currency: string;
  /**
   * Whether GoDaddy checked the registry or guessed.
   *
   * The fast path answers from a cached view and is occasionally wrong about a
   * name registered minutes ago. Worth saying rather than hiding: a name this
   * calls free and the checkout calls taken is a worse surprise than a hedge.
   */
  definitive: boolean;
}

export interface Checked {
  domain: string;
  status: "free" | "taken" | "unknown";
  price: number | null;
  renewal: number | null;
  currency: string;
  definitive: boolean;
  /** Why it could not be answered, when it could not. */
  note: string;
}

export interface CheckResult {
  rows: Checked[];
  /** How many of them GoDaddy actually answered for. */
  answered: number;
  note: string;
}

/** The token, or a sentence saying where to put one. */
export async function goDaddyAuthorization(): Promise<string> {
  const credential = await credentialFor("godaddy");
  const token = credential?.token?.trim();
  if (!token) {
    throw new Error(
      "No GoDaddy token is set, and the availability check needs one. " +
        "Add it on the Keys page.",
    );
  }
  return `Bearer ${token}`;
}

/**
 * Availability and price for up to a hundred names in one request.
 *
 * Returns what it learned rather than throwing on a bad batch. A hundred names
 * where ninety-nine are answerable should not fail because of the hundredth,
 * and a name that came back in neither list is reported as unchecked rather
 * than quietly assumed free, which is the one wrong answer that costs money.
 */
export async function checkBatch(
  names: string[],
  authorization: string,
): Promise<{ found: Map<string, Availability>; refused: Map<string, string> }> {
  const found = new Map<string, Availability>();
  const refused = new Map<string, string>();
  if (!names.length) return { found, refused };

  try {
    const response = await fetch(`${HOST}/v1/domains/available?checkType=FULL`, {
      method: "POST",
      headers: {
        authorization,
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify(names),
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });

    /*
     * A 422 is the normal answer to a batch containing something GoDaddy will
     * not check, and it still carries the rows for everything else. Treating it
     * as a failure threw away every good answer in the batch for the sake of
     * one unsupported extension.
     */
    if (!response.ok && response.status !== 422) return { found, refused };

    const body = (await response.json()) as {
      domains?: Array<{
        domain?: string;
        available?: boolean;
        definitive?: boolean;
        price?: number;
        renewalPrice?: number;
        currency?: string;
      }>;
      errors?: Array<{ domain?: string; code?: string; message?: string }>;
    };

    for (const row of body.domains ?? []) {
      const name = String(row.domain ?? "").toLowerCase();
      if (!name) continue;
      found.set(name, {
        domain: name,
        available: row.available === true,
        definitive: row.definitive !== false,
        price: typeof row.price === "number" ? row.price : null,
        renewal: typeof row.renewalPrice === "number" ? row.renewalPrice : null,
        currency: row.currency ?? "USD",
      });
    }

    for (const row of body.errors ?? []) {
      const name = String(row.domain ?? "").toLowerCase();
      if (!name || found.has(name)) continue;
      refused.set(
        name,
        row.code === "UNSUPPORTED_TLD"
          ? "GoDaddy does not sell this extension."
          : row.message || row.code || "GoDaddy would not check it.",
      );
    }
  } catch {
    // A batch that fails leaves its names unchecked rather than failing the
    // whole request. Ninety good answers beat one error.
  }

  return { found, refused };
}

/** Only what a hostname may contain, and never a leading or trailing hyphen. */
function stem(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9-]+/g, "")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
}

/**
 * What was typed, as a list of names to check.
 *
 * People paste all sorts of things into a box like this: a bare word, a name
 * with an extension, a whole address copied out of the browser, a column out of
 * a spreadsheet. All of them mean the same thing here.
 *
 * A word with no extension is checked against every extension chosen, because
 * that is what somebody typing one word means. A name that already carries one
 * is checked exactly as given, because they have already decided.
 */
export function namesFrom(input: string, tlds: string[]): string[] {
  const suffixes = [
    ...new Set(tlds.map((t) => t.replace(/^\./, "").toLowerCase()).filter(Boolean)),
  ];

  const out: string[] = [];
  const seen = new Set<string>();
  const add = (name: string) => {
    if (seen.has(name) || out.length >= MOST_NAMES) return;
    seen.add(name);
    out.push(name);
  };

  for (const raw of String(input ?? "").split(/[\s,;]+/)) {
    // An address pasted whole: the protocol, the path and any www go.
    const bare = raw
      .trim()
      .toLowerCase()
      .replace(/^[a-z]+:\/\//, "")
      .split("/")[0]!
      .replace(/^www\./, "");
    if (!bare) continue;

    if (bare.includes(".")) {
      const dot = bare.indexOf(".");
      const label = stem(bare.slice(0, dot));
      const suffix = bare
        .slice(dot + 1)
        .replace(/[^a-z0-9.]+/g, "")
        .replace(/^\.+|\.+$/g, "");
      if (label && suffix) add(`${label}.${suffix}`);
      continue;
    }

    const label = stem(bare);
    if (!label) continue;
    for (const suffix of suffixes) add(`${label}.${suffix}`);
  }

  return out;
}

/**
 * One search: the name asked for, and the same name elsewhere.
 *
 * What somebody types into a box like this is one name, and the answer they
 * want is bigger than a row in a table: is this the name, yes or no, and what
 * would it cost. So the name asked for is answered first and on its own, and
 * the same stem on other extensions comes underneath as somewhere to go when
 * the answer was no.
 *
 * Both halves are one request. Availability is priced per call, not per name,
 * so offering the alternatives costs nothing over answering the question.
 */
export interface SearchResult {
  /** The names actually asked for, in the order typed. Usually one. */
  asked: Checked[];
  /** The first name's stem on other extensions, free ones first. */
  others: Checked[];
  /** The stem the alternatives are built from, for the heading. */
  stem: string;
  note: string;
}

/** The part before the first dot, which is the name; the rest is the ending. */
export function splitName(domain: string): { label: string; suffix: string } {
  const dot = domain.indexOf(".");
  return dot < 0
    ? { label: domain, suffix: "" }
    : { label: domain.slice(0, dot), suffix: domain.slice(dot + 1) };
}

export async function searchDomain(input: string, tlds: string[]): Promise<SearchResult> {
  const authorization = await goDaddyAuthorization();

  /*
   * Bare words get one extension here, not all of them.
   *
   * On the checker a word meant "try it everywhere". Here the alternatives are
   * a section of their own, so expanding the word as well would put the same
   * five names in both halves of the page.
   */
  const suffixes = [
    ...new Set(tlds.map((t) => t.replace(/^\./, "").toLowerCase()).filter(Boolean)),
  ];
  // A word with no ending of its own gets the first one chosen, and .com when
  // nothing was chosen at all, because that is what people mean by a name.
  const asked = namesFrom(input, [suffixes[0] ?? "com"]);
  if (!asked.length) {
    throw new Error("Type a domain, or a word and the extensions to try it with.");
  }

  const stem = splitName(asked[0]!).label;
  const taken = new Set(asked);
  const others = suffixes
    .map((suffix) => `${stem}.${suffix}`)
    .filter((name) => !taken.has(name))
    .slice(0, MOST_NAMES - asked.length);

  const all = [...asked, ...others];
  const found = new Map<string, Availability>();
  const refused = new Map<string, string>();
  for (let i = 0; i < all.length; i += BATCH) {
    const answer = await checkBatch(all.slice(i, i + BATCH), authorization);
    for (const [name, row] of answer.found) found.set(name, row);
    for (const [name, why] of answer.refused) refused.set(name, why);
  }

  const row = (domain: string): Checked => {
    const answer = found.get(domain);
    if (answer) {
      return {
        domain,
        status: answer.available ? "free" : "taken",
        price: answer.price,
        renewal: answer.renewal,
        currency: answer.currency,
        definitive: answer.definitive,
        note: answer.definitive
          ? ""
          : "GoDaddy answered from its cache rather than the registry.",
      };
    }
    return {
      domain,
      status: "unknown",
      price: null,
      renewal: null,
      currency: "USD",
      definitive: false,
      note: refused.get(domain) ?? "GoDaddy did not answer for this one.",
    };
  };

  /*
   * Free first among the alternatives, and the ones that could not be checked
   * last. The question underneath a taken name is "what can I have instead",
   * and an ending nobody could price is not an answer to it.
   */
  const rank = { free: 0, taken: 1, unknown: 2 } as const;

  return {
    asked: asked.map(row),
    others: others
      .map(row)
      .sort((a, b) => rank[a.status] - rank[b.status]),
    stem,
    note: "",
  };
}

/**
 * Check a list of names, and say so for every one of them.
 *
 * Order is preserved, because it is the order somebody typed and they are
 * reading down their own list. Taken names are reported rather than dropped:
 * "no" is the answer most of these get, and a checker that only shows the
 * successes leaves you counting which of your names are missing.
 */
export async function checkDomains(input: string, tlds: string[]): Promise<CheckResult> {
  const authorization = await goDaddyAuthorization();

  const names = namesFrom(input, tlds);
  if (!names.length) {
    throw new Error("Type a domain, or a word and the extensions to try it with.");
  }

  const found = new Map<string, Availability>();
  const refused = new Map<string, string>();
  for (let i = 0; i < names.length; i += BATCH) {
    const answer = await checkBatch(names.slice(i, i + BATCH), authorization);
    for (const [name, row] of answer.found) found.set(name, row);
    for (const [name, why] of answer.refused) refused.set(name, why);
  }

  const rows: Checked[] = names.map((domain) => {
    const row = found.get(domain);
    if (row) {
      return {
        domain,
        status: row.available ? "free" : "taken",
        price: row.price,
        renewal: row.renewal,
        currency: row.currency,
        definitive: row.definitive,
        note: row.definitive ? "" : "GoDaddy answered from its cache rather than the registry.",
      };
    }
    return {
      domain,
      status: "unknown",
      price: null,
      renewal: null,
      currency: "USD",
      definitive: false,
      note: refused.get(domain) ?? "GoDaddy did not answer for this one.",
    };
  });

  return {
    rows,
    answered: found.size,
    note:
      names.length >= MOST_NAMES
        ? `Checked the first ${MOST_NAMES} names. Send the rest as a second list.`
        : "",
  };
}
