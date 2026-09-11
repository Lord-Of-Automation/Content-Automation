import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { record } from "@/lib/audit";
import { errorResponse, requireSession } from "@/lib/api-guard";
import { replyToThread, type ReplyPicture } from "@/lib/mail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Sending reads the thread first, to find the message being answered, so this
// is two calls to Gmail rather than one.
export const maxDuration = 60;

/**
 * Answering a publisher.
 *
 * The browser says which conversation and what to say, and nothing else. Who
 * it goes out as, which thread it lands in and what it threads onto all come
 * off the record the engine kept when it sent the first message — a page that
 * could name its own sender could send as anybody this console can send as.
 *
 * Audited for the reason every send here is: a message that has reached a
 * person cannot be taken back, so who sent it and to whom is worth keeping.
 */
export async function POST(request: Request) {
  const denied = await requireSession();
  if (denied) return denied;

  const session = await auth();
  const actor = session?.user?.name ?? "unknown";

  try {
    const payload = (await request.json()) as Record<string, unknown>;
    const thread = String(payload.thread ?? "").trim();
    const email = String(payload.email ?? "").trim().toLowerCase();
    const body = String(payload.body ?? "").trim();

    /*
     * The pictures, carried through and not inspected.
     *
     * The engine checks them, because the engine is what turns them into a
     * message and is therefore the only place that can say what a message will
     * accept. Two sets of rules would disagree the first time one of them
     * changed, and the one that matters is the one nearest the bytes.
     */
    const images = Array.isArray(payload.images) ? (payload.images as ReplyPicture[]) : [];

    if (!thread) {
      return NextResponse.json({ error: "No conversation was named." }, { status: 400 });
    }
    if (!body && !images.length) {
      return NextResponse.json(
        { error: "An empty reply would say nothing." },
        { status: 400 },
      );
    }

    const sent = await replyToThread(thread, body, images);
    // The words themselves are not recorded. The log says a message went and
    // to whom, which is what it is for; the conversation is in the mailbox.
    await record(
      actor,
      "mail-replied",
      images.length
        ? `${email || thread} (${images.length} picture${images.length === 1 ? "" : "s"})`
        : email || thread,
    );
    return NextResponse.json(sent);
  } catch (error) {
    return errorResponse(error);
  }
}
