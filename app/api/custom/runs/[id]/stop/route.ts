import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { record } from "@/lib/audit";
import { errorResponse, requirePermission } from "@/lib/api-guard";
import { isTerminal, stopExecution } from "@/lib/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Stops a custom run, on the engine whatever RUN_BACKEND says.
 *
 * The one control that has to work on a run already spending money, so it
 * does not go through the switch that sent it to n8n, which has never heard of
 * the id and could not stop it.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requirePermission("custom");
  if (denied) return denied;

  const { id } = await params;

  if (!/^[\w.-]{1,64}$/.test(id)) {
    return NextResponse.json({ error: "Bad run id." }, { status: 400 });
  }

  const actor = (await auth())?.user?.name ?? "unknown";

  try {
    const status = await stopExecution(id);
    await record(actor, "run-canceled", `Cancelled custom run #${id}.`);
    return NextResponse.json({ id, status, stopped: isTerminal(status) });
  } catch (error) {
    await record(
      actor,
      "run-cancel-failed",
      `Custom run #${id} — ${error instanceof Error ? error.message : "Unknown error."}`
    );
    return errorResponse(error);
  }
}
