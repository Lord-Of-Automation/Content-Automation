import { NextResponse } from "next/server";

import { errorResponse, requireSession } from "@/lib/api-guard";
import { callbackUrl, consentUrl, disconnectMail, mailClientId } from "@/lib/mail";
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

  if (!mailClientId()) {
    return NextResponse.json(
      {
        error:
          "GOOGLE_MAIL_CLIENT_ID is not set on this console, so there is no " +
          "application for Google to grant access to.",
      },
      { status: 428 },
    );
  }

  try {
    return NextResponse.redirect(consentUrl(callbackUrl(request), signState()));
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
