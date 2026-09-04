/**
 * Credentials for the registrars this console can read.
 *
 * One store rather than one variable per provider, because the three of them
 * do not agree on what a credential even is. GoDaddy issues a single bearer
 * token. Spaceship issues a key and a separate secret. Namecheap wants a
 * username, a key, and the IP address the call will come from, which has to be
 * whitelisted in their dashboard first — so a Namecheap credential that is
 * perfectly correct still fails from an address nobody registered.
 *
 * Every secret is encrypted at rest with the same scheme as the WordPress
 * logins. That matters more here: registrar credentials are account-wide by
 * default, and the token that lists your domains is the token that could
 * transfer them away. A dump of the store must not be a working credential.
 *
 * Nothing is ever returned to the browser. The status carries which fields are
 * set, the last four characters of each, and when the credential expires.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { kvConfigured, kvGetJSON, kvSetJSON } from "./kv";
import { decrypt, encrypt } from "./secrets";

const KEY = "content-automation:providers";
const DIR = path.join(process.cwd(), ".data");
const FILE = path.join(DIR, "providers.json");

export type ProviderId =
  | "godaddy" | "gandi" | "namecheap" | "spaceship"
  | "cloudflare"
  | "searchconsole";

export interface ProviderField {
  name: string;
  label: string;
  /** A password field is masked and never echoed back. */
  secret: boolean;
  /** A textarea rather than one line, for a value that holds several. */
  multiline?: boolean;
  /**
   * Stored but never shown as an input.
   *
   * For values the app writes rather than a person types — the Google refresh
   * token arrives from a redirect, and saveProvider only keeps fields the spec
   * declares, so without this it would be silently dropped on the way in.
   */
  hidden?: boolean;
  placeholder: string;
  hint?: string;
  /** Rejected before storing when it does not match. */
  pattern?: RegExp;
  /** What to say when it does not match. */
  patternNote?: string;
}

export interface ProviderSpec {
  id: ProviderId;
  label: string;
  /** Whether this provider currently feeds the Domains page. */
  wired: boolean;
  blurb: string;
  fields: ProviderField[];
}

/**
 * What each registrar wants, in its own terms.
 *
 * Written out rather than assumed to be "an API key", because getting this
 * wrong is a form somebody fills in correctly and a call that cannot be made.
 */
export const PROVIDERS: ProviderSpec[] = [
  {
    id: "godaddy",
    label: "GoDaddy",
    wired: true,
    blurb:
      "A Personal Access Token from Account, API Keys. It carries account-wide " +
      "scope — the same token that lists domains could transfer them — so it is " +
      "encrypted here and never sent to the browser.",
    fields: [
      {
        name: "token",
        label: "Personal Access Token",
        secret: true,
        placeholder: "gd_pat_…",
        pattern: /^gd_pat_[A-Za-z0-9_-]{20,}$/,
        patternNote:
          "A GoDaddy token starts with gd_pat_ and has no spaces. Paste the token " +
          "itself, not the whole Authorization header and not the key id beside it.",
      },
    ],
  },
  {
    id: "gandi",
    label: "Gandi",
    wired: true,
    blurb:
      "One API key, from Account, Authentication options. Gandi's own older " +
      "documentation shows it sent as \"Apikey\", which its current API refuses " +
      "with a 403 — it goes as a bearer token, which is what this uses.",
    fields: [
      {
        name: "apiKey",
        label: "API key",
        secret: true,
        placeholder: "the key or personal access token",
      },
    ],
  },
  {
    id: "cloudflare",
    label: "Cloudflare",
    wired: true,
    blurb:
      "Not a registrar. It runs the DNS for a domain once its name servers " +
      "point at it, which is where the records for most of this estate actually " +
      "live. One line per account: a token, a space, then that account's id. A " +
      "token only ever sees the account it was issued for, so an estate spread " +
      "over several accounts needs one line for each or most of it stays " +
      "invisible. Each token needs Zone:Read, Zone:Edit and DNS:Edit.",
    fields: [
      {
        name: "apiToken",
        label: "Tokens and account ids",
        secret: true,
        multiline: true,
        placeholder: "cfut_… 513064bf88adb2fc058a15bb852234f7",
        hint:
          "One account per line. The id is the 32 hex characters in the " +
          "dashboard address bar, and is what new zones are created in.",
      },
    ],
  },
  {
    id: "searchconsole",
    label: "Search Console",
    wired: true,
    blurb:
      "Not a registrar either. It reports what each site earns in Google, which " +
      "is the Performance page. There is no API key for it: Google only gives " +
      "this data to someone with access. Sign in below and it sees every " +
      "property that account owns, including ones added later. The service " +
      "account underneath is the alternative, and it has to be added to each " +
      "property by hand — a property it is not on is invisible rather than " +
      "refused, which reads exactly like an empty account.",
    fields: [
      {
        name: "clientId",
        label: "OAuth client ID",
        secret: false,
        placeholder: "…apps.googleusercontent.com",
        hint: "From Google Cloud, Credentials, OAuth client, type Web application.",
      },
      {
        name: "clientSecret",
        label: "OAuth client secret",
        secret: true,
        placeholder: "GOCSPX-…",
      },
      {
        name: "refreshToken",
        label: "Google sign-in",
        secret: true,
        hidden: true,
        placeholder: "",
      },
      {
        name: "googleEmail",
        label: "Signed in as",
        secret: false,
        hidden: true,
        placeholder: "",
      },
      {
        name: "serviceAccount",
        label: "Service account JSON (optional)",
        secret: true,
        multiline: true,
        placeholder: '{"type":"service_account","client_email":"…","private_key":"…"}',
        hint:
          "Only needed without a Google sign-in. A service account sees a " +
          "property only after being added to it as a user, one at a time.",
      },
    ],
  },
  {
    id: "namecheap",
    label: "Namecheap",
    wired: false,
    blurb:
      "Three parts, not one. Namecheap authenticates on your username, your API " +
      "key and the address the request comes from, and the address must be " +
      "whitelisted under Profile, Tools, API Access before any of it works.",
    fields: [
      {
        name: "apiUser",
        label: "API user",
        secret: false,
        placeholder: "your Namecheap username",
        hint: "Usually the same as the account username.",
      },
      { name: "apiKey", label: "API key", secret: true, placeholder: "the key from API Access" },
      {
        name: "clientIp",
        label: "Whitelisted IP",
        secret: false,
        placeholder: "203.0.113.10",
        pattern: /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/,
        patternNote:
          "Namecheap accepts IPv4 only, and it must be the address this app calls " +
          "from. On Vercel that is not a fixed address, so this will need a static " +
          "egress IP to work at all.",
        hint: "IPv4 only. Must match what Namecheap has whitelisted.",
      },
    ],
  },
  {
    id: "spaceship",
    label: "Spaceship",
    wired: false,
    blurb:
      "A key and a separate secret, both from the API Manager in your Spaceship " +
      "account. They travel as two headers, so both are needed for any call.",
    fields: [
      { name: "apiKey", label: "API key", secret: true, placeholder: "from API Manager" },
      { name: "apiSecret", label: "API secret", secret: true, placeholder: "from API Manager" },
    ],
  },
];

export function specFor(id: string): ProviderSpec | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

type StoredProvider = {
  /** Field name to ciphertext. Non-secret fields are stored in the clear. */
  values: Record<string, string>;
  expiresAt: string | null;
  savedAt: string;
  savedBy: string;
};

type Store = Partial<Record<ProviderId, StoredProvider>>;

/** What the browser may see. Never a secret. */
export interface ProviderStatus {
  id: ProviderId;
  set: boolean;
  source: "console" | "environment" | "unset";
  /** Field name to a display value: the plain value, or the last four of a secret. */
  shown: Record<string, string>;
  expiresAt: string | null;
  /** Days until expiry, negative once past. Null when no date was given. */
  daysLeft: number | null;
  savedAt: string | null;
  savedBy: string | null;
  /** False when AUTH_SECRET changed and the stored values can no longer be read. */
  readable: boolean;
  /**
   * One entry per Cloudflare account, masked.
   *
   * Cloudflare is the one provider where several credentials are ordinary
   * rather than exceptional: an estate this size spans accounts, and a token
   * only sees the one it was issued for. The account id is the key — it is
   * unique, it is not a secret, and it is what lets a row be edited or removed
   * without the token ever coming back to the browser to be edited alongside it.
   */
  accounts?: Array<{ accountId: string; tail: string }>;
}

async function read(): Promise<Store> {
  if (kvConfigured()) {
    const row = await kvGetJSON<Store>(KEY);
    if (row) return row;
  }
  try {
    if (existsSync(FILE)) {
      const parsed = JSON.parse(readFileSync(FILE, "utf8")) as Store;
      if (parsed && typeof parsed === "object") return parsed;
    }
  } catch {
    // A corrupt file falls back to the environment rather than taking the page
    // down. The console then says the credential came from the environment,
    // which is true and is the thing worth knowing.
  }
  return {};
}

async function write(store: Store): Promise<void> {
  if (kvConfigured()) {
    if (await kvSetJSON(KEY, store)) return;
    throw new Error(
      "The key store did not accept the write, so nothing was saved. " +
        "Check KV_REST_API_URL and KV_REST_API_TOKEN, then try again.",
    );
  }
  mkdirSync(DIR, { recursive: true });
  writeFileSync(FILE, JSON.stringify(store, null, 2), "utf8");
}

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return null;
  return Math.round((at - Date.now()) / 86_400_000);
}

/**
 * The stored Cloudflare lines, split into accounts.
 *
 * Written as "token accountId" per line, because that is the shape a person
 * pastes. Read back as pairs so the form can show one row each.
 */
export function splitCloudflare(raw: string): Array<{ token: string; accountId: string }> {
  const out: Array<{ token: string; accountId: string }> = [];
  for (const line of String(raw || "").split(/[\r\n]+/)) {
    const parts = line.trim().split(/[\s,]+/).filter(Boolean);
    if (!parts.length) continue;
    const token = parts.find((p) => p.startsWith("cfut_") || p.length > 30) ?? parts[0];
    const accountId = parts.find((p) => /^[0-9a-f]{32}$/i.test(p)) ?? "";
    if (token) out.push({ token, accountId });
  }
  return out;
}

/** The stored lines, with the legacy separate account id folded in. */
async function storedCloudflare(): Promise<{
  rows: Array<{ token: string; accountId: string }>;
  entry: StoredProvider | undefined;
}> {
  const store = await read();
  const entry = store.cloudflare;
  if (!entry?.values.apiToken) return { rows: [], entry };

  try {
    // The account id used to be a field of its own, so a credential saved
    // before this took lines has its id nowhere near its token.
    const legacy = entry.values.accountId ?? "";
    const rows = splitCloudflare(decrypt(entry.values.apiToken)).map((a, at) => ({
      token: a.token,
      accountId: a.accountId || (at === 0 ? legacy : ""),
    }));
    return { rows, entry };
  } catch {
    // Unreadable is the same as absent: better to ask for it again than to
    // build a credential list out of ciphertext nobody can decrypt.
    return { rows: [], entry };
  }
}

async function writeCloudflare(
  rows: Array<{ token: string; accountId: string }>,
  actor: string,
): Promise<void> {
  const store = await read();

  if (!rows.length) {
    // Removing the last one is a deletion. An empty credential would read as
    // "set" on the Keys page and answer nothing at all.
    delete store.cloudflare;
    await write(store);
    return;
  }

  store.cloudflare = {
    // Lines only from here on, so the old two-field shape cannot come back.
    values: {
      apiToken: encrypt(
        rows.map((r) => (r.accountId ? `${r.token} ${r.accountId}` : r.token)).join("\n"),
      ),
    },
    expiresAt: store.cloudflare?.expiresAt ?? null,
    savedAt: new Date().toISOString(),
    savedBy: actor,
  };
  await write(store);
}

/**
 * Adds one Cloudflare account to the list.
 *
 * Appending rather than replacing, because that is what the form does: one box
 * of inputs, and each token entered joins the ones already there. Editing a
 * list of secrets in place never worked here anyway — none of them can be shown
 * back, so every row would have to be retyped to change any of them.
 */
export async function addCloudflareAccount(
  token: string,
  accountId: string,
  actor: string,
): Promise<SaveResult> {
  const clean = String(token || "").trim();
  const id = String(accountId || "").trim().toLowerCase();

  if (!/^cfut_[A-Za-z0-9_-]{20,}$/.test(clean)) {
    return {
      ok: false,
      error:
        "A Cloudflare token starts with cfut_ and has no spaces. Paste the token " +
        "itself, not the whole Authorization header.",
    };
  }
  if (id && !/^[0-9a-f]{32}$/.test(id)) {
    return { ok: false, error: "A Cloudflare account id is 32 hexadecimal characters." };
  }

  const { rows } = await storedCloudflare();

  // The same token twice is a mistake worth naming rather than a list that
  // quietly does everything twice.
  if (rows.some((r) => r.token === clean)) {
    return { ok: false, error: "That token is already in the list." };
  }
  if (id && rows.some((r) => r.accountId === id)) {
    return {
      ok: false,
      error:
        `An account ending ${rows.find((r) => r.accountId === id)!.token.slice(-4)} is already ` +
        "listed for that id. Remove it first if you are replacing its token.",
    };
  }

  try {
    await writeCloudflare([...rows, { token: clean, accountId: id }], actor);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not save." };
  }
  return { ok: true };
}

/** Drops one, found by its account id, or by its token's last four. */
export async function removeCloudflareAccount(
  key: string,
  actor: string,
): Promise<SaveResult> {
  const wanted = String(key || "").trim().toLowerCase();
  if (!wanted) return { ok: false, error: "Nothing named to remove." };

  const { rows } = await storedCloudflare();
  const kept = rows.filter(
    (r) => r.accountId.toLowerCase() !== wanted && r.token.slice(-4).toLowerCase() !== wanted,
  );
  if (kept.length === rows.length) return { ok: false, error: "No such credential." };

  try {
    await writeCloudflare(kept, actor);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not save." };
  }
  return { ok: true };
}

/** Only GoDaddy has one, from when the token lived in the deployment. */
function fromEnvironment(id: ProviderId): Record<string, string> | null {
  if (id !== "godaddy") return null;
  const token = process.env.GODADDY_API_KEY?.trim();
  return token ? { token } : null;
}

function statusOf(spec: ProviderSpec, store: Store): ProviderStatus {
  const row = store[spec.id];

  if (row) {
    const shown: Record<string, string> = {};
    let readable = true;
    for (const field of spec.fields) {
      const raw = row.values[field.name];
      if (!raw) continue;
      if (!field.secret) {
        shown[field.name] = raw;
        continue;
      }
      try {
        shown[field.name] = `ends ${decrypt(raw).slice(-4)}`;
      } catch {
        readable = false;
      }
    }
    // Cloudflare's rows, masked, so the form can list them one per line.
    let accountRows: ProviderStatus["accounts"];
    if (spec.id === "cloudflare" && row.values.apiToken) {
      try {
        // The account id used to be a field of its own, so a credential saved
        // before rows existed has the token on one line and the id nowhere near
        // it. Reading that back as a row with a blank account id is how the
        // first account ends up looking empty — and then unmatchable, because
        // the merge below keys on exactly that id.
        const legacy = row.values.accountId ?? "";
        accountRows = splitCloudflare(decrypt(row.values.apiToken)).map((a, at) => ({
          accountId: a.accountId || (at === 0 ? legacy : ""),
          tail: a.token.slice(-4),
        }));
      } catch {
        accountRows = [];
      }
    }

    return {
      id: spec.id,
      set: Object.keys(shown).length > 0 || !readable,
      source: "console",
      accounts: accountRows,
      shown,
      expiresAt: row.expiresAt,
      daysLeft: daysUntil(row.expiresAt),
      savedAt: row.savedAt,
      savedBy: row.savedBy,
      readable,
    };
  }

  const env = fromEnvironment(spec.id);
  if (env) {
    return {
      id: spec.id,
      set: true,
      source: "environment",
      shown: Object.fromEntries(
        Object.entries(env).map(([k, v]) => [k, `ends ${v.slice(-4)}`]),
      ),
      expiresAt: null,
      daysLeft: null,
      savedAt: null,
      savedBy: null,
      readable: true,
    };
  }

  return {
    id: spec.id,
    set: false,
    source: "unset",
    shown: {},
    expiresAt: null,
    daysLeft: null,
    savedAt: null,
    savedBy: null,
    readable: true,
  };
}

export async function allStatuses(): Promise<ProviderStatus[]> {
  const store = await read();
  return PROVIDERS.map((spec) => statusOf(spec, store));
}

export type SaveResult = { ok: true } | { ok: false; error: string };

/**
 * Saves what was filled in, keeping what was not.
 *
 * A blank field means "leave it alone" rather than "clear it", because the
 * secrets are never shown back — so a form re-rendered after a save has empty
 * password boxes, and treating those as an instruction to erase would destroy
 * a credential every time somebody corrected the expiry date.
 */
export async function saveProvider(
  id: string,
  values: Record<string, string>,
  expiresAt: string,
  actor: string,
): Promise<SaveResult> {
  const spec = specFor(id);
  if (!spec) return { ok: false, error: "There is no such provider." };

  const store = await read();
  const existing = store[spec.id];
  const next: Record<string, string> = { ...(existing?.values ?? {}) };

  /**
   * Changing the Google OAuth client throws away the sign-in with it.
   *
   * A refresh token belongs to the client that issued it. Point this at a
   * different client id and the stored token stops working — Google answers
   * "unauthorized", which reads as a broken sign-in rather than as the
   * consequence of the change just made. Clearing it means the page says
   * "not signed in", which is true and has an obvious next step.
   */
  if (spec.id === "searchconsole") {
    const newClient = String(values.clientId ?? "").trim();
    const newSecret = String(values.clientSecret ?? "").trim();
    const oldClient = existing?.values.clientId ?? "";
    const changed =
      (newClient && newClient !== oldClient) ||
      // The secret cannot be compared, being encrypted, so any new one counts
      // as a change. Re-entering the same secret costs one reconnection.
      !!newSecret;

    if (changed && next.refreshToken) {
      delete next.refreshToken;
      delete next.googleEmail;
    }
  }

  for (const field of spec.fields) {
    const given = String(values[field.name] ?? "").trim();
    if (!given) continue;

    if (field.pattern && !field.pattern.test(given)) {
      return { ok: false, error: field.patternNote ?? `${field.label} is not in the expected form.` };
    }

    try {
      next[field.name] = field.secret ? encrypt(given) : given;
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Could not encrypt." };
    }
  }

  if (!Object.keys(next).length) {
    return { ok: false, error: `Fill in at least one field for ${spec.label}.` };
  }

  let when: string | null = existing?.expiresAt ?? null;
  if (expiresAt.trim()) {
    const at = Date.parse(expiresAt);
    if (!Number.isFinite(at)) return { ok: false, error: "That expiry date is not a date." };
    when = new Date(at).toISOString();
  }

  store[spec.id] = {
    values: next,
    expiresAt: when,
    savedAt: new Date().toISOString(),
    savedBy: actor,
  };
  await write(store);
  return { ok: true };
}

/** Forgets one provider entirely, so any environment variable takes over. */
export async function clearProvider(id: string): Promise<SaveResult> {
  const spec = specFor(id);
  if (!spec) return { ok: false, error: "There is no such provider." };

  const store = await read();
  delete store[spec.id];
  await write(store);
  return { ok: true };
}

/**
 * The decrypted credential for one provider, for making a call with.
 *
 * Null when nothing is stored and no environment variable stands in. Callers
 * turn that into a message about where to put one, rather than calling the
 * registrar with an empty string and reporting its refusal as a bad token.
 */
export async function credentialFor(id: ProviderId): Promise<Record<string, string> | null> {
  const spec = specFor(id);
  if (!spec) return null;

  const store = await read();
  const row = store[id];

  if (row) {
    const out: Record<string, string> = {};
    for (const field of spec.fields) {
      const raw = row.values[field.name];
      if (!raw) continue;
      if (!field.secret) {
        out[field.name] = raw;
        continue;
      }
      try {
        out[field.name] = decrypt(raw);
      } catch {
        // Unreadable is the same as absent. Falling through to the environment
        // beats calling the registrar with nonsense.
        return fromEnvironment(id);
      }
    }
    if (Object.keys(out).length) return out;
  }

  return fromEnvironment(id);
}
