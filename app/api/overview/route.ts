import { NextResponse } from "next/server";

import { errorResponse, requireSession } from "@/lib/api-guard";
import { collectOverview } from "@/lib/overview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Four reads at once, none of them pricing anything. The ceiling is here for
// a slow engine, not because this is expected to take a while.
export const maxDuration = 60;

export async function GET() {
  const denied = await requireSession();
  if (denied) return denied;

  try {
    return NextResponse.json(await collectOverview());
  } catch (error) {
    return errorResponse(error);
  }
}
