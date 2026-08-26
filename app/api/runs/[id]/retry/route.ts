import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { record } from "@/lib/audit";
import { errorResponse, requireSession } from "@/lib/api-guard";
import { retryExecution } from "@/lib/backend";

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
    const result = await retryExecution(id);
    await record(
      actor,
      "run-retried",
      `Resumed execution #${id}` +
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
