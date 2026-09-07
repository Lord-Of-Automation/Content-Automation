/**
 * The applications this Cloudways account hosts.
 *
 * Cloudways is where the sites actually run, which makes it the one place that
 * knows what exists. The Domains page knows what is registered and Search
 * Console knows what earns — neither can tell you that a domain you are paying
 * to renew has nothing behind it, or that an application has been sitting on a
 * staging address for a year because nobody pointed a domain at it.
 *
 * One request answers all of it. `GET /server` returns every server with its
 * applications nested inside, so three hundred and fifty applications cost one
 * call rather than one call each.
 *
 * A word on what comes back. The server's reply includes the master password,
 * the application password, the MySQL password and the Redis password, all in
 * clear text. That is Cloudways' choice, not ours, and none of it has any
 * business reaching a browser: the console renders a list of sites, and a list
 * of sites does not need the credentials to log into them. Everything secret is
 * dropped here, in the reader, rather than filtered in the component — a filter
 * at the edge is one careless `{...app}` away from shipping the lot.
 */

import { credentialFor } from "./providers";

const API = "https://api.cloudways.com/api/v1";

/** A missing or malformed token, which is fixed on the Keys page. */
export class CloudwaysConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CloudwaysConfigError";
  }
}

export interface CloudwaysApp {
  id: string;
  /** What it is called in Cloudways, which is usually but not always a domain. */
  label: string;
  /** The live domain, or "" when nothing has been pointed at it yet. */
  domain: string;
  /** "wordpress", "woocommerce", "laravel", "phpstack". */
  platform: string;
  /** The pretty form of the above, for reading rather than matching. */
  platformLabel: string;
  version: string;
  /** The cloudwaysapps.com address, which always works even with no domain. */
  stagingUrl: string;
  /** Where the admin lives, "/wp-admin/" for WordPress. Empty when unknown. */
  adminPath: string;
  /** A staging copy of another application rather than a site in its own right. */
  staging: boolean;
  /**
   * Whether Cloudways holds a certificate — not whether the site serves https.
   * Most of this estate is fronted by Cloudflare, which does its own TLS, so
   * "none" is the normal state of a perfectly padlocked site.
   */
  ssl: "installed" | "pending" | "none";
  createdAt: string;
  serverId: string;
  serverLabel: string;
  serverIp: string;
}

export interface CloudwaysServer {
  id: string;
  label: string;
  status: string;
  ip: string;
  /** "do", "vultr", "gce". */
  cloud: string;
  region: string;
  /** "intel-8GB". */
  size: string;
  apps: number;
}

export interface CloudwaysEstate {
  servers: CloudwaysServer[];
  apps: CloudwaysApp[];
  /** Where the read stands, so an empty list can say why it is empty. */
  ok: boolean;
  note: string;
}

/**
 * The raw shapes, named only as far as they are read.
 *
 * Deliberately partial: the reply carries roughly forty fields per application
 * and this uses eleven of them. Typing the rest would be typing out the
 * passwords, which is the opposite of the point.
 */
interface RawApp {
  id?: string;
  label?: string;
  application?: string;
  app_version?: string;
  app_fqdn?: string;
  cname?: string;
  is_staging?: string | number | boolean;
  created_at?: string;
  backend_url?: string;
  aliases?: string[];
  own_ssl?: unknown;
  lets_encrypt?: { is_installed?: boolean; is_verified?: boolean } | null;
}

interface RawServer {
  id?: string;
  label?: string;
  status?: string;
  public_ip?: string;
  cloud?: string;
  region?: string;
  instance_type?: string;
  apps?: RawApp[];
}

/** Cloudways' own names for the stacks, which are not what anyone calls them. */
const PLATFORMS: Record<string, string> = {
  wordpress: "WordPress",
  wordpressmu: "WordPress Multisite",
  woocommerce: "WooCommerce",
  laravel: "Laravel",
  magento: "Magento",
  phpstack: "PHP",
  drupal: "Drupal",
  joomla: "Joomla",
  prestashop: "PrestaShop",
  opencart: "OpenCart",
  mediawiki: "MediaWiki",
  moodle: "Moodle",
};

function prettyPlatform(raw: string): string {
  if (!raw) return "Unknown";
  return PLATFORMS[raw.toLowerCase()] ?? raw;
}

/**
 * Cloudways answers "no" in several ways: "0", 0, false and absent all appear
 * in the same field across different applications.
 */
function isTrue(value: string | number | boolean | undefined): boolean {
  return value === true || value === 1 || value === "1";
}

async function token(): Promise<string> {
  const found = await credentialFor("cloudways");
  const value = found?.apiToken?.trim();
  if (!value) {
    throw new CloudwaysConfigError(
      "No Cloudways token is set. Add one on the Keys page to see the applications.",
    );
  }
  return value;
}

/**
 * Cloudways used to want an email and an API key traded for a short-lived
 * OAuth token. Access Tokens replaced that and go straight on as a bearer, so
 * there is no exchange step and nothing to keep alive between requests. A token
 * from the old scheme is refused here rather than sent, because the failure it
 * produces upstream is `invalid_credentials`, which reads like a wrong password
 * rather than a token of the wrong kind.
 */
async function get(path: string): Promise<unknown> {
  const response = await fetch(`${API}${path}`, {
    headers: {
      authorization: `Bearer ${await token()}`,
      accept: "application/json",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(45_000),
  });

  if (response.status === 401 || response.status === 403) {
    throw new CloudwaysConfigError(
      "Cloudways refused the token. Check it has not expired or been revoked, " +
        "and that it is an Access Token rather than the older API key.",
    );
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Cloudways answered ${response.status}${body ? `: ${body.slice(0, 160)}` : ""}`,
    );
  }

  return response.json();
}

/**
 * A write.
 *
 * Cloudways takes form encoding rather than JSON, and answers most writes with
 * an operation id instead of a result: the change is queued on the server and
 * happens a moment later. So a 200 here means "accepted", never "done".
 */
async function post(
  path: string,
  fields: Record<string, string>,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${API}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${await token()}`,
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(fields).toString(),
    cache: "no-store",
    signal: AbortSignal.timeout(45_000),
  });

  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;

  if (response.status === 401 || response.status === 403) {
    // Worth separating from a bad token, because the commonest cause is a
    // token that reads perfectly well and was never granted anything else.
    throw new CloudwaysConfigError(
      "Cloudways refused this change. A read-only Access Token can list " +
        "applications but not modify them — check the token's permissions in " +
        "Account, API Access.",
    );
  }

  if (!response.ok) {
    const said = typeof body.message === "string" ? body.message : `HTTP ${response.status}`;
    throw new Error(`Cloudways refused the change: ${said}`);
  }

  return body;
}

/**
 * The domain this application answers on.
 *
 * `cname` is the obvious field, and it is empty on more applications than you
 * would expect: twenty-three of three hundred and fifty here, nine of which
 * plainly have a domain sitting in `aliases` instead. Cloudways treats the two
 * as much the same and its dashboard shows either, so reading only `cname`
 * reports a live site as having no domain — which is the one thing this column
 * exists to tell you, and it would be wrong about it nine times.
 *
 * The label breaks ties, because `aliases` can hold more than one site's worth
 * of names: one application here lists its own domain, the www of it, and a
 * third domain that belongs to something else. An application named after one
 * of its aliases is not ambiguous.
 */
function domainFor(raw: RawApp): string {
  const cname = raw.cname?.trim().toLowerCase() ?? "";
  if (cname) return cname;

  const aliases = (Array.isArray(raw.aliases) ? raw.aliases : [])
    .map((a) => String(a ?? "").trim().toLowerCase())
    .filter(Boolean);
  if (!aliases.length) return "";

  const bare = (host: string) => (host.startsWith("www.") ? host.slice(4) : host);

  const label = raw.label?.trim().toLowerCase() ?? "";
  if (label && aliases.some((a) => bare(a) === label)) return label;

  // Failing that, the first alias that is not the www of something. The www
  // variant is usually listed first and is nobody's idea of the site's name.
  return aliases.find((a) => !a.startsWith("www.")) ?? bare(aliases[0]);
}

function readApp(raw: RawApp, server: RawServer): CloudwaysApp {
  const fqdn = raw.app_fqdn?.trim() ?? "";
  const platform = raw.application?.trim() ?? "";

  // Whether Cloudways holds a certificate for this application, which is not
  // the same question as whether the site serves https. Almost everything here
  // sits behind Cloudflare, which terminates TLS at its own edge — fourteen of
  // these three hundred and fifty have a Cloudways certificate and the rest are
  // padlocked all the same. So this is reported as a fact about Cloudways and
  // never as a verdict on the site.
  const le = raw.lets_encrypt;
  const ssl: CloudwaysApp["ssl"] = raw.own_ssl
    ? "installed"
    : le?.is_installed
      ? "installed"
      : le
        ? "pending"
        : "none";

  return {
    id: raw.id?.trim() ?? "",
    label: raw.label?.trim() ?? "",
    domain: domainFor(raw),
    platform,
    platformLabel: prettyPlatform(platform),
    version: raw.app_version?.trim() ?? "",
    stagingUrl: fqdn ? `https://${fqdn}` : "",
    adminPath: raw.backend_url?.trim() ?? "",
    staging: isTrue(raw.is_staging),
    ssl,
    createdAt: raw.created_at?.trim() ?? "",
    serverId: server.id?.trim() ?? "",
    serverLabel: server.label?.trim() ?? "",
    serverIp: server.public_ip?.trim() ?? "",
  };
}

/**
 * Every application on every server in this account.
 *
 * Sorted by domain rather than by server, because the question this page
 * answers is "where does example.com live", and grouping by server turns that
 * into a hunt through three lists. The server is a column instead.
 */
export async function listApplications(): Promise<CloudwaysEstate> {
  const body = (await get("/server")) as { status?: boolean; servers?: RawServer[] };
  const raw = Array.isArray(body?.servers) ? body.servers : [];

  const servers: CloudwaysServer[] = raw.map((s) => ({
    id: s.id?.trim() ?? "",
    label: s.label?.trim() ?? "",
    status: s.status?.trim() ?? "unknown",
    ip: s.public_ip?.trim() ?? "",
    cloud: s.cloud?.trim() ?? "",
    region: s.region?.trim() ?? "",
    size: s.instance_type?.trim() ?? "",
    apps: Array.isArray(s.apps) ? s.apps.length : 0,
  }));

  const apps = raw
    .flatMap((s) => (Array.isArray(s.apps) ? s.apps.map((a) => readApp(a, s)) : []))
    // An application with no domain sorts under its own label rather than to
    // the top in a block of blanks.
    .sort((a, b) =>
      (a.domain || a.label).localeCompare(b.domain || b.label),
    );

  return {
    servers,
    apps,
    ok: true,
    note: "",
  };
}

export interface Installable {
  /** What the API wants in `application`: "wordpress", "phpstack". */
  application: string;
  /** "6.2.2". */
  version: string;
  /** The family name, for reading: "WordPress". */
  label: string;
}

/**
 * What this account may install, asked rather than assumed.
 *
 * A list written into this file would be wrong the week Cloudways moves a
 * version, and wrong in the worst way: the form would offer something the API
 * then refuses, which reads as a broken button rather than a stale list. The
 * catalogue is small and comes back in one call, so there is no reason to
 * guess.
 *
 * Note that one family can carry several builds. WordPress here offers both
 * "wordpress" and "wordpressdefault" at the same version, and the API says
 * nothing about what separates them — so the identifier is passed through as
 * it is and shown beside the name, rather than dressed up in a guess.
 */
export async function listInstallable(): Promise<Installable[]> {
  const body = (await get("/apps")) as {
    apps?: Record<string, { label?: string; versions?: Array<{ application?: string; app_version?: string }> }>;
  };

  const out: Installable[] = [];
  for (const [family, entry] of Object.entries(body?.apps ?? {})) {
    for (const version of entry?.versions ?? []) {
      const application = version.application?.trim();
      if (!application) continue;
      out.push({
        application,
        version: version.app_version?.trim() ?? "",
        label: entry.label?.trim() || family,
      });
    }
  }

  return out.sort(
    (a, b) => a.label.localeCompare(b.label) || a.application.localeCompare(b.application),
  );
}

export interface CreatedApp {
  operationId: string;
  /**
   * The new application, once it appears.
   *
   * Null is an ordinary answer, not a failure: Cloudways builds an application
   * in the background and can take longer than a web request may wait.
   */
  app: CloudwaysApp | null;
  /** What was asked for, so the result can be named either way. */
  label: string;
  serverLabel: string;
}

/** Letters, digits and the punctuation a site name actually uses. */
const APP_LABEL = /^[A-Za-z0-9][A-Za-z0-9 ._-]*$/;

/**
 * Install a new application on one of this account's servers.
 *
 * Much safer than changing a domain, and worth saying why: nothing existing is
 * touched, Cloudways bills per server rather than per application, and one
 * created by mistake can be deleted. The cost is disk and memory on a server
 * that may already be carrying a couple of hundred sites.
 *
 * The new application is found by diffing the server's application ids across
 * the create, rather than trusting a field in the reply. That also settles
 * whether it worked: an id that was not there before is the only proof that
 * something was built.
 */
export async function createApplication(
  serverId: string,
  application: string,
  version: string,
  label: string,
): Promise<CreatedApp> {
  const name = label.trim();
  if (!name) throw new Error("The application needs a name.");
  if (name.length > 50) throw new Error("That name is too long. Fifty characters is the limit.");
  if (!APP_LABEL.test(name)) {
    throw new Error(
      "A name can hold letters, digits, spaces, dots, dashes and underscores, " +
        "and has to start with a letter or digit.",
    );
  }

  const catalogue = await listInstallable();
  if (!catalogue.some((c) => c.application === application && c.version === version)) {
    throw new Error("Cloudways does not offer that application and version.");
  }

  const before = await listApplications();
  const server = before.servers.find((s) => s.id === serverId);
  if (!server) throw new Error("No such server on this account.");
  const known = new Set(before.apps.map((a) => a.id));

  const body = await post("/app", {
    server_id: serverId,
    application,
    app_version: version,
    app_label: name,
  });

  const operationId = String(body.operation_id ?? "");
  await settle(operationId);

  let app: CloudwaysApp | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const now = await listApplications();
    const fresh = now.apps.filter((a) => a.serverId === serverId && !known.has(a.id));
    // By name among the new ones, in case somebody else created one at the
    // same moment. Falling back to whatever is new beats reporting nothing.
    app = fresh.find((a) => a.label === name) ?? fresh[0] ?? null;
    if (app) break;
    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 4000));
  }

  return { operationId, app, label: name, serverLabel: server.label };
}

/** What a primary domain is allowed to look like. */
const HOSTNAME = /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** There is no per-application read, so one is picked out of the estate. */
async function findApp(serverId: string, appId: string): Promise<CloudwaysApp | null> {
  const { apps } = await listApplications();
  return apps.find((a) => a.id === appId && a.serverId === serverId) ?? null;
}

/**
 * Wait for a queued operation, as far as it can be waited for.
 *
 * Best effort on purpose. The operation endpoint answers only for operations
 * this token started, and its response shape is not something to build on. The
 * read-back below is what actually decides whether the change happened, so
 * giving up here costs a few seconds and nothing else.
 */
async function settle(operationId: string): Promise<void> {
  if (!operationId) return;

  const until = Date.now() + 20_000;
  while (Date.now() < until) {
    try {
      const body = (await get(`/operation/${encodeURIComponent(operationId)}`)) as {
        operation?: { is_completed?: string | boolean };
      };
      const done = body.operation?.is_completed;
      if (done === "1" || done === true) return;
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 2500));
  }
}

export interface DomainChange {
  /** What was asked for. */
  requested: string;
  /** What the application answers with now, read back rather than assumed. */
  now: string;
  /** Whether the read-back agrees with the request. */
  changed: boolean;
  /** What it was before, which is what the audit trail needs. */
  before: string;
  operationId: string;
}

/**
 * Change an application's primary domain.
 *
 * The result is read back from Cloudways rather than inferred from the reply,
 * and that is not belt and braces. Cloudways answers this write with a queued
 * operation, so a 200 only means the request was accepted; and the parameter
 * name comes from a community wrapper rather than from anything Cloudways
 * publishes, so a silently ignored field would look exactly like success. The
 * only honest way to report this is to ask the application what its domain is
 * afterwards and say what came back.
 *
 * Two things this deliberately does not do. It does not touch the WordPress
 * database — the dashboard's "Set as Primary" runs a search and replace so the
 * site URL follows, and whether this endpoint does the same is undocumented, so
 * the caller is told to check rather than reassured. And it does not reissue
 * the certificate, which is per-domain and will need reissuing once DNS points
 * at the server.
 */
export async function setPrimaryDomain(
  serverId: string,
  appId: string,
  domain: string,
): Promise<DomainChange> {
  const wanted = domain.trim().toLowerCase();
  if (!HOSTNAME.test(wanted)) throw new Error("That is not a domain name.");

  // Read first, so a wrong id fails before anything is sent and so the "before"
  // in the audit line is the real one rather than whatever the browser thought.
  const app = await findApp(serverId, appId);
  if (!app) throw new Error("No such application on that server.");
  if (app.domain === wanted) {
    throw new Error(`${wanted} is already the primary domain for this application.`);
  }

  const body = await post("/app/manage/cname", {
    server_id: serverId,
    app_id: appId,
    cname: wanted,
  });

  const operationId = String(body.operation_id ?? "");
  await settle(operationId);

  let now = "";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    now = (await findApp(serverId, appId))?.domain ?? "";
    if (now === wanted) break;
    // Queued work that has not landed yet reads exactly like work that failed.
    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 2500));
  }

  return {
    requested: wanted,
    now,
    changed: now === wanted,
    before: app.domain,
    operationId,
  };
}
