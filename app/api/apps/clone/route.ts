import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { record } from "@/lib/audit";
import { errorResponse, requireSession } from "@/lib/api-guard";
import { CloudwaysConfigError, cloneApplication } from "@/lib/cloudways";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Reads the estate either side of the copy and waits on a queued operation.
// The copy itself routinely outlives the request, which the caller is told.
export const maxDuration = 90;

/**
 * Copy an application to this server or another one.
 *
 * The gentlest write on the page: the source is read and never altered, so a
 * clone that fails leaves the original as it was. Logged anyway, because a copy
 * of a site is a second site, and on a server already carrying a couple of
 * hundred it is worth knowing where the extra one came from.
 */
export async function POST(request: Request) {
  const denied = await requireSession();
  if (denied) return denied;

  const session = await auth();
  const actor = session?.user?.name ?? "unknown";

  let body: {
    serverId?: string;
    appId?: string;
    label?: string;
    destinationServerId?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const serverId = String(body.serverId ?? "").trim();
  const appId = String(body.appId ?? "").trim();
  if (!serverId || !appId) {
    return NextResponse.json({ error: "Which application?" }, { status: 400 });
  }

  try {
    const result = await cloneApplication(
      serverId,
      appId,
      String(body.label ?? ""),
      String(body.destinationServerId ?? ""),
    );

    await record(
      actor,
      "app-cloned",
      result.app
        ? `${result.label} from application ${appId} onto ${result.serverLabel}, id ${result.app.id}`
        : `${result.label} from application ${appId} onto ${result.serverLabel}, still copying`,
    );

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof CloudwaysConfigError) {
      return NextResponse.json({ error: error.message, kind: "config" }, { status: 500 });
    }
    const message = error instanceof Error ? error.message : "";
    if (/needs a name|too long|can hold letters|No such/i.test(message)) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    return errorResponse(error);
  }
}
