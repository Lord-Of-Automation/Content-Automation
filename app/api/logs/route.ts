import { NextResponse } from "next/server";

import { requireSession } from "@/lib/api-guard";
import { probeBackend, readEvents } from "@/lib/audit";
import { executionIdFrom, priceRuns } from "@/lib/spend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Pricing a run that has never been priced walks its whole payload once. After
// that it is a cached read, so only the first call after a run ends is slow.
export const maxDuration = 60;

/**
 * How many of the newest run entries get a price.
 *
 * The log holds 200 events and shows 25 at a time. Pricing all of them on a
 * cold cache would be 200 payload walks for rows nobody has scrolled to, so
 * this covers the first few pages and the rest fill in as they are cached by
 * the spend report or by later visits.
 */
const PRICE_NEWEST = 60;

export async function GET() {
  const denied = await requireSession();
  if (denied) return denied;

  const [store, events] = await Promise.all([probeBackend(), readEvents(200)]);

  const ids: string[] = [];
  for (const event of events) {
    if (!event.action.startsWith("run-")) continue;
    const id = executionIdFrom(event.detail);
    if (id) ids.push(id);
    if (ids.length >= PRICE_NEWEST) break;
  }

  // Never fatal. The log is a record of who did what, and it is worth showing
  // without prices if pricing is what broke.
  const costs = await priceRuns(ids).catch(() => ({}));

  return NextResponse.json({
    events,
    backend: store,
    persistent: store !== "memory",
    costs,
  });
}
