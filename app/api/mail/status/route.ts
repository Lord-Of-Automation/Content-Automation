import { NextResponse } from "next/server";

import { errorResponse, requireSession } from "@/lib/api-guard";
import { callbackUrl, mailClientId, mailStatus } from "@/lib/mail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Whether a mailbox is connected, and which. Never the token. */
export async function GET(request: Request) {
  const denied = await requireSession();
  if (denied) return denied;

  try {
    const status = await mailStatus();
    return NextResponse.json({
      ...status,
      // The engine holds one half of the OAuth client and this app holds the
      // other, and a connect button that leads to a Google error page because
      // only one of them is set is worse than a button that says why.
      consoleConfigured: !!mailClientId(),
      /*
       * The address Google must be told to send the browser back to.
       *
       * Worked out here rather than described in a note, because it has to
       * match what is registered against the OAuth client character for
       * character and Google's mismatch error names neither side. A page that
       * shows the exact string to paste removes the whole class of it.
       */
      redirectUri: callbackUrl(request),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
