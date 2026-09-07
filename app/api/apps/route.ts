import { NextResponse } from "next/server";

import { errorResponse, requireSession } from "@/lib/api-guard";
import { CloudwaysConfigError, listApplications } from "@/lib/cloudways";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// One upstream call, but it returns every application on every server and
// Cloudways takes its time about it on a busy account.
export const maxDuration = 60;

export async function GET() {
  const denied = await requireSession();
  if (denied) return denied;

  try {
    return NextResponse.json(await listApplications());
  } catch (error) {
    // A missing or rejected token is something to fix on the Keys page rather
    // than an upstream wobble worth retrying.
    if (error instanceof CloudwaysConfigError) {
      return NextResponse.json({ error: error.message, kind: "config" }, { status: 500 });
    }
    return errorResponse(error);
  }
}
