import { NextResponse } from "next/server";

import { errorResponse, requireSession } from "@/lib/api-guard";
import { collectSpend } from "@/lib/spend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Pricing walks one fat execution payload per uncached run.
export const maxDuration = 60;

export async function GET(request: Request) {
  const denied = await requireSession();
  if (denied) return denied;

  // Absent is not zero. searchParams.get returns null for a missing "limit",
  // Number(null) is 0, and 0 is finite — so the clamp turned every request that
  // named no limit into a request for exactly one run, and the spend panel
  // showed one run's cost as the whole total. An empty ?limit= did the same.
  // The parameter has to be present and has to be a number.
  const asked = new URL(request.url).searchParams.get("limit")?.trim();
  const raw = asked ? Number(asked) : NaN;
  const limit = Number.isFinite(raw) ? Math.min(Math.max(raw, 1), 50) : 20;

  try {
    return NextResponse.json(await collectSpend(limit));
  } catch (error) {
    return errorResponse(error);
  }
}
