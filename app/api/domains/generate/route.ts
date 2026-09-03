import { NextResponse } from "next/server";

import { errorResponse, requireSession } from "@/lib/api-guard";
import { generateNames } from "@/lib/namegen";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A suggestion call plus a handful of bulk checks, each of up to a hundred.
export const maxDuration = 60;

export async function POST(request: Request) {
  const denied = await requireSession();
  if (denied) return denied;

  let body: { seed?: string; tlds?: string[] };
  try {
    body = (await request.json()) as { seed?: string; tlds?: string[] };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const seed = String(body.seed ?? "").slice(0, 120);
  // Capped here rather than trusted from the browser: each extension multiplies
  // how many names get checked, and the ceiling is what keeps one search from
  // becoming a thousand requests.
  const tlds = (Array.isArray(body.tlds) ? body.tlds : []).slice(0, 8).map(String);

  try {
    return NextResponse.json(await generateNames(seed, tlds));
  } catch (error) {
    // A missing token or an empty seed is something to correct in the form, not
    // an upstream failure to retry.
    const message = error instanceof Error ? error.message : "";
    if (/token is set|at least one extension|word or two/i.test(message)) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    return errorResponse(error);
  }
}
