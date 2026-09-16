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
  if (error instanceof PageTypeEngineError && (error.status === 400 || error.status === 404)) {
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
    const saved = await savePageType(body, actor);
    const id = saved.pageType?.id ?? "";
    await record(
      actor,
      "pagetype-saved",
      `${saved.pageType?.name ?? body.name}${id ? ` (${id})` : ""}` +
        (body.id ? "" : ", new"),
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

  const id = String(new URL(request.url).searchParams.get("id") ?? "").trim();
  if (!id) {
    return NextResponse.json({ error: "No page type was named." }, { status: 400 });
  }

  try {
    const pageTypes = await deletePageType(id);
    await record(actor, "pagetype-deleted", id);
    return NextResponse.json({ pageTypes });
  } catch (error) {
    return refused(error) ?? errorResponse(error);
  }
}
