/**
 * What has to be true before a custom run starts, or starts again.
 *
 * Said in one place because three routes ask it: starting a run from the
 * Custom page, starting one again from there, and starting one again from the
 * Runs page, which lists every run whatever its kind. The last was the gap:
 * it only asked for a session, so somebody refused the Custom page could still
 * start a custom run by pressing Resume on an old one.
 *
 * Server only.
 */

import { NextResponse } from "next/server";

import { requirePermission } from "./api-guard";
import type { ExecutionDetail } from "./n8n";
import { ENGINE_OUTDATED, listPageTypes } from "./pagetypes";
import { credentialsFor, normaliseDomain } from "./sites";

/**
 * Why a run that ends by writing to this site cannot start, or null.
 *
 * Asked before the run rather than left to the engine, which would find out
 * only after it had paid for the page.
 */
export async function wordPressMissing(websiteUrl: string): Promise<string | null> {
  if (await credentialsFor(websiteUrl)) return null;
  return (
    `No WordPress login is saved for ${normaliseDomain(websiteUrl) ?? "this site"}. ` +
    "Add one on the Website Accounts page first."
  );
}

/** The answer for an engine that predates page types. */
export function engineOutdated(): NextResponse {
  return NextResponse.json({ error: ENGINE_OUTDATED, kind: "engine-outdated" }, { status: 409 });
}

/**
 * Why this custom run may not be started again, as the response to send, or
 * null when it may.
 *
 * The permission first, in the words every custom route uses. Then the run
 * itself: a design run has no page to start again from, and an add or optimise
 * run needs the site's WordPress login as much the second time as the first.
 * Then the engine, because one from before page types would take the run for
 * the optimiser and rewrite the page instead.
 */
export async function customRetryRefusal(run: ExecutionDetail): Promise<NextResponse | null> {
  const denied = await requirePermission("custom");
  if (denied) return denied;

  const action = run.inputs?.custom?.action;
  if (action === "design") {
    return NextResponse.json(
      {
        error:
          "A run that drafted a page type cannot be started again. Draft again from Create from examples.",
      },
      { status: 400 },
    );
  }

  const website = run.inputs?.website_url ?? "";
  if (!website) {
    return NextResponse.json(
      { error: `Run ${run.id} has no recorded input to start again from.` },
      { status: 400 },
    );
  }
  const missing = await wordPressMissing(website);
  if (missing) return NextResponse.json({ error: missing }, { status: 400 });

  const { engineReady } = await listPageTypes();
  if (!engineReady) return engineOutdated();

  return null;
}
