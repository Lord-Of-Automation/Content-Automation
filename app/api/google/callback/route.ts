import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { record } from "@/lib/audit";
import { requireSession } from "@/lib/api-guard";
import {
  checkState, exchangeCode, forgetAccessToken, oauthClient, redirectUri,
} from "@/lib/googleoauth";
import { saveProvider } from "@/lib/providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Where Google sends the browser back.
 *
 * Every exit is a redirect to the Keys page carrying a reason, because this
 * loads in a browser tab rather than being fetched — a JSON error here would
 * be shown to a person as raw text in place of the app.
 */
export async function GET(request: Request) {
  const back = (reason: string) =>
    NextResponse.redirect(new URL(`/keys?google=${reason}`, redirectUri(request)));

  const denied = await requireSession();
  if (denied) return back("signed-out");

  const params = new URL(request.url).searchParams;

  // Google's own refusal, which is usually the consent screen being closed.
  if (params.get("error")) return back(params.get("error") === "access_denied" ? "cancelled" : "refused");

  const code = params.get("code") ?? "";
  const state = params.get("state") ?? "";
  // Proves the callback belongs to a sign-in this app started, rather than a
  // link somebody was sent.
  if (!code || !checkState(state)) return back("bad-state");

  const client = await oauthClient();
  if (!client) return back("no-client");

  const session = await auth();
  const actor = session?.user?.name ?? "unknown";

  try {
    const { refreshToken, email } = await exchangeCode(client, code, redirectUri(request));

    // Saved through the ordinary credential path, so it is encrypted at rest
    // like everything else and the client id and secret beside it are kept.
    const saved = await saveProvider(
      "searchconsole",
      { refreshToken, googleEmail: email ?? "" },
      "",
      actor,
    );
    if (!saved.ok) return back("not-saved");

    forgetAccessToken();
    await record(actor, "keys-updated", `Search Console: signed in as ${email ?? "a Google account"}`);
    return back("connected");
  } catch {
    return back("failed");
  }
}
