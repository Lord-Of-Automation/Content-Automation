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

export interface CfAccount {
  token: string;
  accountId: string;
  /** Which line it came from, for messages. Never the token itself. */
  label: string;
}

/**
 * Every Cloudflare account this console has been given.
 *
 * One line each, token then account id. Several because an estate this size is
 * not in one account: 371 zones under one login, 162 under another, and the
 * domains split between them. A token only ever sees the account it was issued
 * for, so a single-credential design reported two thirds of the estate as not
 * on Cloudflare when nearly all of it is.
 *
 * A line with no account id still reads fine. The id is only needed to create a
 * zone, and an account you can read but not create in is a perfectly ordinary
 * thing to have.
 */
export async function accounts(): Promise<CfAccount[]> {
  const found = await credentialFor("cloudflare");
  const raw = found?.apiToken?.trim();
  if (!raw) {
    throw new CloudflareConfigError(
      "No Cloudflare token is set. Add it on the Keys page under Domain providers.",
    );
  }

  // The account id used to be a field of its own, so a value saved then is one
  // token with the id beside it. Both shapes read the same way here.
  const legacyId = found?.accountId?.trim() ?? "";

  const list: CfAccount[] = [];
  for (const line of raw.split(/[\r\n]+/)) {
    const parts = line.trim().split(/[\s,]+/).filter(Boolean);
    if (!parts.length) continue;

    const token = parts.find((p) => p.startsWith("cfut_") || p.length > 30) ?? parts[0];
    const accountId = parts.find((p) => /^[0-9a-f]{32}$/i.test(p)) ?? "";
    if (!token) continue;

    list.push({
      token,
      accountId: accountId || (list.length === 0 ? legacyId : ""),
      // The last four characters, so two accounts can be told apart in a
      // message without the message becoming somewhere a token is written down.
      label: `account ending ${token.slice(-4)}`,
    });
  }

  if (!list.length) {
    throw new CloudflareConfigError("No Cloudflare token could be read from what is stored.");
  }
  return list;
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

/** A zone, and which account it was found in. */
export interface OwnedZone extends CloudflareZone {
  accountLabel: string;
}

/**
 * Every zone across every configured account, keyed by domain.
 *
 * Paged per account, because an estate outgrows one page quickly and a
 * half-read list reports domains as missing from Cloudflare when they are
 * merely on page three.
 *
 * An account that fails is skipped rather than fatal. Two accounts hold this
 * estate between them, and one bad token must not blank the other's zones —
 * that is exactly the failure that had two thirds of the domains reading as not
 * on Cloudflare.
 */
export async function listZones(): Promise<Map<string, OwnedZone>> {
  const zones = new Map<string, OwnedZone>();

  for (const account of await accounts()) {
    for (let page = 1; page <= 30; page += 1) {
      const answer = await call<Array<Record<string, unknown>>>(
        `/zones?per_page=50&page=${page}`,
        account.token,
      );
      if (!answer.ok || !answer.result?.length) break;
      for (const raw of answer.result) {
        const zone = shapeZone(raw);
        // First account wins a duplicate. A domain really can be a zone in two
        // accounts at once — one of them pending forever — and picking one
        // consistently beats whichever answered last.
        if (zone.name && !zones.has(zone.name)) {
          zones.set(zone.name, { ...zone, accountLabel: account.label });
        }
      }
      if (answer.result.length < 50) break;
    }
  }

  return zones;
}

/**
 * One zone by name, and the account it lives in.
 *
 * Asked of each account in turn rather than of one, because a write has to go
 * through the token that owns the zone — a token for the wrong account is
 * refused, and the refusal reads exactly like a permissions problem.
 */
export async function findZone(
  domain: string,
): Promise<{ zone: CloudflareZone; account: CfAccount } | null> {
  for (const account of await accounts()) {
    const answer = await call<Array<Record<string, unknown>>>(
      `/zones?name=${encodeURIComponent(domain.toLowerCase())}`,
      account.token,
    );
    if (answer.ok && answer.result?.length) {
      return { zone: shapeZone(answer.result[0]), account };
    }
  }
  return null;
}

/** The zone alone, for callers that only want its status. */
export async function getZone(domain: string): Promise<CloudflareZone | null> {
  return (await findZone(domain))?.zone ?? null;
}

/**
 * Adds the domain and returns the name servers it now wants.
 *
 * Nothing is live at this point. The zone sits pending until those name servers
 * are set at the registrar, which is the step people forget and the reason the
 * caller shows them immediately rather than behind another click.
 */
export async function createZone(
  domain: string,
  accountId?: string,
): Promise<{ zone: CloudflareZone; account: CfAccount }> {
  const all = await accounts();

  // Named where the caller named one, because with several accounts "which one"
  // is a real question and guessing it puts the domain somewhere unintended.
  // Otherwise the first that can create at all, which is the whole answer when
  // there is only one.
  const account = accountId
    ? all.find((a) => a.accountId === accountId)
    : all.find((a) => a.accountId);

  if (!account?.accountId) {
    throw new CloudflareConfigError(
      accountId
        ? "That Cloudflare account is not one of the ones configured here."
        : "None of the configured Cloudflare lines carries an account id, and " +
          "creating a zone needs one. Add it after the token on the Keys page.",
    );
  }

  const answer = await call<Record<string, unknown>>("/zones", account.token, {
    method: "POST",
    body: JSON.stringify({
      name: domain.toLowerCase(),
      account: { id: account.accountId },
      // A full zone, which is the one that takes over the domain's DNS. The
      // partial kind only works alongside another provider and is not what
      // anybody means by "add this to Cloudflare".
      type: "full",
    }),
  });

  if (!answer.ok || !answer.result) {
    // 1061 is Cloudflare's "already exists". With several accounts configured
    // it usually means a fourth one nobody has given this console a token for,
    // so the message says where to look rather than blaming the token.
    if (answer.code === 1061) {
      throw new Error(
        `Cloudflare already has a zone for ${domain}, in an account this console cannot see. ` +
          "Add that account's token on the Keys page, or remove the zone there first.",
      );
    }
    throw new Error(`Cloudflare refused to add ${domain}: ${answer.message}`);
  }

  return { zone: shapeZone(answer.result), account };
}

// -------------------------------------------------------------------- records

export async function listRecords(zoneId: string, token: string): Promise<CfRecord[]> {
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

export async function createRecord(zoneId: string, record: RecordInput, token: string): Promise<void> {
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
  token: string,
): Promise<void> {
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

export async function deleteRecord(zoneId: string, recordId: string, token: string): Promise<void> {
  const answer = await call(`/zones/${zoneId}/dns_records/${recordId}`, token, {
    method: "DELETE",
  });
  if (!answer.ok) throw new Error(`Cloudflare refused the deletion: ${answer.message}`);
}
