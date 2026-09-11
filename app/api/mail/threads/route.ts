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
    // The conversation, not the address. One publisher can have several, and
    // marking "the one with Ed" paid stopped meaning anything the moment a
    // second article was offered to Ed.
    const thread = String(body.thread ?? "").trim();
    const email = String(body.email ?? "").trim().toLowerCase();
    const paid = body.paid !== false;

    if (!thread) {
      return NextResponse.json({ error: "No conversation was named." }, { status: 400 });
    }

    await setThreadPaid(thread, paid);
    // Logged by who it was with, because a thread id means nothing to anybody
    // reading the activity log a month later.
    await record(actor, paid ? "mail-paid" : "mail-unpaid", email || thread);
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
    const asked = new URL(request.url).searchParams;
    const thread = String(asked.get("thread") ?? "").trim();
    const email = String(asked.get("email") ?? "").trim();
    if (!thread) {
      return NextResponse.json({ error: "No conversation was named." }, { status: 400 });
    }

    await forgetThread(thread);
    await record(actor, "mail-forgotten", email || thread);
    return NextResponse.json({ forgotten: true });
  } catch (error) {
    return errorResponse(error);
  }
}
