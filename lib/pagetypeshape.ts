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
  /** Empty on a type that has not been saved yet; the engine names it then. */
  id: string;
  /** Whose type it is. Absent means the admin's. */
  owner?: string;
  name: string;
  /** What such a page is and who it is for. The classifier and the writer both read it. */
  description: string;
  /** What the page is about, in one or two words: "player", "provider". */
  subject: string;
  recognise: {
    /** Parts of an address that mark this kind of page: "/players/". */
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

/** The id the engine gives a type from its name: poker-player-biography. */
export function idOf(raw: unknown): string {
  return keyOf(raw).replace(/_/g, "-").slice(0, 60);
}

/**
 * A type written out in full, to start from.
 *
 * A blank form with twenty fields is a hard place to begin, and most of what a
 * good type says is only obvious once you have seen one. This is a real one,
 * complete enough to run as it is. Its id is empty, so saving it makes a new
 * type rather than overwriting anybody's.
 */
export const POKER_EXAMPLE: PageType = {
  id: "",
  name: "Poker player biography",
  description:
    "A biography of a professional poker player: who they are, how they came into the game, " +
    "their biggest results and records, how they play, and their life away from the table. " +
    "Written for poker fans who want the facts in one place.",
  subject: "player",
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
  wordpress: { postType: "", styleFrom: "" },
  words: 1200,
  createdAt: "",
  updatedAt: "",
  updatedBy: "",
};
