import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { record } from "@/lib/audit";
import { errorResponse, requireSession } from "@/lib/api-guard";
import { fetchBuiltSite } from "@/lib/engine";
import {
  cleanPages, getWebsite, removeWebsite, saveWebsite, type Website,
} from "@/lib/websites";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function idOf(value: string): string | null {
  return /^[\w-]{1,64}$/.test(value) ? value : null;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireSession();
  if (denied) return denied;

  const { id } = await params;
  if (!idOf(id)) return NextResponse.json({ error: "Bad id." }, { status: 400 });

  const session = await auth();
  const actor = session?.user?.name ?? "unknown";

  try {
    let site = await getWebsite(id);
    if (!site) return NextResponse.json({ error: "No such website." }, { status: 404 });

    // Same catch-up as the list, so opening a site that is still being written
    // shows the pages that exist rather than an empty editor.
    if (site.status === "building" && site.runId) {
      const built = await fetchBuiltSite(site.runId);
      if (built?.site) {
        const pages = cleanPages(built.site.pages);
        site = {
          ...site,
          tagline: built.site.tagline || site.tagline,
          pages,
          status: built.complete ? (pages.length ? "ready" : "failed") : "building",
          note:
            built.complete && !pages.length
              ? "The run finished without writing any pages."
              : site.note,
          updatedAt: new Date().toISOString(),
          updatedBy: actor,
        };
        await saveWebsite(site);
      }
    }

    return NextResponse.json({ website: site });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * Save an edit.
 *
 * Everything a person can change is content: the site's name and tagline, and
 * each page's title, meta and body. What is not editable here is what the site
 * came from — its brief, its topic and the run that wrote it — because those
 * are the record of how it was made, and rewriting them would leave a site
 * claiming to have been built from something it was not.
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireSession();
  if (denied) return denied;

  const { id } = await params;
  if (!idOf(id)) return NextResponse.json({ error: "Bad id." }, { status: 400 });

  const session = await auth();
  const actor = session?.user?.name ?? "unknown";

  let body: { name?: string; tagline?: string; pages?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  try {
    const site = await getWebsite(id);
    if (!site) return NextResponse.json({ error: "No such website." }, { status: 404 });

    const pages = body.pages === undefined ? site.pages : cleanPages(body.pages);
    if (!pages.length) {
      return NextResponse.json(
        { error: "A website needs at least one page." },
        { status: 400 },
      );
    }

    const updated: Website = {
      ...site,
      name: String(body.name ?? site.name).trim().slice(0, 80) || site.name,
      tagline: String(body.tagline ?? site.tagline).trim().slice(0, 200),
      pages,
      // An edit settles a site that failed to build: whatever the run did, the
      // pages in front of you now are the site.
      status: site.status === "building" ? site.status : "ready",
      updatedAt: new Date().toISOString(),
      updatedBy: actor,
    };

    await saveWebsite(updated);
    await record(actor, "website-edited", `${updated.name}, ${pages.length} page(s)`);

    return NextResponse.json({ website: updated });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireSession();
  if (denied) return denied;

  const { id } = await params;
  if (!idOf(id)) return NextResponse.json({ error: "Bad id." }, { status: 400 });

  const session = await auth();
  const actor = session?.user?.name ?? "unknown";

  try {
    const site = await getWebsite(id);
    if (!site) return NextResponse.json({ error: "No such website." }, { status: 404 });

    await removeWebsite(id);
    // Nothing was hosted, so this destroys writing rather than a live site.
    // Logged all the same: it is the only record it was ever written.
    await record(actor, "website-deleted", `${site.name}, ${site.pages.length} page(s)`);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
