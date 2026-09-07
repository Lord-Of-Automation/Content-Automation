import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { record } from "@/lib/audit";
import { errorResponse, requireSession } from "@/lib/api-guard";
import {
  CloudwaysConfigError, createApplication, deleteApplication, listApplications,
  listInstallable,
} from "@/lib/cloudways";
import { HostingerConfigError, deleteHostingerSite } from "@/lib/hostinger";
import { listAllApplications } from "@/lib/hosting";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// One upstream call, but it returns every application on every server and
// Cloudways takes its time about it on a busy account. The create below reads
// the estate twice more and waits on a queued build, so it needs the headroom.
export const maxDuration = 90;

export async function GET(request: Request) {
  const denied = await requireSession();
  if (denied) return denied;

  try {
    // The catalogue is what a create form offers. Asked separately so the
    // table's own load does not pay for a call it has no use for.
    if (new URL(request.url).searchParams.get("catalogue")) {
      const [installable, estate] = await Promise.all([
        listInstallable(),
        listApplications(),
      ]);
      return NextResponse.json({ installable, servers: estate.servers });
    }

    // Every host, merged. One failing leaves a row in `sources` saying so
    // rather than emptying a page that is mostly about the other.
    return NextResponse.json(await listAllApplications());
  } catch (error) {
    // A missing or rejected token is something to fix on the Keys page rather
    // than an upstream wobble worth retrying.
    if (error instanceof CloudwaysConfigError || error instanceof HostingerConfigError) {
      return NextResponse.json({ error: error.message, kind: "config" }, { status: 500 });
    }
    return errorResponse(error);
  }
}

/**
 * Install a new application.
 *
 * Far gentler than the domain change next door: nothing existing is touched,
 * Cloudways bills per server rather than per application, and a mistake can be
 * deleted. It is still logged, because it puts a site on a server that may
 * already be carrying a couple of hundred.
 */
export async function POST(request: Request) {
  const denied = await requireSession();
  if (denied) return denied;

  const session = await auth();
  const actor = session?.user?.name ?? "unknown";

  let body: { serverId?: string; application?: string; version?: string; label?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const serverId = String(body.serverId ?? "").trim();
  if (!serverId) return NextResponse.json({ error: "Which server?" }, { status: 400 });

  try {
    const result = await createApplication(
      serverId,
      String(body.application ?? "").trim(),
      String(body.version ?? "").trim(),
      String(body.label ?? ""),
    );

    await record(
      actor,
      "app-created",
      result.app
        ? `${result.label} (${body.application}) on ${result.serverLabel}, id ${result.app.id}`
        : `${result.label} (${body.application}) on ${result.serverLabel}, still building`,
    );

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof CloudwaysConfigError) {
      return NextResponse.json({ error: error.message, kind: "config" }, { status: 500 });
    }
    const message = error instanceof Error ? error.message : "";
    // A rejected value belongs in the form, not in a retry.
    if (/needs a name|too long|can hold letters|does not offer|No such server/i.test(message)) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    return errorResponse(error);
  }
}

/**
 * Destroy an application.
 *
 * The name is sent with the request and checked again in lib/cloudways.ts
 * against what that application is actually called, so a page left open while
 * the estate changed underneath it cannot delete a different site than the one
 * on screen. The guard lives there rather than here because it must not be
 * skippable by calling this route directly.
 */
export async function DELETE(request: Request) {
  const denied = await requireSession();
  if (denied) return denied;

  const session = await auth();
  const actor = session?.user?.name ?? "unknown";

  let body: {
    host?: string;
    serverId?: string;
    appId?: string;
    confirm?: string;
    accountIndex?: number;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const host = String(body.host ?? "cloudways");
  const appId = String(body.appId ?? "").trim();
  if (!appId) {
    return NextResponse.json({ error: "Which application?" }, { status: 400 });
  }

  try {
    // Hostinger addresses a site by its domain and offers no read of one, so
    // there is nothing to compare a typed name against beyond the domain
    // itself. The check still happens, in lib/hostinger.ts, where calling this
    // route directly cannot skip it.
    if (host === "hostinger") {
      await deleteHostingerSite(
        Number(body.accountIndex ?? 0),
        appId,
        String(body.confirm ?? ""),
      );
      await record(actor, "app-deleted", `${appId} from Hostinger`);
      return NextResponse.json({ label: appId, serverLabel: "Hostinger", gone: true });
    }

    const serverId = String(body.serverId ?? "").trim();
    if (!serverId) {
      return NextResponse.json({ error: "Which server?" }, { status: 400 });
    }

    const result = await deleteApplication(serverId, appId, String(body.confirm ?? ""));

    // The only record that this site ever existed, once the files are gone.
    await record(
      actor,
      "app-deleted",
      result.gone
        ? `${result.label} (id ${appId}) from ${result.serverLabel}`
        : `${result.label} (id ${appId}) from ${result.serverLabel}, still removing`,
    );

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof CloudwaysConfigError || error instanceof HostingerConfigError) {
      return NextResponse.json({ error: error.message, kind: "config" }, { status: 500 });
    }
    const message = error instanceof Error ? error.message : "";
    if (/No such application|exactly to confirm|no longer configured/i.test(message)) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    return errorResponse(error);
  }
}
