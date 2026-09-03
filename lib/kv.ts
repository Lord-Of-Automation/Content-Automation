/**
 * Minimal Upstash/Vercel KV client over the REST API.
 *
 * Deliberately not @upstash/redis: the four commands this app uses are a POST
 * with a JSON array body, and a dependency buys nothing for that.
 */

export function kvConfig(): { url: string; token: string } | null {
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token =
    process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return { url: url.replace(/\/$/, ""), token };
}

export function kvConfigured(): boolean {
  return kvConfig() !== null;
}

export async function kv(command: (string | number)[]): Promise<unknown> {
  const config = kvConfig();
  if (!config) throw new Error("No KV configured.");

  const response = await fetch(config.url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(command),
    cache: "no-store",
    signal: AbortSignal.timeout(5_000),
  });

  if (!response.ok) throw new Error(`KV returned ${response.status}.`);
  const payload = (await response.json()) as { result?: unknown };
  return payload.result;
}

/** Reachable, not merely configured. */
export async function kvReachable(): Promise<boolean> {
  if (!kvConfigured()) return false;
  try {
    await kv(["PING"]);
    return true;
  } catch {
    return false;
  }
}

export async function kvGetJSON<T>(key: string): Promise<T | null> {
  if (!kvConfigured()) return null;
  try {
    const raw = await kv(["GET", key]);
    if (typeof raw !== "string") return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Never throws: a cache that fails should slow things down, not break them.
 *
 * It does say whether it wrote, though, because not every caller is a cache.
 * Site logins are stored through this, and a silent false there is a password
 * the console reported as saved and does not have. A caller that is genuinely
 * caching can carry on ignoring the answer.
 */
export async function kvSetJSON(key: string, value: unknown): Promise<boolean> {
  if (!kvConfigured()) return false;
  try {
    await kv(["SET", key, JSON.stringify(value)]);
    return true;
  } catch {
    return false;
  }
}
