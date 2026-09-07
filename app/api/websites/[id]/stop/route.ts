import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { record } from "@/lib/audit";
import { errorResponse, requireSession } from "@/lib/api-guard";
import { fetchBuiltSite, stopExecution } from "@/lib/engine";
import { getWebsite, saveWebsite, settleFrom } from "@/lib/websites";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Stop a build that is still writing.
 *
 * Stopping is cooperative in the engine: the run finishes the page it is on and
 * then stops between steps rather than being killed mid-call. So this settles
 * the record afterwards rather than assuming, and keeps whatever was written —
 * three of five pages is three real pages, and discarding them because the
 * fourth never came would throw away work that was paid for.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireSession();
  if (denied) return denied;

  const { id } = await params;
  if (!/^[\w-]{1,64}$/.test(id)) {
    return NextResponse.json({ error: "Bad id." }, { status: 400 });
  }

  const session = await auth();
  const actor = session?.user?.name ?? "unknown";

  try {
    const site = await getWebsite(id);
    if (!site) return NextResponse.json({ error: "No such website." }, { status: 404 });

    if (site.status !== "building") {
      return NextResponse.json(
        { error: "That website is not being written." },
        { status: 400 },
      );
    }
    if (!site.runId) {
      return NextResponse.json(
        { error: "That website has no run to stop." },
        { status: 400 },
      );
    }

    await stopExecution(site.runId);
    await record(actor, "run-canceled", `Stopped the build of ${site.name}.`);

    // Read back rather than assumed. The engine stops between steps, so the
    // page in progress may still have landed by the time this asks.
    const settled = settleFrom(site, await fetchBuiltSite(site.runId), actor);
    await saveWebsite(settled);

    return NextResponse.json({ website: settled });
  } catch (error) {
    return errorResponse(error);
  }
}
