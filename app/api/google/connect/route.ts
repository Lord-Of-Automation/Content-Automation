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

  const redirect = redirectUri(request);

  /**
   * What would be sent, instead of sending it.
   *
   * redirect_uri_mismatch is decided by Google comparing two strings, and
   * neither end shows you both. The registration is in a different console
   * under a different account, and the request only exists for the instant the
   * browser follows it. This prints the request's own values so they can be
   * held against the registration without decoding an address bar.
   */
  if (new URL(request.url).searchParams.get("show")) {
    return NextResponse.json({
      redirectUri: redirect,
      clientId: client.clientId,
      // The client id says which OAuth client Google will check the redirect
      // against, which is the half people get wrong once there are two.
      note:
        "Register redirectUri verbatim under Authorised redirect URIs on the " +
        "OAuth client with this exact clientId. A different client having it " +
        "registered does not count.",
    });
  }

  return NextResponse.redirect(consentUrl(client, redirect, makeState()));
}
