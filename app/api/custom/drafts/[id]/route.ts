import { NextResponse } from "next/server";

import { errorResponse, requirePermission } from "@/lib/api-guard";
import {
  ENGINE_OUTDATED,
  PageTypeEngineError,
  getDesignDraft,
  isEngineOutdated,
} from "@/lib/pagetypes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * What a design run has drafted so far.
 *
 * Asked every few seconds while the run goes, and once more when somebody
 * reopens a finished one. The draft is only ever handed back here: nothing is
 * saved until a person has read it and pressed Save.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requirePermission("custom");
  if (denied) return denied;

  const { id } = await params;

  // Engine ids are a timestamp and a salt.
  if (!/^[\w.-]{1,64}$/.test(id)) {
    return NextResponse.json({ error: "Bad run id." }, { status: 400 });
  }

  try {
    return NextResponse.json(await getDesignDraft(id));
  } catch (error) {
    if (isEngineOutdated(error)) {
      return NextResponse.json({ error: ENGINE_OUTDATED, kind: "engine-outdated" }, { status: 409 });
    }
    // Gone, not visible to this person, or not a design run. The page stops
    // asking either way, so it is told plainly rather than as a gateway error.
    if (error instanceof PageTypeEngineError && error.status === 404) {
      return NextResponse.json({ error: error.message, kind: "not-found" }, { status: 404 });
    }
    return errorResponse(error);
  }
}
