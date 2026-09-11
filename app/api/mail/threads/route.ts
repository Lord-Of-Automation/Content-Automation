import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { record } from "@/lib/audit";
import { errorResponse, requireSession } from "@/lib/api-guard";
import { forgetThread, mailThreads, setThreadPaid } from "@/lib/mail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Every conversation is a call to Gmail on the engine's side, so a dozen of
// them takes longer than a page usually waits for.
export const maxDuration = 60;

/**
 * The conversations this platform started, and nothing else.
 *
 * The narrowing happens on the engine, which reads threads by an id it wrote
 * down when it sent the first message. A conversation it did not start has no
 * id in that list, so it is unreachable rather than merely unrequested.
 */
export async function GET() {
  const denied = await requireSession();
  if (denied) return denied;

  try {
    return NextResponse.json(await mailThreads());
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * Marking one paid, or putting it back.
 *
 * Audited like the sending is. It is the record of money having changed hands,
 * which is the kind of thing worth being able to say who set and when.
 */
export async function POST(request: Request) {
  const denied = await requireSession();
  if (denied) return denied;

  const session = await auth();
  const actor = session?.user?.name ?? "unknown";

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const email = String(body.email ?? "").trim().toLowerCase();
    const paid = body.paid !== false;

    if (!email) return NextResponse.json({ error: "No address was given." }, { status: 400 });

    await setThreadPaid(email, paid);
    await record(actor, paid ? "mail-paid" : "mail-unpaid", email);
    return NextResponse.json({ paid });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Forgetting one, which also makes it unreadable. */
export async function DELETE(request: Request) {
  const denied = await requireSession();
  if (denied) return denied;

  const session = await auth();
  const actor = session?.user?.name ?? "unknown";

  try {
    const email = String(new URL(request.url).searchParams.get("email") ?? "").trim();
    if (!email) return NextResponse.json({ error: "No address was given." }, { status: 400 });

    await forgetThread(email);
    await record(actor, "mail-forgotten", email);
    return NextResponse.json({ forgotten: true });
  } catch (error) {
    return errorResponse(error);
  }
}
