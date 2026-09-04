import { NextResponse } from "next/server";

import { errorResponse, requireSession } from "@/lib/api-guard";
import { readPerformance, SearchConsoleConfigError } from "@/lib/searchconsole";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A token, a property listing, then one query per property in small batches.
export const maxDuration = 90;

export async function GET(request: Request) {
  const denied = await requireSession();
  if (denied) return denied;

  const asked = Number(new URL(request.url).searchParams.get("days"));
  // Ninety days is as far back as Search Console keeps for most properties, and
  // a longer window would silently return a shorter one.
  const days = [7, 28, 90].includes(asked) ? asked : 28;

  try {
    return NextResponse.json(await readPerformance(days));
  } catch (error) {
    // A missing or malformed service account is something to fix on the Keys
    // page, not an upstream failure to retry.
    if (error instanceof SearchConsoleConfigError) {
      return NextResponse.json({ error: error.message, kind: "config" }, { status: 500 });
    }
    return errorResponse(error);
  }
}
