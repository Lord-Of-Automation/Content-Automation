import { NextResponse } from "next/server";

import { requireSession } from "@/lib/api-guard";
import { probeBackend, readEvents } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await requireSession();
  if (denied) return denied;

  const store = await probeBackend();

  return NextResponse.json({
    events: await readEvents(200),
    backend: store,
    persistent: store !== "memory",
  });
}
