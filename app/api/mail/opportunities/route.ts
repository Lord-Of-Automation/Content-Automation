import { NextResponse } from "next/server";

import { errorResponse, requireSession } from "@/lib/api-guard";
import { mailOpportunities } from "@/lib/mail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Every row of the prospects sheet, unfiltered.
 *
 * Filtered in the browser rather than here, deliberately: the numbers come back
 * once and the person moves the sliders twenty times, and a round trip per
 * adjustment would make a filter over a spreadsheet feel like one.
 */
export async function GET(request: Request) {
  const denied = await requireSession();
  if (denied) return denied;

  const asked = new URL(request.url).searchParams;
  try {
    return NextResponse.json(
      await mailOpportunities(asked.get("sheet") ?? "", asked.get("tab") ?? ""),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
