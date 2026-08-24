import { NextResponse } from "next/server";

import { requireSession } from "@/lib/api-guard";
import { backend, readEvents } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await requireSession();
  if (denied) return denied;

  const store = backend();

  return NextResponse.json({
    events: await readEvents(200),
    backend: store,
    persistent: store !== "memory",
  });
}
