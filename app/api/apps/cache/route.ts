import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { record } from "@/lib/audit";
import { errorResponse, requireSession } from "@/lib/api-guard";
import { CloudwaysConfigError, purgeVarnish } from "@/lib/cloudways";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// One read to name the server, then the purge itself.
export const maxDuration = 60;

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

  let body: { serverId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const serverId = String(body.serverId ?? "").trim();
  if (!serverId) return NextResponse.json({ error: "Which server?" }, { status: 400 });

  try {
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
