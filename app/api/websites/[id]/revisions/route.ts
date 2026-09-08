import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { record } from "@/lib/audit";
import { errorResponse, requireSession } from "@/lib/api-guard";
import {
  getRevision, keepRevision, listRevisions, MAX_REVISIONS, snapshot, summarise,
} from "@/lib/revisions";
import { getWebsite, saveWebsite, type Website } from "@/lib/websites";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function idOf(value: string): string | null {
  return /^[\w-]{1,64}$/.test(value) ? value : null;
}

/**
 * The versions of a site, and optionally one of them in full.
 *
 * The list carries no page content. A site's history is many copies of a site,
 * and sending all of it to draw a list of dates would make opening the tab the
 * most expensive thing in the editor. One revision comes back whole, by name,
 * when there is something to show it in.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireSession();
  if (denied) return denied;

  const { id } = await params;
  if (!idOf(id)) return NextResponse.json({ error: "Bad id." }, { status: 400 });

  try {
    const site = await getWebsite(id);
    if (!site) return NextResponse.json({ error: "No such website." }, { status: 404 });

    const rows = await listRevisions(id);
    const wanted = new URL(request.url).searchParams.get("revision");

    if (wanted) {
      const found = rows.find((r) => r.id === wanted);
      if (!found) return NextResponse.json({ error: "No such version." }, { status: 404 });
      return NextResponse.json({ revision: found });
    }

    // The cap travels with the list. It is a rule about storage that lives in
    // the store, and the editor says it out loud, so it is sent rather than
    // written down twice.
    return NextResponse.json({
      revisions: summarise(rows, snapshot(site)),
      keep: MAX_REVISIONS,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * Go back to a version.
 *
 * Which is a save like any other, so the version being replaced is kept too.
 * Restoring the wrong one is the usual way to lose work with a revision list,
 * and it costs nothing to make that undoable.
 *
 * What comes back is content only. A restored site keeps its own brief, its
 * topic and the run that wrote it, because those record how it was made and no
 * amount of editing changes that.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireSession();
  if (denied) return denied;

  const { id } = await params;
  if (!idOf(id)) return NextResponse.json({ error: "Bad id." }, { status: 400 });

  const session = await auth();
  const actor = session?.user?.name ?? "unknown";

  let body: { revision?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const wanted = String(body.revision ?? "");
  if (!wanted) return NextResponse.json({ error: "Which version?" }, { status: 400 });

  try {
    const site = await getWebsite(id);
    if (!site) return NextResponse.json({ error: "No such website." }, { status: 404 });

    if (site.status === "building") {
      return NextResponse.json(
        { error: "This site is still being written. Restoring now would be overwritten by the build." },
        { status: 409 },
      );
    }

    const found = await getRevision(id, wanted);
    if (!found) return NextResponse.json({ error: "No such version." }, { status: 404 });

    await keepRevision(site, "edit");

    const restored: Website = {
      ...site,
      ...found.body,
      status: "ready",
      updatedAt: new Date().toISOString(),
      updatedBy: actor,
    };

    await saveWebsite(restored);
    await record(
      actor,
      "website-restored",
      `${restored.name} back to ${found.at}, ${restored.pages.length} page(s)`,
    );

    return NextResponse.json({ website: restored });
  } catch (error) {
    return errorResponse(error);
  }
}
