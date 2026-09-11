import { NextResponse } from "next/server";

import { errorResponse, requireSession } from "@/lib/api-guard";
import { mailCampaigns } from "@/lib/mail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Every campaign that has run, newest first.
 *
 * Read out of the engine's run records rather than kept a second time. A
 * campaign is a run, so its history is the runs that were campaigns, and a
 * separate list would be a second account of the same thing, free to disagree
 * with the first.
 */
export async function GET() {
  const denied = await requireSession();
  if (denied) return denied;

  try {
    return NextResponse.json({ campaigns: await mailCampaigns() });
  } catch (error) {
    return errorResponse(error);
  }
}
