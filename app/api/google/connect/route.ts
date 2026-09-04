import { NextResponse } from "next/server";

import { requireSession } from "@/lib/api-guard";
import { consentUrl, makeState, oauthClient, redirectUri } from "@/lib/googleoauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Sends the browser to Google's consent screen. */
export async function GET(request: Request) {
  const denied = await requireSession();
  if (denied) return denied;

  const client = await oauthClient();
  if (!client) {
    // Back to the page that can fix it, rather than a bare error the browser
    // shows in place of the app.
    return NextResponse.redirect(
      new URL("/keys?google=no-client", redirectUri(request)),
    );
  }

  return NextResponse.redirect(
    consentUrl(client, redirectUri(request), makeState()),
  );
}
