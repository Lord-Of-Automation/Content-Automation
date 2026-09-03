/**
 * Domain names that are actually free, with what they cost.
 *
 * A generator that only invents names is a thesaurus. Every interesting name
 * anyone thinks of is already registered, so the useful half of the work is the
 * check — and the check is what a person cannot do by hand across a hundred
 * candidates and six extensions.
 *
 * Candidates come from two places. GoDaddy's own suggestion engine, which knows
 * what sells and returns names nobody here would think of, and a small set of
 * patterns applied to the words you typed, which is what catches the obvious
 * combination the engine skipped. Both are then checked in bulk: one request
 * per hundred names, answering availability and price together, so a search
 * over six extensions is a handful of calls rather than hundreds.
 *
 * Nothing here registers anything. Availability is a read.
 */

import { credentialFor } from "./providers";

const HOST = "https://api.godaddy.com";
/** GoDaddy's ceiling for one bulk availability request. */
const BATCH = 100;
/** Enough to choose from, few enough to read. */
export const MAX_CANDIDATES = 320;

export interface Candidate {
  domain: string;
  suffix: string;
  /** Micro-units. 12990000 is 12.99. Null when GoDaddy priced nothing. */
  price: number | null;
  renewalPrice: number | null;
  currency: string;
  /** Characters before the dot, which is most of what makes a name good. */
  length: number;
  /** Where it came from, so a good suggestion can be credited to the engine. */
  origin: "suggested" | "combined" | "exact";
}

export interface GenerateResult {
  candidates: Candidate[];
  /** How many names were checked to find them. */
  checked: number;
  /** Extensions asked for that GoDaddy would not check. */
  refused: string[];
  note: string;
}

/**
 * Words that turn one idea into several without changing what it means.
 *
 * Deliberately small and deliberately generic. A long list produces a long list
 * of rubbish, and the semantic work belongs to the suggestion engine, which is
 * better at it. These exist to catch the obvious pairing a machine skipped:
 * "the" plus the word, the word plus "hq".
 */
const PREFIXES = ["get", "try", "the", "my", "go", "join", "play", "best", "top"];
const SUFFIXES = ["hq", "hub", "now", "pro", "club", "zone", "site", "spot", "guide", "365"];

/** Only what a hostname may contain, and never leading or trailing hyphens. */
function slug(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 40);
}

/**
 * The names to check, before anything is known about them.
 *
 * Ordered so the plainest come first: the words exactly as typed, then the two
 * of them joined, then the decorated forms. The check preserves that order, so
 * a free exact match never appears below a suffixed one.
 */
export function candidatesFor(seed: string, tlds: string[]): Array<{ domain: string; origin: Candidate["origin"] }> {
  const words = seed
    .split(/[\s,]+/)
    .map(slug)
    .filter(Boolean)
    .slice(0, 4);

  if (!words.length) return [];

  const stems: Array<{ stem: string; origin: Candidate["origin"] }> = [];
  const seen = new Set<string>();
  const add = (stem: string, origin: Candidate["origin"]) => {
    if (stem.length < 3 || stem.length > 40 || seen.has(stem)) return;
    seen.add(stem);
    stems.push({ stem, origin });
  };

  // Exactly what was typed, joined and separately.
  add(words.join(""), "exact");
  for (const word of words) add(word, "exact");

  // The words paired the other way round, which is a different name.
  if (words.length > 1) add([...words].reverse().join(""), "combined");

  const base = words.join("");
  for (const p of PREFIXES) add(`${p}${base}`, "combined");
  for (const s of SUFFIXES) add(`${base}${s}`, "combined");

  const out: Array<{ domain: string; origin: Candidate["origin"] }> = [];
  for (const { stem, origin } of stems) {
    for (const tld of tlds) out.push({ domain: `${stem}.${tld}`, origin });
  }
  return out;
}

/** GoDaddy's own engine, which is better at meaning than any word list here. */
async function suggested(
  seed: string,
  tlds: string[],
  authorization: string,
): Promise<string[]> {
  try {
    const url = new URL(`${HOST}/v1/domains/suggest`);
    url.searchParams.set("query", seed.slice(0, 80));
    url.searchParams.set("tlds", tlds.join(","));
    url.searchParams.set("limit", "40");
    // Longer names are what a suggestion engine reaches for when the short ones
    // are gone, and they are the ones nobody ends up using.
    url.searchParams.set("lengthMax", "25");

    const response = await fetch(url, {
      headers: { authorization, accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) return [];

    const body = (await response.json()) as Array<{ domain?: string }>;
    return Array.isArray(body)
      ? body.map((row) => String(row.domain ?? "").toLowerCase()).filter(Boolean)
      : [];
  } catch {
    // The patterns alone still produce a usable search.
    return [];
  }
}

/** Availability and price for up to a hundred names in one request. */
async function checkBatch(
  names: string[],
  authorization: string,
): Promise<Map<string, { available: boolean; price: number | null; renewal: number | null; currency: string }>> {
  const out = new Map<
    string,
    { available: boolean; price: number | null; renewal: number | null; currency: string }
  >();

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
    if (!response.ok) return out;

    const body = (await response.json()) as {
      domains?: Array<{
        domain?: string;
        available?: boolean;
        price?: number;
        renewalPrice?: number;
        currency?: string;
      }>;
    };

    for (const row of body.domains ?? []) {
      const name = String(row.domain ?? "").toLowerCase();
      if (!name) continue;
      out.set(name, {
        available: row.available === true,
        price: typeof row.price === "number" ? row.price : null,
        renewal: typeof row.renewalPrice === "number" ? row.renewalPrice : null,
        currency: row.currency ?? "USD",
      });
    }
  } catch {
    // A batch that fails leaves its names unchecked rather than failing the
    // search: nineteen good answers beat one error.
  }

  return out;
}

export async function generateNames(seed: string, tlds: string[]): Promise<GenerateResult> {
  const credential = await credentialFor("godaddy");
  const token = credential?.token?.trim();
  if (!token) {
    throw new Error(
      "No GoDaddy token is set, and the availability check needs one. " +
        "Add it on the Keys page.",
    );
  }
  const authorization = `Bearer ${token}`;

  const wanted = [...new Set(tlds.map((t) => t.replace(/^\./, "").toLowerCase()).filter(Boolean))];
  if (!wanted.length) throw new Error("Choose at least one extension.");

  const ours = candidatesFor(seed, wanted);
  if (!ours.length) throw new Error("Type a word or two to build names from.");

  const theirs = await suggested(seed, wanted, authorization);

  // Ours first, so an exact match outranks a suggestion of the same thing, and
  // deduplicated on the full name rather than the stem.
  const order = new Map<string, Candidate["origin"]>();
  for (const c of ours) if (!order.has(c.domain)) order.set(c.domain, c.origin);
  for (const name of theirs) {
    // The engine ignores the extension filter often enough to be worth
    // enforcing here; a .shop suggestion in a .com search is noise.
    const suffix = name.slice(name.indexOf(".") + 1);
    if (!wanted.includes(suffix)) continue;
    if (!order.has(name)) order.set(name, "suggested");
  }

  const names = [...order.keys()].slice(0, MAX_CANDIDATES);

  const found = new Map<string, Awaited<ReturnType<typeof checkBatch>> extends Map<string, infer V> ? V : never>();
  for (let i = 0; i < names.length; i += BATCH) {
    const batch = names.slice(i, i + BATCH);
    const answers = await checkBatch(batch, authorization);
    for (const [name, answer] of answers) found.set(name, answer);
  }

  const refused = wanted.filter(
    (tld) => !names.some((n) => n.endsWith(`.${tld}`) && found.has(n)),
  );

  const candidates: Candidate[] = [];
  for (const name of names) {
    const answer = found.get(name);
    if (!answer?.available) continue;
    const dot = name.indexOf(".");
    candidates.push({
      domain: name,
      suffix: name.slice(dot + 1),
      price: answer.price,
      renewalPrice: answer.renewal,
      currency: answer.currency,
      length: dot,
      origin: order.get(name) ?? "suggested",
    });
  }

  return {
    candidates,
    checked: found.size,
    refused,
    note:
      names.length >= MAX_CANDIDATES
        ? `Checked the first ${MAX_CANDIDATES} names. Narrow the extensions for a deeper search.`
        : "",
  };
}
