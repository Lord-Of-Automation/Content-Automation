import { NextResponse } from "next/server";

import { errorResponse, requirePermission } from "@/lib/api-guard";
import { getExecution } from "@/lib/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * One custom run, as the Custom page shows it.
 *
 * Straight to the engine, like starting one. Custom runs only ever run there,
 * and the generic /api/runs/[id] goes wherever RUN_BACKEND points — on a
 * deployment still pointed at n8n, that asked n8n about an engine id on every
 * poll and never showed the run at all.
 *
 * A run accepted but still waiting for a slot answers as queued, not as
 * missing. See the engine's GET /runs/:id.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requirePermission("custom");
  if (denied) return denied;

  const { id } = await params;

  // Engine ids are a timestamp and a salt.
  if (!/^[\w.-]{1,64}$/.test(id)) {
    return NextResponse.json({ error: "Bad run id." }, { status: 400 });
  }

  try {
    return NextResponse.json({ execution: await getExecution(id) });
  } catch (error) {
    return errorResponse(error);
  }
}
