import { NextResponse } from "next/server";

import { errorResponse, requireSession } from "@/lib/api-guard";
import { checkDomains } from "@/lib/availability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Two bulk calls at most, each of up to a hundred names.
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

  // Capped here rather than trusted from the browser: a bare word is checked
  // against every extension chosen, so the list is what decides how many names
  // one request becomes.
  const names = String(body.names ?? "").slice(0, 4000);
  const tlds = (Array.isArray(body.tlds) ? body.tlds : []).slice(0, 12).map(String);

  try {
    return NextResponse.json(await checkDomains(names, tlds));
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
