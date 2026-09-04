import { NextResponse } from "next/server";

import { errorResponse, requireSession } from "@/lib/api-guard";
import { GoogleOAuthError } from "@/lib/googleoauth";
import { checkWindow, readPerformance, SearchConsoleConfigError } from "@/lib/searchconsole";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A token, a property listing, then one query per property in small batches.
export const maxDuration = 90;

export async function GET(request: Request) {
  const denied = await requireSession();
  if (denied) return denied;

  const params = new URL(request.url).searchParams;
  const start = params.get("start") ?? "";
  const end = params.get("end") ?? "";

  // A range somebody typed is checked before it reaches Google, because Search
  // Console answers an impossible window with plausible-looking numbers rather
  // than an error.
  if (start || end) {
    const problem = checkWindow(start, end);
    if (problem) return NextResponse.json({ error: problem }, { status: 400 });
  }

  const asked = Number(params.get("days"));
  const days = [7, 28, 90].includes(asked) ? asked : 28;

  try {
    return NextResponse.json(
      await readPerformance(days, start && end ? { startDate: start, endDate: end } : undefined),
    );
  } catch (error) {
    // A missing or malformed service account is something to fix on the Keys
    // page, not an upstream failure to retry.
    if (error instanceof SearchConsoleConfigError || error instanceof GoogleOAuthError) {
      return NextResponse.json({ error: error.message, kind: "config" }, { status: 500 });
    }
    return errorResponse(error);
  }
}
