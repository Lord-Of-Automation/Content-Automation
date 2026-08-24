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

  const raw = Number(new URL(request.url).searchParams.get("limit"));
  const limit = Number.isFinite(raw) ? Math.min(Math.max(raw, 1), 50) : 20;

  try {
    return NextResponse.json(await collectSpend(limit));
  } catch (error) {
    return errorResponse(error);
  }
}
