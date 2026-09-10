import { NextResponse } from "next/server";

import { errorResponse, requireSession } from "@/lib/api-guard";
import { callbackUrl, mailClient, mailStatus } from "@/lib/mail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Whether a mailbox is connected, and which. Never the token. */
export async function GET(request: Request) {
  const denied = await requireSession();
  if (denied) return denied;

  try {
    const status = await mailStatus();
    const client = await mailClient();
    return NextResponse.json({
      ...status,
      /*
       * Whether the engine has a client is no longer the question.
       *
       * The client travels to the engine with the consent now, so what matters
       * before connecting is only whether this console has one to consent
       * against — and it usually does, because Search Console needs the same
       * thing and is set up first.
       */
      configured: status.configured || !!client,
      // The engine holds one half of the OAuth client and this app holds the
      // other, and a connect button that leads to a Google error page because
      // only one of them is set is worse than a button that says why.
      consoleConfigured: !!client,
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
