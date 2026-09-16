/**
 * Page types and custom runs, as this console sees them.
 *
 * A thin pass-through to the engine, like the site prompts beside it and for
 * the same reason: a run reads its page type the moment it starts, on the
 * engine, and a copy kept here would be stale from the first edit. Nothing is
 * stored on this side and nothing is validated twice. The engine says what it
 * will accept, and a 400 from it is passed back to the editor word for word.
 *
 * Server only. The shape and the constants the page needs live in
 * lib/pagetypeshape.ts, which has no session and no fetch in it.
 *
 * Not built on lib/engine.ts's client. That one reads every 404 as a run the
 * backend has never heard of, and here a 404 means two other things: a page
 * type that has gone, or an engine too old to have heard of page types at all.
 * The second is the one that matters, because an engine that does not know a
 * custom run does not refuse one — it runs the optimiser, which rewrites live
 * pages.
 */

import { signedAs } from "./actor";
import type { CustomRun, DesignDraft, PageType } from "./pagetypeshape";

export {
  BLOCKS,
  BLOCK_LABELS,
  PAGE_TYPE_LIMITS,
  POKER_EXAMPLE,
  SCHEMA_TYPES,
  factKeys,
  fnv1a,
  idOf,
  keyOf,
  ownerOf,
  typeKeyOf,
  urlPatternOf,
} from "./pagetypeshape";
export type {
  Block,
  CustomAction,
  CustomRun,
  DesignDraft,
  FactField,
  OutlineSection,
  PageType,
  SchemaType,
} from "./pagetypeshape";

/**
 * What the engine said, with the status it said it with.
 *
 * An Error like any other, so a route that does not care can hand it to
 * errorResponse. The status is there for the ones that do: a refused save is
 * the person's to fix and is answered as a 400, not a gateway failure.
 */
export class PageTypeEngineError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function base(): string {
  const url = process.env.ENGINE_URL?.trim();
  if (!url) throw new Error("ENGINE_URL is not set.");
  return url.replace(/\/+$/, "");
}

function token(): string {
  const value = process.env.ENGINE_TOKEN?.trim();
  if (!value) throw new Error("ENGINE_TOKEN is not set.");
  return value;
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${base()}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token()}`,
      "content-type": "application/json",
      // Who is asking. Page types belong to whoever saved them, and the engine
      // takes this console's word for who that is.
      ...(await signedAs()),
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(30_000),
    cache: "no-store",
  });

  const text = await response.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { error: text.slice(0, 300) };
  }

  if (!response.ok) {
    throw new PageTypeEngineError(
      body?.error ?? `The engine answered ${response.status}.`,
      response.status,
    );
  }
  return body as T;
}

/**
 * What to tell somebody whose engine predates page types, and what to run.
 *
 * One sentence in one place, because it is said by more than one route and the
 * command in it is the only part anybody acts on.
 */
export const ENGINE_OUTDATED =
  "The engine has not been updated for page types yet. Update it first " +
  "(cd /opt/src && git pull && docker compose up -d --build).";

/**
 * Whether an error is the engine saying it has no such route.
 *
 * That is how an engine from before page types answers every address on this
 * page, and it is told apart from a type that has gone by the wording, which
 * is the engine's catch-all and nothing else's.
 */
export function isEngineOutdated(error: unknown): boolean {
  return (
    error instanceof PageTypeEngineError &&
    error.status === 404 &&
    /no route/i.test(error.message)
  );
}

/**
 * A type with its owner always spelled out.
 *
 * The engine sends one on every type; an engine from before owners left it off
 * an unowned one. Empty either way, so the page has one thing to compare.
 */
function owned(type: PageType): PageType {
  return { ...type, owner: String(type.owner ?? "").trim().toLowerCase() };
}

/**
 * Every type the signed-in person may use, and whether the engine knows the
 * word at all.
 *
 * engineReady is the safety check for starting a run as much as it is a fact
 * for the page to show. See the note at the top of this file.
 */
export async function listPageTypes(): Promise<{
  pageTypes: PageType[];
  engineReady: boolean;
  problem?: string;
}> {
  try {
    const { pageTypes, problem } = await call<{ pageTypes: PageType[]; problem?: string }>("/page-types");
    return {
      pageTypes: (pageTypes ?? []).map(owned),
      engineReady: true,
      ...(typeof problem === "string" && problem ? { problem } : {}),
    };
  } catch (error) {
    if (isEngineOutdated(error)) return { pageTypes: [], engineReady: false };
    throw error;
  }
}

/**
 * The fields a type is made of, and nothing else.
 *
 * Picked rather than spread, so what the browser adds — a date, a stray field
 * from a draft — never reaches the engine as if it had been meant.
 *
 * The owner goes only with an edit, where it says whose type is being edited:
 * somebody with full access sees everybody's, and an id alone does not say
 * which of two people's "poker-player-biography" was meant. The engine honours
 * it only for full access and only beside an id, so a new type is always the
 * saver's, whatever the browser sent.
 */
function fieldsOf(type: Partial<PageType>): Record<string, unknown> {
  const id = String(type.id ?? "");
  return {
    id,
    ...(id && typeof type.owner === "string" ? { owner: type.owner.trim().toLowerCase() } : {}),
    name: type.name,
    description: type.description,
    subject: type.subject,
    recognise: type.recognise,
    facts: type.facts,
    trustedSources: type.trustedSources,
    outline: type.outline,
    rules: type.rules,
    avoid: type.avoid,
    blocks: type.blocks,
    schemaType: type.schemaType,
    wordpress: type.wordpress,
    words: type.words,
  };
}

/** Saves one type, new when its id is empty, and hands back the list as it now is. */
export async function savePageType(
  type: Partial<PageType>,
  actor: string,
): Promise<{ pageType: PageType; pageTypes: PageType[] }> {
  const saved = await call<{ pageType: PageType; pageTypes: PageType[] }>("/page-types", {
    method: "PUT",
    body: JSON.stringify({ ...fieldsOf(type), actor }),
  });
  return {
    pageType: saved.pageType ? owned(saved.pageType) : saved.pageType,
    pageTypes: (saved.pageTypes ?? []).map(owned),
  };
}

/**
 * Deletes one type and hands back the list as it now is.
 *
 * With its owner whenever the page knows it, which is always for a type the
 * engine listed. Without one the engine takes the caller's own type of that id,
 * and refuses to guess between two other people's.
 */
export async function deletePageType(id: string, owner?: string | null): Promise<PageType[]> {
  const query = typeof owner === "string" ? `?owner=${encodeURIComponent(owner.trim().toLowerCase())}` : "";
  const { pageTypes } = await call<{ deleted: unknown; pageTypes: PageType[] }>(
    `/page-types/${encodeURIComponent(id)}${query}`,
    { method: "DELETE" },
  );
  return (pageTypes ?? []).map(owned);
}

/**
 * The custom runs the signed-in person may see, newest first.
 *
 * Empty rather than an error on an engine without them. The page already says
 * the engine needs updating, and saying it a second time in the runs card adds
 * nothing but red.
 */
export async function listCustomRuns(limit = 30): Promise<CustomRun[]> {
  const bounded = Math.max(1, Math.min(100, Math.round(limit) || 30));
  try {
    const { runs } = await call<{ runs: Array<Partial<CustomRun>> }>(`/custom/runs?limit=${bounded}`);
    // An engine from before types had owners sends no pageTypeOwner. Empty is
    // what the page reads as "nobody's in particular", which is what it was.
    return (runs ?? []).map((run) => ({
      ...(run as CustomRun),
      pageTypeOwner: String(run.pageTypeOwner ?? "").trim().toLowerCase(),
    }));
  } catch (error) {
    if (isEngineOutdated(error)) return [];
    throw error;
  }
}

/** Where a design run is, and the type it drafted once it has finished. */
export async function getDesignDraft(id: string): Promise<DesignDraft> {
  return call<DesignDraft>(`/custom/drafts/${encodeURIComponent(id)}`);
}
