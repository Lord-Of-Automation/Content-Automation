/**
 * What a page type is, for both halves of the console.
 *
 * The engine keeps page types and is the authority on them
 * (src/custom/pagetype.ts over there). This is a copy of the shape and nothing
 * more: no fetch, no session, no filesystem, so the Custom page can import it
 * into the browser without dragging the engine client along. The client that
 * does the talking is lib/pagetypes.ts, next door.
 *
 * Kept in step by hand. A field added on the engine and not here is a field the
 * editor cannot show and a save quietly drops, so the two change together.
 */

/** The shared building blocks a page can include. Their design is the engine's. */
export const BLOCKS = ["facts_table", "pros_cons", "faq", "contents"] as const;
export type Block = (typeof BLOCKS)[number];

/** What each block is called on the page, in the order the editor offers them. */
export const BLOCK_LABELS: Record<Block, string> = {
  facts_table: "Facts table",
  pros_cons: "Pros and cons",
  faq: "FAQ",
  contents: "Table of contents",
};

/** Structured data a type may publish beside the FAQ's. Empty means none. */
export const SCHEMA_TYPES = [
  "",
  "Person",
  "Organization",
  "Product",
  "SoftwareApplication",
  "VideoGame",
  "Event",
  "Place",
  "Article",
] as const;
export type SchemaType = (typeof SCHEMA_TYPES)[number];

export interface FactField {
  /** Short and stable: what the research and the structured data call it. */
  key: string;
  /** What a reader sees in the facts table. */
  label: string;
  /** What counts as an answer, in what unit, from when. Read by the researcher. */
  hint: string;
  /**
   * Whether the page may state it only when the research found it. A verified
   * fact no source stated is written as not confirmed, never guessed.
   */
  verify: boolean;
  /** The schema.org property it fills, if any (birthDate, nationality...). */
  schemaProperty: string;
}

export interface OutlineSection {
  heading: string;
  /** What the section is for, in a sentence or two. */
  guidance: string;
}

export interface PageType {
  /**
   * Empty on a type that has not been saved yet; the engine names it then.
   *
   * Unique per owner, not across the engine: two people can each keep a
   * "poker-player-biography". A type is only ever told apart by the pair,
   * owner and id — see typeKeyOf below.
   */
  id: string;
  /**
   * Whose type it is. The engine sends it on every type it hands back, empty
   * for one saved before types had owners. Absent only on a type the editor
   * has not saved yet, which becomes the saver's.
   */
  owner?: string;
  name: string;
  /** What such a page is and who it is for. The classifier and the writer both read it. */
  description: string;
  /** What the page is about, in one or two words: "casino", "player". */
  subject: string;
  /**
   * Whether the research also reads the subject's own website.
   *
   * For a casino, a brand or a product, its own site is where the accepted
   * payments, the limits and the terms are stated. The engine finds it among
   * the search results and skips it when it cannot be told apart from the
   * sites reviewing it. Off for a type whose subject has no site of its own.
   */
  officialSite: boolean;
  recognise: {
    /** Parts of an address that mark this kind of page: "/crypto-casinos/". */
    urlPatterns: string[];
    /** Body classes the site's theme puts on such pages. */
    bodyClasses: string[];
    /** Good pages of this kind anywhere on the web, for reference. */
    examples: string[];
  };
  facts: FactField[];
  /** Domains that are the authority on these facts, most trusted first. */
  trustedSources: string[];
  outline: OutlineSection[];
  /** How the writing reads. */
  rules: string[];
  /** What it must never do. */
  avoid: string[];
  blocks: Block[];
  schemaType: SchemaType;
  wordpress: {
    /** The post type such pages live in. Empty lets the site decide. */
    postType: string;
    /** An existing page whose layout and template new pages copy. */
    styleFrom: string;
    /**
     * The address given to a page a run adds, with {slug} where the subject's
     * name goes: "{slug}-review" puts Stake at /stake-review/. "{slug}" alone
     * is the name and nothing else. A page being optimised keeps the address
     * it has. See slugPatternOf below.
     */
    slugPattern: string;
  };
  /** How long a page of this kind usually is. Zero lets the competitors decide. */
  words: number;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
}

/** The three jobs a custom run can do. */
export type CustomAction = "optimise" | "add" | "design";

/** One custom run, as the engine lists them. Newest first, only the caller's. */
export interface CustomRun {
  id: string;
  /** The engine's own word: queued, running, success, error or canceled. */
  status: string;
  action: CustomAction;
  pageTypeId: string;
  /** Whose type that is. Empty for an unowned type, or when none is known yet. */
  pageTypeOwner: string;
  /** Empty when the type was left to be detected and the run has not decided yet. */
  pageTypeName: string;
  /** The page rewritten, the page written from, or the first example. */
  target: string;
  startedAt: string;
  stoppedAt: string | null;
  error: string | null;
  published: Array<{ url: string; postId: string | number }>;
}

/** Where a design run has got to, and the type it drafted once it has. */
export interface DesignDraft {
  id: string;
  status: string;
  finished: boolean;
  error: string | null;
  draft: PageType | null;
}

/**
 * lower_snake_case, the way a fact's key has to look.
 *
 * The same rule as the engine's, so the key the editor shows beside a label is
 * the key the engine will keep rather than one it rewrites on save.
 */
export function keyOf(raw: unknown): string {
  return String(raw ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

/**
 * FNV-1a, 32 bits, over UTF-16 code units, as eight hex digits.
 *
 * Not for security. It is how a name with no Latin letters in it still gets an
 * id, and the engine works it out the same way, so both halves agree on what
 * that id is without asking each other.
 */
export function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/**
 * The id the engine gives a type from its name: poker-player-biography.
 *
 * A name written only in Cyrillic, Greek or Japanese has no Latin letters to
 * make one from, and used to be refused for it. It gets type-<hash of the
 * name> instead, which is stable and never empty.
 */
export function idOf(raw: unknown): string {
  const s = keyOf(raw).replace(/_/g, "-").slice(0, 60);
  if (s) return s;
  return "type-" + fnv1a(String(raw ?? "").normalize("NFC").trim().toLowerCase());
}

/**
 * The keys a type's facts are saved under, in order.
 *
 * A key comes from what was typed as the key, or else from the label. A label
 * with no Latin letters in it gives nothing, and the engine used to drop such
 * a fact without a word; it now names it fact_1, fact_2 and so on, the
 * smallest number no other fact of the type is already called. Worked out
 * here the same way so the key the editor shows is the key that is kept.
 *
 * Only for facts that have a label. The engine ignores one without, and so
 * does the editor on the way out.
 */
export function factKeys(facts: ReadonlyArray<{ key?: unknown; label?: unknown }>): string[] {
  const direct = facts.map((fact) => keyOf(fact.key) || keyOf(fact.label));
  const used = new Set(direct.filter(Boolean));
  return direct.map((key) => {
    if (key) return key;
    let n = 1;
    while (used.has(`fact_${n}`)) n++;
    used.add(`fact_${n}`);
    return `fact_${n}`;
  });
}

/** A bare domain, whatever shape it was typed in. The engine's rule, copied. */
export function domainOf(raw: unknown): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, "")
    .split(/[/?#:\s]/)[0]!
    .replace(/^www\./, "")
    .replace(/\.+$/, "");
}

/** The control characters the engine strips from text, tab and line breaks aside. */
const CONTROL = new RegExp(
  "[" + String.fromCharCode(0) + "-" + String.fromCharCode(8) +
    String.fromCharCode(11, 12) +
    String.fromCharCode(14) + "-" + String.fromCharCode(31) + "]",
  "g",
);

/**
 * An address pattern the way the engine keeps it.
 *
 * A whole address pasted in is cut to its path, everything is lower case, and
 * a pattern always starts with a slash. A pattern that is only "/" would claim
 * every page on every site, so the engine refuses one; this hands it back as
 * "/" for the editor to say so.
 */
export function urlPatternOf(raw: unknown): string {
  // Cleaned as the engine cleans any text: control characters out, runs of
  // space made one, trimmed.
  let s = String(raw ?? "")
    .replace(CONTROL, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return "";
  try {
    const url = new URL(s);
    if (url.protocol === "http:" || url.protocol === "https:") s = url.pathname;
  } catch {
    /* not a whole address: a path, or part of one */
  }
  s = s.toLowerCase();
  return s.startsWith("/") ? s : `/${s}`;
}

/**
 * How much a type may hold, copied from the engine's checkPageType.
 *
 * The engine refuses a save over any of these, naming the field, so the editor
 * stops at them first rather than letting somebody type past one. Changed on
 * both sides together or not at all.
 */
export const PAGE_TYPE_LIMITS = {
  name: 80,
  description: 1500,
  subject: 40,
  patterns: 20,
  pattern: 120,
  /** Body classes share the patterns' limits on the engine. */
  bodyClasses: 20,
  bodyClass: 120,
  examples: 10,
  example: 500,
  facts: 40,
  factKey: 40,
  factLabel: 80,
  factHint: 300,
  schemaProperty: 60,
  sources: 15,
  source: 200,
  outline: 20,
  heading: 120,
  guidance: 600,
  /** Rules and the never list each. */
  rules: 30,
  rule: 400,
  postType: 40,
  styleFrom: 500,
  slugPattern: 60,
  words: 6000,
} as const;

/** Where the subject's own slug goes in the address of a new page. */
export const SLUG_TOKEN = "{slug}";

/** What the engine says to an address pattern it will not keep, word for word. */
export const SLUG_PATTERN_REFUSED =
  "The address of a new page must contain {slug} once, and otherwise only " +
  "letters, digits and hyphens, e.g. {slug}-review.";

/**
 * The address pattern for a new page the way the engine keeps it, or null
 * when the engine would not keep it.
 *
 * Trimmed and lower case, with spaces and underscores made hyphens, repeated
 * hyphens made one, and hyphens and slashes cut from both ends, so
 * " /{slug}_Review/ " is kept as "{slug}-review". Empty is "{slug}", the
 * subject's name alone.
 *
 * Null when what is left does not hold {slug} exactly once, holds anything
 * beside it other than a-z, 0-9 and hyphens, or is longer than the limit. A
 * person's save of that is refused with SLUG_PATTERN_REFUSED; the designer's
 * draft is given "{slug}" instead. The same rule as the engine's, so the
 * editor says so before the save rather than after.
 */
export function slugPatternOf(raw: unknown): string | null {
  const pattern = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-/]+|[-/]+$/g, "");
  if (!pattern) return SLUG_TOKEN;
  if (pattern.length > PAGE_TYPE_LIMITS.slugPattern) return null;
  if (pattern.split(SLUG_TOKEN).length !== 2) return null;
  return /^[a-z0-9-]*$/.test(pattern.replace(SLUG_TOKEN, "")) ? pattern : null;
}

/** Whose a type is, the way the engine compares owners: trimmed, lower case. */
export function ownerOf(type: { owner?: string | null } | null | undefined): string {
  return String(type?.owner ?? "").trim().toLowerCase();
}

/**
 * One string that names a type among everybody's.
 *
 * The id alone is not enough: somebody with full access sees every owner's
 * types, and two of those can share an id. A character no owner or id can
 * contain keeps the two halves apart.
 */
export function typeKeyOf(owner: string, id: string): string {
  return `${String(owner ?? "").trim().toLowerCase()}\u0000${id}`;
}

/** The two halves of typeKeyOf, back again. Null for "" (detect automatically). */
export function typeKeyParts(key: string): { owner: string; id: string } | null {
  const at = key.indexOf("\u0000");
  if (at < 0) return null;
  return { owner: key.slice(0, at), id: key.slice(at + 1) };
}

/*
 * Types written out in full, to start from.
 *
 * A blank form with twenty fields is a hard place to begin, and most of what a
 * good type says is only obvious once you have seen one. These are real ones,
 * complete enough to run as they are, and as unlike each other as two types
 * get: a business with a website of its own, reviewed, and a person, written
 * up. Between them they show that a type is not about any one kind of page.
 * Their ids are empty, so saving one makes a new type rather than overwriting
 * anybody's.
 */

/**
 * An independent review of one crypto casino.
 *
 * The subject has a site of its own, and that site is where the coins, the
 * limits and the bonus terms are stated, so this one reads it. New pages go to
 * /<name>-review/, which is how review sites tend to name them.
 */
export const CRYPTO_CASINO_EXAMPLE: PageType = {
  id: "",
  name: "Crypto casino review",
  description:
    "An independent review of one crypto casino: who runs it and under which licence, which " +
    "coins it takes and how fast it pays out, the welcome bonus and its wagering, the games " +
    "and providers, and what to watch out for. Written for players choosing where to play " +
    "with crypto.",
  subject: "casino",
  officialSite: true,
  recognise: {
    urlPatterns: ["/crypto-casinos/", "/casino-reviews/"],
    bodyClasses: [],
    examples: [],
  },
  facts: [
    {
      key: "licence",
      label: "Licence",
      hint: "licensing authority and licence number",
      verify: true,
      schemaProperty: "",
    },
    {
      key: "year_launched",
      label: "Year launched",
      hint: "four-digit year",
      verify: true,
      schemaProperty: "foundingDate",
    },
    {
      key: "operator",
      label: "Operator",
      hint: "the company that runs the casino",
      verify: true,
      schemaProperty: "",
    },
    {
      key: "accepted_cryptocurrencies",
      label: "Accepted cryptocurrencies",
      hint: "coins accepted for deposits and withdrawals, e.g. BTC, ETH, USDT",
      verify: true,
      schemaProperty: "",
    },
    {
      key: "minimum_deposit",
      label: "Minimum deposit",
      hint: "the smallest deposit, with its currency",
      verify: true,
      schemaProperty: "",
    },
    {
      key: "withdrawal_time",
      label: "Withdrawal time",
      hint: "typical time for a crypto withdrawal",
      verify: false,
      schemaProperty: "",
    },
    {
      key: "welcome_bonus",
      label: "Welcome bonus",
      hint: "the offer as the casino states it",
      verify: true,
      schemaProperty: "",
    },
    {
      key: "wagering_requirement",
      label: "Wagering requirement",
      hint: "e.g. 40x the bonus",
      verify: true,
      schemaProperty: "",
    },
    {
      key: "kyc",
      label: "Identity checks (KYC)",
      hint: "whether and when ID is asked for",
      verify: true,
      schemaProperty: "",
    },
    {
      key: "restricted_countries",
      label: "Restricted countries",
      hint: "countries the casino does not accept",
      verify: true,
      schemaProperty: "",
    },
    {
      key: "number_of_games",
      label: "Number of games",
      hint: "approximate count",
      verify: false,
      schemaProperty: "",
    },
    {
      key: "game_providers",
      label: "Game providers",
      hint: "the main studios",
      verify: false,
      schemaProperty: "",
    },
    {
      key: "provably_fair",
      label: "Provably fair games",
      hint: "yes or no, and which games",
      verify: false,
      schemaProperty: "",
    },
    {
      key: "customer_support",
      label: "Customer support",
      hint: "channels and hours",
      verify: false,
      schemaProperty: "",
    },
  ],
  trustedSources: ["casino.guru", "askgamblers.com"],
  outline: [
    {
      heading: "{name} review: the verdict",
      guidance: "Who it suits and the two or three things that decide it. A summary, not a sales pitch.",
    },
    {
      heading: "Licence and who runs {name}",
      guidance:
        "The licensing authority and number, the operator and the year it launched. Say plainly " +
        "what could not be confirmed.",
    },
    {
      heading: "Crypto deposits and withdrawals",
      guidance:
        "Accepted coins, minimum deposit, withdrawal times and limits, fees, and when identity " +
        "checks are asked for.",
    },
    {
      heading: "Welcome bonus and wagering",
      guidance:
        "The offer as stated, the wagering requirement, time limit and maximum bet, in plain numbers.",
    },
    {
      heading: "Games and providers",
      guidance: "Slots, live casino, originals and provably fair games, and the main providers.",
    },
    {
      heading: "Is {name} safe?",
      guidance:
        "Licence, security, responsible gambling tools, restricted countries, and complaints if " +
        "sources report them.",
    },
    { heading: "FAQ", guidance: "Questions players search about this casino." },
  ],
  rules: [
    "Write as an independent reviewer.",
    "Give every figure with its unit or currency.",
    "Say where terms vary by country or change often, and tell readers to check the casino's current terms.",
    "Say once, plainly, that gambling is for adults (18+) and can be addictive.",
  ],
  avoid: [
    "Promise winnings or call any game a sure thing.",
    "Invent a licence number, a bonus figure or a payout time.",
    "Encourage play from restricted countries or the use of a VPN.",
  ],
  blocks: ["facts_table", "pros_cons", "faq", "contents"],
  schemaType: "Organization",
  wordpress: { postType: "", styleFrom: "", slugPattern: "{slug}-review" },
  words: 1800,
  createdAt: "",
  updatedAt: "",
  updatedBy: "",
};

/**
 * A biography of a professional poker player.
 *
 * A person has no site of their own worth reading for facts, so this one
 * leaves it off and trusts the results databases instead. New pages are named
 * for the player and nothing else.
 */
export const POKER_EXAMPLE: PageType = {
  id: "",
  name: "Poker player biography",
  description:
    "A biography of a professional poker player: who they are, how they came into the game, " +
    "their biggest results and records, how they play, and their life away from the table. " +
    "Written for poker fans who want the facts in one place.",
  subject: "player",
  officialSite: false,
  recognise: {
    urlPatterns: ["/players/", "/poker-players/", "/pros/"],
    bodyClasses: [],
    examples: [],
  },
  facts: [
    {
      key: "full_name",
      label: "Full name",
      hint: "legal name as sources give it",
      verify: true,
      schemaProperty: "",
    },
    {
      key: "nationality",
      label: "Nationality",
      hint: "country they represent",
      verify: true,
      schemaProperty: "nationality",
    },
    {
      key: "birth_date",
      label: "Date of birth",
      hint: "day, month and year",
      verify: true,
      schemaProperty: "birthDate",
    },
    {
      key: "hometown",
      label: "Hometown",
      hint: "city and country",
      verify: true,
      schemaProperty: "homeLocation",
    },
    {
      key: "total_live_earnings",
      label: "Total live tournament earnings",
      hint: "in US dollars, as The Hendon Mob lists it, with the date",
      verify: true,
      schemaProperty: "",
    },
    {
      key: "biggest_cash",
      label: "Biggest live cash",
      hint: "amount, event and year",
      verify: true,
      schemaProperty: "",
    },
    {
      key: "wsop_bracelets",
      label: "WSOP bracelets",
      hint: "number won",
      verify: true,
      schemaProperty: "",
    },
    {
      key: "wpt_titles",
      label: "WPT titles",
      hint: "number won",
      verify: true,
      schemaProperty: "",
    },
    {
      key: "sponsors",
      label: "Sponsors",
      hint: "current sponsors or team",
      verify: false,
      schemaProperty: "",
    },
    {
      key: "online_names",
      label: "Online screen names",
      hint: "known online aliases",
      verify: false,
      schemaProperty: "alternateName",
    },
  ],
  trustedSources: ["thehendonmob.com", "wsop.com", "pokernews.com"],
  outline: [
    {
      heading: "Who is {name}",
      guidance: "who the player is and why they matter, in two short paragraphs",
    },
    { heading: "Key facts", guidance: "the facts table" },
    { heading: "Early life and route into poker", guidance: "background, how they started" },
    {
      heading: "Career highlights",
      guidance: "the results and moments that define the career, in order",
    },
    {
      heading: "Biggest wins and records",
      guidance: "the largest cashes, titles and records, with figures from the research",
    },
    {
      heading: "Playing style",
      guidance: "how they play and what others say about it, attributed",
    },
    { heading: "Life away from the table", guidance: "only what sources state; no speculation" },
    { heading: "FAQ", guidance: "the questions fans search" },
  ],
  rules: [
    "Write in the third person.",
    "Give every figure with its year.",
    "Attribute opinions to whoever holds them.",
  ],
  avoid: [
    "Invent quotes or anecdotes.",
    "Speculate about private life, health or finances beyond what sources state.",
    "Give gambling advice or encourage gambling.",
  ],
  blocks: ["facts_table", "faq", "contents"],
  schemaType: "Person",
  wordpress: { postType: "", styleFrom: "", slugPattern: SLUG_TOKEN },
  words: 1200,
  createdAt: "",
  updatedAt: "",
  updatedBy: "",
};

/**
 * The examples the Custom page offers, in the order it offers them.
 *
 * The id is only for telling the entries apart on the page; it is never saved.
 * The note is the one line under the name that says what makes it different.
 */
export const EXAMPLES: ReadonlyArray<{
  id: string;
  label: string;
  note: string;
  type: PageType;
}> = [
  {
    id: "crypto-casino",
    label: CRYPTO_CASINO_EXAMPLE.name,
    note: "A business with its own site, reviewed: licence, coins, bonus terms.",
    type: CRYPTO_CASINO_EXAMPLE,
  },
  {
    id: "poker-player",
    label: POKER_EXAMPLE.name,
    note: "A person, written up: career, results and records.",
    type: POKER_EXAMPLE,
  },
];
