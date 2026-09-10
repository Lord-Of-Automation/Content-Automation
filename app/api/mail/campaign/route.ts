import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { record } from "@/lib/audit";
import { errorResponse, requireSession } from "@/lib/api-guard";
import { startRun } from "@/lib/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Starts a campaign, which is a run like any other.
 *
 * Queued on the engine rather than done here. Writing to twenty publishers is
 * twenty fetches, twenty model calls and twenty documents, which is minutes of
 * work that wants a log, a cost line and a cancel button — none of which a
 * request that has to answer in sixty seconds can offer.
 *
 * Audited on the way past. It ends in email to people who did not ask for it,
 * and that is worth a record of who set it going.
 */
export async function POST(request: Request) {
  const denied = await requireSession();
  if (denied) return denied;

  const session = await auth();
  const actor = session?.user?.name ?? "unknown";

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const targets = Array.isArray(body.targets) ? body.targets : [];

    if (!targets.length) {
      return NextResponse.json({ error: "No publishers were chosen." }, { status: 400 });
    }
    if (!String(body.anchor_text ?? "").trim()) {
      return NextResponse.json({ error: "The anchor text is required." }, { status: 400 });
    }
    if (!String(body.anchor_url ?? "").trim()) {
      return NextResponse.json(
        { error: "The address the anchor links to is required." },
        { status: 400 },
      );
    }

    const started = await startRun({
      mode: "outreach",
      // A campaign has no site of its own; it writes to other people's. The
      // engine knows that and asks for none, but the shared input shape wants
      // the field present.
      website_url: "",
      market: String(body.market ?? "gb"),
      language: String(body.language ?? "en"),
      outreach_targets: targets,
      anchor_text: String(body.anchor_text ?? ""),
      anchor_url: String(body.anchor_url ?? ""),
      article_brief: String(body.article_brief ?? ""),
      mail_subject: String(body.mail_subject ?? ""),
      mail_body: String(body.mail_body ?? ""),
    } as never);

    await record(
      actor,
      "mail-campaign",
      `${targets.length} publisher(s), anchor "${String(body.anchor_text ?? "").slice(0, 60)}"`,
    );

    return NextResponse.json({ id: started.executionId, note: started.note });
  } catch (error) {
    return errorResponse(error);
  }
}
