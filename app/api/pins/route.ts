import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { record } from "@/lib/audit";
import { errorResponse, requireSession } from "@/lib/api-guard";
import { listPins, pinStep, unpinStep } from "@/lib/pins";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
  const denied = await requireSession();
  if (denied) return denied;
  try {
    return NextResponse.json({ pins: await listPins() });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * Pins what a step returned on a run.
 *
 * Recorded in the activity log like any other change to how runs behave. A pin
 * makes a step stop doing its work, which is the kind of thing that should not
 * be discoverable only by wondering why the output stopped changing.
 */
export async function POST(request: Request) {
  const denied = await requireSession();
  if (denied) return denied;

  const session = await auth();
  const actor = session?.user?.name ?? "unknown";

  try {
    const body = (await request.json()) as { run?: string; step?: string };
    const pin = await pinStep(String(body.run ?? ""), String(body.step ?? ""));
    await record(actor, "step-pinned", `${pin.step} — from execution #${pin.fromRun}`);
    return NextResponse.json({ pin });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  const denied = await requireSession();
  if (denied) return denied;

  const session = await auth();
  const actor = session?.user?.name ?? "unknown";

  try {
    const body = (await request.json()) as { step?: string };
    const step = String(body.step ?? "");
    await unpinStep(step);
    await record(actor, "step-unpinned", step);
    return NextResponse.json({ unpinned: step });
  } catch (error) {
    return errorResponse(error);
  }
}
