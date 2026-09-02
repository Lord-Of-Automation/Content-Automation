import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { record } from "@/lib/audit";
import { errorResponse, requireSession } from "@/lib/api-guard";
import { deleteSchedule, runScheduleNow } from "@/lib/schedules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireSession();
  if (denied) return denied;

  const { id } = await params;
  const session = await auth();
  const actor = session?.user?.name ?? "unknown";

  try {
    await deleteSchedule(id);
    await record(actor, "schedule-deleted", `Loop ${id}.`);
    return NextResponse.json({ deleted: id });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * Fires a loop now.
 *
 * It does not move when the loop next fires on its own: this is a way to find
 * out whether a schedule works without waiting until three in the morning to
 * discover it does not.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireSession();
  if (denied) return denied;

  const { id } = await params;
  const session = await auth();
  const actor = session?.user?.name ?? "unknown";

  try {
    const started = await runScheduleNow(id);
    // The same shape the runs route records, so the log's cost column and the
    // spend report find this run the way they find any other.
    await record(actor, "run-started", `Loop ${id}, started by hand → execution #${started.id}`);
    return NextResponse.json(started);
  } catch (error) {
    return errorResponse(error);
  }
}
