import { NextResponse } from "next/server";

import { errorResponse, requireSession } from "@/lib/api-guard";
import { GoDaddyConfigError, listDomains } from "@/lib/godaddy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A large account pages, and each page is a round trip to GoDaddy.
export const maxDuration = 60;

export async function GET() {
  const denied = await requireSession();
  if (denied) return denied;

  try {
    return NextResponse.json(await listDomains());
  } catch (error) {
    // A missing key is something to go and fix in the project settings, not an
    // upstream failure to retry. errorResponse would call it a 502 and send
    // whoever is reading off to check GoDaddy's status page.
    if (error instanceof GoDaddyConfigError) {
      return NextResponse.json({ error: error.message, kind: "config" }, { status: 500 });
    }
    return errorResponse(error);
  }
}
