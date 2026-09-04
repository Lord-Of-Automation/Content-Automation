/**
 * Cloudflare, which is where most of this estate's DNS actually lives.
 *
 * A domain whose name servers point at Cloudflare answers from Cloudflare, and
 * the zone the registrar still keeps is read by nobody. So the registrar DNS
 * editor is the wrong screen for those domains, and this is the right one.
 *
 * Adding a domain is two steps that look like one. Cloudflare creates the zone
 * and hands back a pair of name servers, and nothing happens until those name
 * servers are set at the registrar — which this console can do, since it already
 * writes name servers at GoDaddy and Gandi. Until that lands the zone sits in
 * "pending", and Cloudflare rechecks on its own schedule.
 *
 * One thing to be careful about, because it is invisible from inside: a token
 * sees the zones of the accounts it was issued for and no others. A domain
 * already on Cloudflare under a different account reads here as "not added",
 * and creating it will be refused by Cloudflare rather than by us. That refusal
 * is passed through in Cloudflare's own words rather than translated, because
 * "already exists" means something quite different from "you got it wrong".
 */

import { credentialFor } from "./providers";

const API = "https://api.cloudflare.com/client/v4";

export interface CloudflareZone {
  id: string;
  name: string;
  /** "active", "pending", "initializing", "moved", "deactivated". */
  status: string;
  /** What Cloudflare wants set at the registrar. */
  nameServers: string[];
  createdAt: string | null;
  activatedOn: string | null;
}

export interface CfRecord {
  id: string;
  type: string;
  name: string;
  content: string;
  ttl: number;
  proxied: boolean;
  priority?: number;
}

export class CloudflareConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CloudflareConfigError";
  }
}

async function credentials(): Promise<{ token: string; accountId: string }> {
  const found = await credentialFor("cloudflare");
  const token = found?.apiToken?.trim();
  const accountId = found?.accountId?.trim() ?? "";
  if (!token) {
    throw new CloudflareConfigError(
      "No Cloudflare token is set. Add it on the Keys page under Domain providers.",
    );
  }
  return { token, accountId };
}

/**
 * Cloudflare answers 200 with success:false as readily as it answers 4xx, so
 * the status code alone is not the test. Its errors carry a code and a message
 * and both are worth keeping: 1061 is "this zone already exists", which is a
 * fact about the world rather than a mistake anybody made.
 */
async function call<T>(
  path: string,
  token: string,
  init: RequestInit = {},
): Promise<{ ok: boolean; result: T | null; code: number; message: string }> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json",
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });

  const text = await response.text().catch(() => "");
  let body: {
    success?: boolean;
    result?: T;
    errors?: Array<{ code?: number; message?: string }>;
  } = {};
  try {
    body = JSON.parse(text) as typeof body;
  } catch {
    return {
      ok: false,
      result: null,
      code: 0,
      message: `Cloudflare answered ${response.status} with something that is not JSON.`,
    };
  }

  if (body.success && body.result !== undefined) {
    return { ok: true, result: body.result, code: 0, message: "" };
  }

  const first = body.errors?.[0];
  return {
    ok: false,
    result: null,
    code: first?.code ?? response.status,
    message: first?.message ?? `Cloudflare answered ${response.status}.`,
  };
}

function shapeZone(raw: Record<string, unknown>): CloudflareZone {
  return {
    id: String(raw.id ?? ""),
    name: String(raw.name ?? "").toLowerCase(),
    status: String(raw.status ?? "unknown"),
    nameServers: Array.isArray(raw.name_servers)
      ? (raw.name_servers as unknown[]).map(String)
      : [],
    createdAt: typeof raw.created_on === "string" ? raw.created_on : null,
    activatedOn: typeof raw.activated_on === "string" ? raw.activated_on : null,
  };
}

/**
 * Every zone the token can see, keyed by domain.
 *
 * Paged, because an estate outgrows one page quickly and a half-read list would
 * report domains as missing from Cloudflare when they are simply on page three.
 */
export async function listZones(): Promise<Map<string, CloudflareZone>> {
  const { token } = await credentials();
  const zones = new Map<string, CloudflareZone>();

  for (let page = 1; page <= 20; page += 1) {
    const answer = await call<Array<Record<string, unknown>>>(
      `/zones?per_page=50&page=${page}`,
      token,
    );
    if (!answer.ok || !answer.result?.length) break;
    for (const raw of answer.result) {
      const zone = shapeZone(raw);
      if (zone.name) zones.set(zone.name, zone);
    }
    if (answer.result.length < 50) break;
  }

  return zones;
}

/** One zone by name, or null. Used when polling a single domain's activation. */
export async function getZone(domain: string): Promise<CloudflareZone | null> {
  const { token } = await credentials();
  const answer = await call<Array<Record<string, unknown>>>(
    `/zones?name=${encodeURIComponent(domain.toLowerCase())}`,
    token,
  );
  if (!answer.ok || !answer.result?.length) return null;
  return shapeZone(answer.result[0]);
}

/**
 * Adds the domain and returns the name servers it now wants.
 *
 * Nothing is live at this point. The zone sits pending until those name servers
 * are set at the registrar, which is the step people forget and the reason the
 * caller shows them immediately rather than behind another click.
 */
export async function createZone(domain: string): Promise<CloudflareZone> {
  const { token, accountId } = await credentials();
  if (!accountId) {
    throw new CloudflareConfigError(
      "No Cloudflare account id is set, and creating a zone needs one. " +
        "Add it on the Keys page beside the token.",
    );
  }

  const answer = await call<Record<string, unknown>>("/zones", token, {
    method: "POST",
    body: JSON.stringify({
      name: domain.toLowerCase(),
      account: { id: accountId },
      // A full zone, which is the one that takes over the domain's DNS. The
      // partial kind only works alongside another provider and is not what
      // anybody means by "add this to Cloudflare".
      type: "full",
    }),
  });

  if (!answer.ok || !answer.result) {
    // 1061 is Cloudflare's "already exists", which is usually true and usually
    // about an account this token cannot see. Saying so beats "creation
    // failed", which sends people to check a token that is working perfectly.
    if (answer.code === 1061) {
      throw new Error(
        `Cloudflare already has a zone for ${domain}, in an account this token cannot see. ` +
          "Either use the token for that account, or remove the zone there first.",
      );
    }
    throw new Error(`Cloudflare refused to add ${domain}: ${answer.message}`);
  }

  return shapeZone(answer.result);
}

// -------------------------------------------------------------------- records

export async function listRecords(zoneId: string): Promise<CfRecord[]> {
  const { token } = await credentials();
  const out: CfRecord[] = [];

  for (let page = 1; page <= 10; page += 1) {
    const answer = await call<Array<Record<string, unknown>>>(
      `/zones/${zoneId}/dns_records?per_page=100&page=${page}`,
      token,
    );
    if (!answer.ok || !answer.result?.length) break;
    for (const raw of answer.result) {
      out.push({
        id: String(raw.id ?? ""),
        type: String(raw.type ?? "").toUpperCase(),
        name: String(raw.name ?? ""),
        content: String(raw.content ?? ""),
        ttl: Number(raw.ttl) || 1,
        // Whether Cloudflare stands in front of it. The orange cloud, and the
        // difference between a hidden origin and a published one.
        proxied: raw.proxied === true,
        priority: typeof raw.priority === "number" ? raw.priority : undefined,
      });
    }
    if (answer.result.length < 100) break;
  }

  return out;
}

export interface RecordInput {
  type: string;
  name: string;
  content: string;
  ttl?: number;
  proxied?: boolean;
  priority?: number;
}

export async function createRecord(zoneId: string, record: RecordInput): Promise<void> {
  const { token } = await credentials();
  const answer = await call(`/zones/${zoneId}/dns_records`, token, {
    method: "POST",
    body: JSON.stringify({
      type: record.type.toUpperCase(),
      name: record.name,
      content: record.content,
      // 1 means "automatic", which is what Cloudflare uses for a proxied record
      // and the only value it accepts for one.
      ttl: record.proxied ? 1 : (record.ttl ?? 3600),
      ...(record.proxied === undefined ? {} : { proxied: record.proxied }),
      ...(record.priority === undefined ? {} : { priority: record.priority }),
    }),
  });
  if (!answer.ok) throw new Error(`Cloudflare refused the record: ${answer.message}`);
}

export async function updateRecord(
  zoneId: string,
  recordId: string,
  record: RecordInput,
): Promise<void> {
  const { token } = await credentials();
  const answer = await call(`/zones/${zoneId}/dns_records/${recordId}`, token, {
    method: "PUT",
    body: JSON.stringify({
      type: record.type.toUpperCase(),
      name: record.name,
      content: record.content,
      ttl: record.proxied ? 1 : (record.ttl ?? 3600),
      ...(record.proxied === undefined ? {} : { proxied: record.proxied }),
      ...(record.priority === undefined ? {} : { priority: record.priority }),
    }),
  });
  if (!answer.ok) throw new Error(`Cloudflare refused the change: ${answer.message}`);
}

export async function deleteRecord(zoneId: string, recordId: string): Promise<void> {
  const { token } = await credentials();
  const answer = await call(`/zones/${zoneId}/dns_records/${recordId}`, token, {
    method: "DELETE",
  });
  if (!answer.ok) throw new Error(`Cloudflare refused the deletion: ${answer.message}`);
}
