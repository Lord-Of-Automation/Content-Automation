import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { record } from "@/lib/audit";
import { errorResponse, requireSession } from "@/lib/api-guard";
import { retryExecution } from "@/lib/n8n";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireSession();
  if (denied) return denied;

  const { id } = await params;

  if (!/^\d+$/.test(id)) {
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
