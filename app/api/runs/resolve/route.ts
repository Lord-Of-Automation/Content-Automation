import { NextResponse } from "next/server";

import { errorResponse, requireSession } from "@/lib/api-guard";
import { findExecutionStartedAfter } from "@/lib/backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Fallback path for when the trigger did not return an execution id: given the
 * moment we posted, find the run n8n created. Only needed in form mode or on an
 * unpatched webhook.
 */
export async function POST(request: Request) {
  const denied = await requireSession();
  if (denied) return denied;

  let body: { startedAt?: unknown };
  try {
    body = (await request.json()) as { startedAt?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const startedAt = typeof body.startedAt === "string" ? body.startedAt : null;
  if (!startedAt || Number.isNaN(new Date(startedAt).getTime())) {
    return NextResponse.json(
      { error: "startedAt must be an ISO timestamp." },
      { status: 400 }
    );
  }

  try {
    const execution = await findExecutionStartedAfter(startedAt);
    return NextResponse.json({ execution });
  } catch (error) {
    return errorResponse(error);
  }
}
