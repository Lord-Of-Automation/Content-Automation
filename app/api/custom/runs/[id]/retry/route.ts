import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { record } from "@/lib/audit";
import { errorResponse, requirePermission } from "@/lib/api-guard";
import { customRetryRefusal } from "@/lib/customruns";
import { getExecution, retryExecution } from "@/lib/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Starts a custom run again, on the engine whatever RUN_BACKEND says.
 *
 * Again from the beginning: the custom pipeline reuses nothing from the run it
 * follows, so every step is paid for a second time, and the page says so
 * before anybody presses it.
 *
 * Checked the way starting one is — the permission, the site's WordPress
 * login, an engine that knows page types — because a retry is a new run in
 * every way that costs anything.
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
    const run = await getExecution(id);
    if (run.runMode !== "custom") {
      return NextResponse.json(
        { error: `Run ${id} is not a custom run. Resume it from the Runs page.` },
        { status: 400 }
      );
    }
    const refused = await customRetryRefusal(run);
    if (refused) return refused;

    const result = await retryExecution(id);
    await record(
      actor,
      "run-retried",
      `Started custom run #${id} again from the beginning as #${result.id}.`
    );
    return NextResponse.json({ from: id, ...result });
  } catch (error) {
    await record(
      actor,
      "run-retry-failed",
      `Custom run #${id} — ${error instanceof Error ? error.message : "Unknown error."}`
    );
    return errorResponse(error);
  }
}
