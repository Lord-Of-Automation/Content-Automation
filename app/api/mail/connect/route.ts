import { NextResponse } from "next/server";

import { errorResponse, requireSession } from "@/lib/api-guard";
import { callbackUrl, consentUrl, disconnectMail, mailClient } from "@/lib/mail";
import { signState } from "@/lib/mailstate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Starts the consent.
 *
 * A redirect rather than a link on the page, so the client id and the exact
 * redirect address are assembled in one place by the half of this that knows
 * both. Getting either wrong produces a Google error page that names neither.
 */
export async function GET(request: Request) {
  const denied = await requireSession();
  if (denied) return denied;

  const client = await mailClient();
  if (!client) {
    return NextResponse.json(
      {
        error:
          "There is no Google OAuth client to grant access to. Add one under " +
          "Accounts, Search Console — the same client serves both — or set " +
          "GOOGLE_MAIL_CLIENT_ID and GOOGLE_MAIL_CLIENT_SECRET for a separate one.",
      },
      { status: 428 },
    );
  }

  try {
    return NextResponse.redirect(
      consentUrl(client.clientId, callbackUrl(request), signState()),
    );
  } catch (error) {
    return errorResponse(error);
  }
}

/** Withdrawing it, which discards the stored token on the engine. */
export async function DELETE() {
  const denied = await requireSession();
  if (denied) return denied;

  try {
    await disconnectMail();
    return NextResponse.json({ connected: false });
  } catch (error) {
    return errorResponse(error);
  }
}
