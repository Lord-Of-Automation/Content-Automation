import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { record } from "@/lib/audit";
import { errorResponse, requireSession } from "@/lib/api-guard";
import { CloudwaysConfigError, setPrimaryDomain } from "@/lib/cloudways";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A read to check the application, the write, a wait on the queued operation,
// then a read back to see whether it took. None of that is quick.
export const maxDuration = 90;

/**
 * Changing what an application answers to.
 *
 * The most destructive thing this console can do. A wrong name server can be
 * put back; a primary domain changed under a live WordPress site can leave it
 * redirecting to an address that no longer serves it, which looks like the site
 * has gone. So the previous value goes into the audit trail before anything
 * else, and the response says what the application actually reports afterwards
 * rather than that the request was accepted.
 */
export async function PUT(request: Request) {
  const denied = await requireSession();
  if (denied) return denied;

  const session = await auth();
  const actor = session?.user?.name ?? "unknown";

  let body: { serverId?: string; appId?: string; domain?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const serverId = String(body.serverId ?? "").trim();
  const appId = String(body.appId ?? "").trim();
  const domain = String(body.domain ?? "").trim();

  if (!serverId || !appId) {
    return NextResponse.json({ error: "Which application?" }, { status: 400 });
  }

  try {
    const result = await setPrimaryDomain(serverId, appId, domain);

    // Recorded whichever way it went. A change that was accepted and did not
    // take is the one worth being able to find later, and it is exactly the
    // one that would go unlogged if only successes were written down.
    await record(
      actor,
      "app-domain-changed",
      result.changed
        ? `application ${appId}: ${result.before || "no domain"} → ${result.now}`
        : `application ${appId}: asked for ${result.requested}, still reads ` +
          `${result.now || "no domain"}`,
    );

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof CloudwaysConfigError) {
      return NextResponse.json({ error: error.message, kind: "config" }, { status: 500 });
    }
    const message = error instanceof Error ? error.message : "";
    // A rejected value is something to correct in the form rather than an
    // upstream failure worth retrying.
    if (/not a domain|No such application|already the primary/i.test(message)) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    return errorResponse(error);
  }
}
