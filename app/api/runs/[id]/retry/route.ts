import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { record } from "@/lib/audit";
import { errorResponse, requireSession } from "@/lib/api-guard";
import { backend, retryExecution } from "@/lib/backend";
import { customRetryRefusal } from "@/lib/customruns";
import { getExecution as engineExecution } from "@/lib/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireSession();
  if (denied) return denied;

  const { id } = await params;

  // n8n ids are numeric; engine ids are a timestamp and a salt.
  if (!/^[\w.-]{1,64}$/.test(id)) {
    return NextResponse.json({ error: "Bad execution id." }, { status: 400 });
  }

  const session = await auth();
  const actor = session?.user?.name ?? "unknown";

  try {
    /*
     * A custom run answers to the Custom page's rules even when it is started
     * again from here. The Runs page lists every run whatever its kind, and
     * this route asked only for a session, so somebody refused Custom page
     * types could still start one — a paid run that rewrites or publishes a
     * page — by pressing Resume on an old one. Only the engine has custom runs.
     */
    let custom = false;
    if (backend() === "engine") {
      const run = await engineExecution(id);
      if (run.runMode === "custom") {
        custom = true;
        const refused = await customRetryRefusal(run);
        if (refused) return refused;
      }
    }

    const result = await retryExecution(id);
    await record(
      actor,
      "run-retried",
      custom
        ? `Started custom run #${id} again from the beginning` +
            (result.id !== id ? ` as #${result.id}.` : ".")
        : `Resumed execution #${id}` +
            (result.id !== id ? ` as #${result.id}` : "") +
            " from where it failed."
    );
    return NextResponse.json({ from: id, ...result });
  } catch (error) {
    await record(
      actor,
      "run-retry-failed",
      `Execution #${id} — ${
        error instanceof Error ? error.message : "Unknown error."
      }`
    );
    return errorResponse(error);
  }
}
