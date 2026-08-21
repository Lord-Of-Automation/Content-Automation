import { NextResponse } from "next/server";

import { requireSession } from "@/lib/api-guard";
import { isPersistent, readEvents } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await requireSession();
  if (denied) return denied;

  return NextResponse.json({
    events: readEvents(200),
    persistent: isPersistent(),
  });
}
