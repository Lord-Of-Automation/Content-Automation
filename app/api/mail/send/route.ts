import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { record } from "@/lib/audit";
import { errorResponse, requireSession } from "@/lib/api-guard";
import { sendToProspect } from "@/lib/mail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * One message to one prospect.
 *
 * Audited, unlike most of what this console does, because it is the one action
 * here that puts something in front of a person who did not ask for it and
 * cannot be taken back.
 */
export async function POST(request: Request) {
  const denied = await requireSession();
  if (denied) return denied;

  const session = await auth();
  const actor = session?.user?.name ?? "unknown";

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const to = String(body.to ?? "").trim().toLowerCase();
    const subject = String(body.subject ?? "").trim();
    const text = String(body.body ?? "");

    if (!to) return NextResponse.json({ error: "No address was given." }, { status: 400 });
    if (!subject) return NextResponse.json({ error: "A subject is required." }, { status: 400 });
    if (!text.trim()) return NextResponse.json({ error: "The message is empty." }, { status: 400 });

    await sendToProspect({
      to,
      subject,
      body: text,
      domain: String(body.domain ?? "").trim().toLowerCase(),
    });

    await record(actor, "mail-sent", `${to} — ${subject.slice(0, 80)}`);
    return NextResponse.json({ sent: true });
  } catch (error) {
    return errorResponse(error);
  }
}
