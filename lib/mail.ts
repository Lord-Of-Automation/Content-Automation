/**
 * The Mailing page's half of the console.
 *
 * The consent runs here, because this is the public half with a login on it and
 * Google has to redirect a browser somewhere. Everything after the consent runs
 * on the engine: it holds the refresh token, it does the sending, and it is the
 * only thing that ever reads a mailbox.
 *
 * That split is deliberate rather than incidental. This app is redeployed
 * whenever anybody pushes and keeps nothing between deploys, so a token stored
 * here would have to live in an environment variable somebody pastes — and the
 * whole point of connecting an account in a browser is that nobody has to.
 *
 * A refresh token passes through this process exactly once, on its way from
 * Google to the droplet, and is never written down here or returned to a page.
 */

import { backend } from "./backend";
import { oauthClient } from "./googleoauth";

/**
 * What the account is asked for.
 *
 * Send, and read. Read is the uncomfortable half, because Gmail offers nothing
 * narrower than a whole mailbox and what is wanted is four conversations — so
 * the narrowing lives in the engine, which only ever asks for a thread it
 * started. Worth knowing when the consent screen lists this and it reads as
 * more than it is.
 */
export const MAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
  /*
   * Drafts, in the sender's own Drive.
   *
   * The narrow Drive scope: it reaches files this application created and no
   * others, so connecting a mailbox does not hand over a Drive. A campaign
   * needs it because a publisher will not read an article pasted into an
   * email, and the service account cannot stand in — it has read access to
   * Drive, and a document it owned would sit in an account nobody can open.
   */
  "https://www.googleapis.com/auth/drive.file",
];

/** One connected account, and the addresses it may send as. */
export type Mailbox = {
  address: string;
  sendAs: string[];
  connectedAt: string;
  /** Whether this one may put a draft in Drive. */
  canDraft: boolean;
  /** Why it is not usable, when it is not. */
  note?: string;
};

export type MailStatus = {
  /** Whether the engine has an OAuth client to run a consent against. */
  configured: boolean;
  connected: boolean;
  /** Every account connected here. A publisher is written to as one of them. */
  mailboxes?: Mailbox[];
  /** Every address anything connected can send as, for a chooser to offer. */
  senders?: string[];
  note?: string;
  /** Whether this app has the other half of that client. */
  consoleConfigured?: boolean;
  /** The exact address to register against the OAuth client. */
  redirectUri?: string;
};

export type Contact = {
  row: number;
  domain: string;
  email: string;
  sentAt: string | null;
  sent: number;
};

export type ThreadMessage = {
  id: string;
  from: string;
  to: string;
  subject: string;
  at: string;
  text: string;
  mine: boolean;
  /**
   * Pictures in this message, named but not carried.
   *
   * Absent on a conversation read by an engine older than this, which is why
   * it is optional rather than an empty array everybody has to remember to
   * send.
   */
  images?: ThreadPicture[];
};

export type Thread = {
  email: string;
  domain: string;
  threadId: string;
  subject: string;
  sentAt: string;
  sent: number;
  /** The account holding this conversation, and the identity it went out as. */
  mailbox?: string;
  from?: string;
  replies: number;
  /** Whether anything they wrote back names a way to be paid. */
  paypal?: boolean;
  /** When the invoice was paid, set by hand. Null while it is still owed. */
  paidAt?: string | null;
  lastAt?: string;
  messages: ThreadMessage[];
  note?: string;
};

/** One row of the prospects sheet, as something to filter and choose from. */
export type Opportunity = {
  row: number;
  domain: string;
  email: string;
  rating: number | null;
  traffic: number | null;
  price: number | null;
  geo: string;
  language: string;
  /** Which of our addresses this publisher knows us by, where the sheet says. */
  sender: string;
  /** Whatever the operator wrote about this one. */
  notes: string;
  countries: string;
  sentAt: string | null;
  sent: number;
};

/** Which columns the sheet actually has, so a filter can say when it has none. */
export type SheetHas = {
  email: boolean;
  price: boolean;
  geo: boolean;
  language: boolean;
  sender: boolean;
  notes: boolean;
};

/** A campaign that has run, as the history reads it back. */
export type Campaign = {
  id: string;
  status: string;
  startedAt: string;
  stoppedAt: string | null;
  error: string | null;
  anchor: string;
  anchorUrl: string;
  brief: string;
  /** How many publishers were chosen when it started. */
  chosen: number;
  written: Array<{ domain: string; draft: string }>;
  skipped: Array<{ domain: string; because: string }>;
};

export class NotOnThisBackend extends Error {}

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
  if (backend() !== "engine") {
    throw new NotOnThisBackend(
      "Mailing runs on the engine, and this deployment is pointed at n8n.",
    );
  }

  const response = await fetch(`${base()}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token()}`,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
    // Reading a dozen conversations is a dozen calls to Gmail on the other
    // side, so this waits longer than the schedule calls do.
    signal: AbortSignal.timeout(60_000),
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

/**
 * The OAuth client the consent is granted to.
 *
 * The Search Console one, unless something says otherwise. This console
 * already stores a Google OAuth client — it needs one to read Search Console
 * on somebody's behalf, and it keeps it under Accounts where it can be typed
 * in rather than in an environment variable that needs a redeploy to change.
 *
 * Asking for a second one meant a second client in Google Cloud, two more
 * variables in Vercel, the same two again on the engine, and a redeploy to
 * make any of it take effect. All of that to name the same application twice.
 * One client with the Gmail API enabled and a second redirect address on it
 * does the same job.
 *
 * The environment variables still win where they are set, for anyone who
 * would rather keep outreach on its own client — revoking one grant revokes
 * the other when they share a client, and that is a real reason to separate
 * them.
 */
export async function mailClient(): Promise<{ clientId: string; clientSecret: string } | null> {
  const fromEnv = {
    clientId: process.env.GOOGLE_MAIL_CLIENT_ID?.trim() ?? "",
    clientSecret: process.env.GOOGLE_MAIL_CLIENT_SECRET?.trim() ?? "",
  };
  if (fromEnv.clientId && fromEnv.clientSecret) return fromEnv;

  const shared = await oauthClient();
  return shared ? { clientId: shared.clientId, clientSecret: shared.clientSecret } : null;
}

/**
 * Where Google sends the browser back to.
 *
 * It has to match what is registered against the OAuth client exactly, down to
 * the scheme and the trailing path, or Google refuses the whole thing with a
 * mismatch error that names neither side. Taken from the request rather than
 * configured, so a preview deployment and production each ask for their own
 * address instead of one of them silently asking for the other's.
 */
export function callbackUrl(request: Request): string {
  const configured = process.env.MAIL_REDIRECT_URL?.trim();
  if (configured) return configured;
  return new URL("/api/mail/callback", new URL(request.url).origin).toString();
}

/** The consent screen, with everything Google needs to come back usefully. */
export function consentUrl(clientId: string, redirect: string, state: string): string {
  const asked = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirect,
    response_type: "code",
    scope: MAIL_SCOPES.join(" "),
    // Offline, or there is no refresh token and the connection dies in an hour.
    access_type: "offline",
    // Google issues a refresh token on first consent only. Without this, a
    // second attempt after a mistake comes back with nothing to store and no
    // explanation of why.
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${asked.toString()}`;
}

/** The code Google handed back, exchanged for the token the engine will keep. */
export async function exchangeCode(
  code: string,
  redirect: string,
  client: { clientId: string; clientSecret: string },
): Promise<string> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: client.clientId,
      client_secret: client.clientSecret,
      redirect_uri: redirect,
      grant_type: "authorization_code",
    }).toString(),
    signal: AbortSignal.timeout(30_000),
  });

  const body = (await response.json().catch(() => null)) as {
    refresh_token?: string;
    error?: string;
    error_description?: string;
  } | null;

  if (!response.ok || !body?.refresh_token) {
    /*
     * No refresh token, which is not the same as no token.
     *
     * Google hands one out on the first consent and silently withholds it on
     * every later one unless asked again, so the commonest way to land here is
     * to have connected before. The consent URL asks every time for exactly
     * this reason, and this says so in case it ever stops working.
     */
    const why = body?.error_description ?? body?.error ?? `Google answered ${response.status}`;
    throw new Error(
      body && !body.refresh_token && response.ok
        ? "Google returned no refresh token. Remove this app at " +
          "myaccount.google.com/permissions and connect again."
        : `Google refused the connection: ${why}`,
    );
  }

  return body.refresh_token;
}

export async function mailStatus(): Promise<MailStatus> {
  return call<MailStatus>("/mail/status");
}

/**
 * Hands the engine everything it needs to keep using the consent.
 *
 * The client travels with the token, rather than being configured separately
 * on the engine. It is not a secret the engine has any other use for, and
 * asking somebody to paste the same two values into a second screen before the
 * first one works is how a five-minute setup becomes an afternoon.
 */
export async function connectMail(
  refreshToken: string,
  client: { clientId: string; clientSecret: string },
): Promise<{ address: string }> {
  return call<{ address: string }>("/mail/connect", {
    method: "POST",
    body: JSON.stringify({
      refresh_token: refreshToken,
      client_id: client.clientId,
      client_secret: client.clientSecret,
    }),
  });
}

/** One named account, or every one of them when none is named. */
export async function disconnectMail(address = ""): Promise<void> {
  await call(
    `/mail/connect${address ? `?address=${encodeURIComponent(address)}` : ""}`,
    { method: "DELETE" },
  );
}

export async function mailContacts(sheet: string, tab: string): Promise<Contact[]> {
  const asked = new URLSearchParams();
  if (sheet) asked.set("sheet", sheet);
  if (tab) asked.set("tab", tab);
  const { contacts } = await call<{ contacts: Contact[] }>(
    `/mail/contacts${asked.toString() ? `?${asked}` : ""}`,
  );
  return contacts ?? [];
}

export async function sendToProspect(input: {
  to: string;
  subject: string;
  body: string;
  domain: string;
}): Promise<void> {
  await call("/mail/send", { method: "POST", body: JSON.stringify(input) });
}

export async function mailThreads(): Promise<{ threads: Thread[]; address: string }> {
  const answer = await call<{ threads: Thread[]; address?: string }>("/mail/threads");
  return { threads: answer.threads ?? [], address: answer.address ?? "" };
}

export async function forgetThread(email: string): Promise<void> {
  await call(`/mail/threads/${encodeURIComponent(email)}`, { method: "DELETE" });
}

export async function mailOpportunities(
  sheet: string,
  tab: string,
): Promise<{ opportunities: Opportunity[]; has: SheetHas }> {
  const asked = new URLSearchParams();
  if (sheet) asked.set("sheet", sheet);
  if (tab) asked.set("tab", tab);
  const answer = await call<{ opportunities: Opportunity[]; has: SheetHas }>(
    `/mail/opportunities${asked.toString() ? `?${asked}` : ""}`,
  );
  return {
    opportunities: answer.opportunities ?? [],
    has: answer.has ?? {
      email: false, price: false, geo: false, language: false,
      sender: false, notes: false,
    },
  };
}

export async function mailCampaigns(): Promise<Campaign[]> {
  const { campaigns } = await call<{ campaigns: Campaign[] }>("/mail/campaigns");
  return campaigns ?? [];
}

/**
 * Answers a publisher inside the conversation they wrote in.
 *
 * The engine decides which account it goes out as and what it threads onto —
 * both are on the record it kept when it sent the first message, and neither
 * is something a browser should be trusted to name.
 */
/** A picture in a message, named by the engine but not yet fetched. */
export interface ThreadPicture {
  id: string;
  name: string;
  mime: string;
  bytes: number;
}

/** The bytes of one, base64, for the route that turns them into a response. */
export async function threadImage(
  email: string,
  message: string,
  id: string,
): Promise<{ mime: string; name: string; data: string }> {
  const query = `message=${encodeURIComponent(message)}&id=${encodeURIComponent(id)}`;
  return call<{ mime: string; name: string; data: string }>(
    `/mail/threads/${encodeURIComponent(email)}/image?${query}`,
  );
}

export interface ReplyPicture {
  name: string;
  mime: string;
  /** Base64, no data: prefix. */
  data: string;
}

export async function replyToThread(
  email: string,
  body: string,
  images: ReplyPicture[] = [],
): Promise<{ sent: number }> {
  return call<{ sent: number }>(`/mail/threads/${encodeURIComponent(email)}/reply`, {
    method: "POST",
    body: JSON.stringify({ body, images }),
  });
}

/** Marks one paid, or puts it back. */
export async function setThreadPaid(email: string, paid: boolean): Promise<void> {
  await call(`/mail/threads/${encodeURIComponent(email)}/paid`, {
    method: "POST",
    body: JSON.stringify({ paid }),
  });
}
