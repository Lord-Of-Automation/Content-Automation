/**
 * The extra instruction each site carries, as this console sees it.
 *
 * A thin pass-through to the engine, which is where these actually live. They
 * have to live there because a loop starts on the engine, on a schedule, with
 * no browser involved — a copy held here could only reach a loop by being
 * written into the schedule when it was saved, and would be stale from the
 * first edit onwards.
 *
 * So nothing is stored on this side and nothing is validated twice. The engine
 * is what reads these at the moment a page is written, and a second set of
 * rules here would disagree with it the first time either changed.
 */

export interface SitePrompt {
  /** The bare host: no scheme, no www, lower-cased. */
  domain: string;
  prompt: string;
  updatedAt: string;
  updatedBy: string;
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

  if (!response.ok) throw new Error(body?.error ?? `The engine answered ${response.status}.`);
  return body as T;
}

export async function listSitePrompts(): Promise<SitePrompt[]> {
  const { prompts } = await call<{ prompts: SitePrompt[] }>("/prompts");
  return prompts ?? [];
}

export async function saveSitePrompt(
  domain: string,
  prompt: string,
  actor: string,
): Promise<SitePrompt[]> {
  const { prompts } = await call<{ prompts: SitePrompt[] }>("/prompts", {
    method: "PUT",
    body: JSON.stringify({ domain, prompt, actor }),
  });
  return prompts ?? [];
}

export async function deleteSitePrompt(domain: string): Promise<SitePrompt[]> {
  const { prompts } = await call<{ prompts: SitePrompt[] }>(
    `/prompts/${encodeURIComponent(domain)}`,
    { method: "DELETE" },
  );
  return prompts ?? [];
}
