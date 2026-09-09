import { NextResponse } from "next/server";

import { errorResponse, requireSession } from "@/lib/api-guard";
import { searchDomain } from "@/lib/availability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// One bulk call: the name asked for and the alternatives travel together.
export const maxDuration = 60;

export async function POST(request: Request) {
  const denied = await requireSession();
  if (denied) return denied;

  let body: { names?: string; tlds?: string[] };
  try {
    body = (await request.json()) as { names?: string; tlds?: string[] };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const names = String(body.names ?? "").slice(0, 2000);
  // Capped here rather than trusted from the browser: the list is what decides
  // how many alternatives one search becomes.
  const tlds = (Array.isArray(body.tlds) ? body.tlds : []).slice(0, 14).map(String);

  try {
    return NextResponse.json(await searchDomain(names, tlds));
  } catch (error) {
    // A missing token or an empty box is something to correct in the form, not
    // an upstream failure to retry.
    const message = error instanceof Error ? error.message : "";
    if (/token is set|Type a domain/i.test(message)) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    return errorResponse(error);
  }
}
