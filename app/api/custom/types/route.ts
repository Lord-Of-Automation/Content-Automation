import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { record } from "@/lib/audit";
import { errorResponse, requirePermission } from "@/lib/api-guard";
import {
  ENGINE_OUTDATED,
  PageTypeEngineError,
  deletePageType,
  isEngineOutdated,
  listPageTypes,
  savePageType,
  type PageType,
} from "@/lib/pagetypes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Page types, kept on the engine.
 *
 * Nothing is checked here beyond there being something to save. The engine
 * reads these when a run starts and is the only thing that can say what it
 * will accept, so its refusal is passed back as the person's to fix — a 400
 * with its own words — rather than folded into a gateway error.
 *
 * Audited, because a type decides how every page written under it reads, and
 * "when did these start saying that" is asked long after the edit.
 */

/**
 * A refusal the engine meant for the person, kept at the status it was given.
 *
 * Except the one that is not about the type at all: an engine without these
 * routes answers 404 to every one of them, and "No route for PUT" read as a
 * missing type would send somebody looking for the wrong problem.
 */
function refused(error: unknown): NextResponse | null {
  if (isEngineOutdated(error)) {
    return NextResponse.json({ error: ENGINE_OUTDATED, kind: "engine-outdated" }, { status: 409 });
  }
  // 409 is the engine asking whose type was meant, when two people keep one
  // with the same id and the request did not say.
  if (
    error instanceof PageTypeEngineError &&
    (error.status === 400 || error.status === 404 || error.status === 409)
  ) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  return null;
}

export async function GET() {
  const denied = await requirePermission("custom");
  if (denied) return denied;

  try {
    return NextResponse.json(await listPageTypes());
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request) {
  const denied = await requirePermission("custom");
  if (denied) return denied;

  const actor = (await auth())?.user?.name ?? "unknown";

  let body: Partial<PageType>;
  try {
    body = (await request.json()) as Partial<PageType>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "No page type was given." }, { status: 400 });
  }
  if (!String(body.name ?? "").trim()) {
    return NextResponse.json({ error: "A page type needs a name." }, { status: 400 });
  }

  try {
    const asked = String(body.id ?? "").trim();
    const saved = await savePageType(body, actor);
    const type = saved.pageType;
    const id = type?.id ?? "";
    const owner = String(type?.owner ?? "");
    /*
     * New by what the engine did, not by what was asked. An edit of an id its
     * owner no longer keeps comes back as a new type under an id of its own,
     * and a type made just now carries the same moment as made and changed.
     */
    const wasNew =
      !asked || id !== asked || Boolean(type?.createdAt && type.createdAt === type.updatedAt);
    await record(
      actor,
      "pagetype-saved",
      `${type?.name ?? body.name}${id ? ` (${id})` : ""}` +
        `, ${owner ? `${owner}'s` : "nobody's"}` +
        (wasNew ? ", new" : ""),
    );
    return NextResponse.json(saved);
  } catch (error) {
    return refused(error) ?? errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  const denied = await requirePermission("custom");
  if (denied) return denied;

  const actor = (await auth())?.user?.name ?? "unknown";

  const query = new URL(request.url).searchParams;
  const id = String(query.get("id") ?? "").trim();
  if (!id) {
    return NextResponse.json({ error: "No page type was named." }, { status: 400 });
  }
  // Whose. Present, even empty, means exactly that owner's type; absent leaves
  // the engine to take the caller's own. See lib/pagetypes.ts.
  const owner = query.has("owner") ? String(query.get("owner") ?? "").trim().toLowerCase() : null;

  try {
    const pageTypes = await deletePageType(id, owner);
    await record(
      actor,
      "pagetype-deleted",
      owner === null ? id : `${id}, ${owner ? `${owner}'s` : "nobody's"}`,
    );
    return NextResponse.json({ pageTypes });
  } catch (error) {
    return refused(error) ?? errorResponse(error);
  }
}
