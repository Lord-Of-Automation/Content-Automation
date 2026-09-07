import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { record } from "@/lib/audit";
import { errorResponse, requireSession } from "@/lib/api-guard";
import { CloudwaysConfigError, purgeAllVarnish, purgeVarnish } from "@/lib/cloudways";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// One read to name the servers, then a purge each. Sequential, so the whole
// estate needs more room than a single server did.
export const maxDuration = 90;

/**
 * Clearing the Varnish cache on a server.
 *
 * Takes a server rather than an application because that is all Cloudways
 * offers. Logged even though it is harmless: on a server carrying a couple of
 * hundred sites, every one of them serves cold for a minute afterwards, and if
 * somebody is looking at a traffic graph wondering why, this is the answer.
 */
export async function POST(request: Request) {
  const denied = await requireSession();
  if (denied) return denied;

  const session = await auth();
  const actor = session?.user?.name ?? "unknown";

  let body: { serverId?: string; all?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const serverId = String(body.serverId ?? "").trim();
  if (!serverId && !body.all) {
    return NextResponse.json({ error: "Which server?" }, { status: 400 });
  }

  try {
    // Every server, for the button that clears the whole estate. Reported per
    // server, because one refusing while the others go through is a real
    // outcome and "it failed" would be the wrong summary of it.
    if (body.all) {
      const all = await purgeAllVarnish();
      const failed = all.servers.filter((s) => !s.ok);
      await record(
        actor,
        "app-cache-purged",
        `Varnish across ${all.servers.length - failed.length} of ${all.servers.length} ` +
          `servers, ${all.apps} applications` +
          (failed.length ? `; refused by ${failed.map((s) => s.label).join(", ")}` : ""),
      );
      return NextResponse.json(all);
    }

    const result = await purgeVarnish(serverId);
    await record(
      actor,
      "app-cache-purged",
      `Varnish on ${result.serverLabel}, shared by ${result.apps} application` +
        `${result.apps === 1 ? "" : "s"}`,
    );
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof CloudwaysConfigError) {
      return NextResponse.json({ error: error.message, kind: "config" }, { status: 500 });
    }
    const message = error instanceof Error ? error.message : "";
    if (/No such server/i.test(message)) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    return errorResponse(error);
  }
}
