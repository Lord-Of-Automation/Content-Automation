import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { record } from "@/lib/audit";
import { requireSession } from "@/lib/api-guard";
import { callbackUrl, connectMail, exchangeCode } from "@/lib/mail";
import { stateHolds } from "@/lib/mailstate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Where Google sends the browser back to.
 *
 * The one place a refresh token exists in this process, and it exists for the
 * length of one function call: it arrives from Google, goes to the engine, and
 * is never written down, logged or returned. Everything after this happens on
 * the droplet.
 *
 * It answers with a redirect rather than JSON, because what arrives here is a
 * person's browser mid-flow and what they should see next is the page they
 * left, saying whether it worked.
 */
export async function GET(request: Request) {
  const asked = new URL(request.url).searchParams;
  const back = new URL("/mailing", new URL(request.url).origin);

  // Signed out mid-consent, or somebody else's link. Either way this is not a
  // page to act on.
  const denied = await requireSession();
  if (denied) return NextResponse.redirect(new URL("/login", new URL(request.url).origin));

  const refused = asked.get("error");
  if (refused) {
    back.searchParams.set(
      "mail",
      refused === "access_denied"
        ? "The connection was declined at the Google screen."
        : `Google refused the connection: ${refused}`,
    );
    return NextResponse.redirect(back);
  }

  // Proof this app started the flow. Without it, anyone who can get a signed-in
  // browser to load this address with a code of their choosing could attach
  // their own mailbox to this platform.
  if (!stateHolds(asked.get("state") ?? "")) {
    back.searchParams.set(
      "mail",
      "That connection did not come from here, or it took too long. Try again.",
    );
    return NextResponse.redirect(back);
  }

  const code = asked.get("code");
  if (!code) {
    back.searchParams.set("mail", "Google sent no authorisation code back.");
    return NextResponse.redirect(back);
  }

  const session = await auth();
  const actor = session?.user?.name ?? "unknown";

  try {
    const refreshToken = await exchangeCode(code, callbackUrl(request));
    const { address } = await connectMail(refreshToken);

    await record(actor, "mail-connected", address);
    back.searchParams.set("mail", `Connected as ${address}.`);
    back.searchParams.set("ok", "1");
  } catch (error) {
    back.searchParams.set(
      "mail",
      error instanceof Error ? error.message : "The connection could not be completed.",
    );
  }

  return NextResponse.redirect(back);
}
