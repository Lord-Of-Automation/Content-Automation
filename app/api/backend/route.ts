import { NextResponse } from "next/server";

import { requireSession } from "@/lib/api-guard";
import { backend } from "@/lib/backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Which backend this deployment is actually using, and whether it can reach it.
 *
 * Vercel bakes environment variables in at build time, so setting RUN_BACKEND
 * and not redeploying leaves the old value live with nothing to indicate it.
 * This exists so that is a five second check rather than a guess.
 *
 * No secrets are returned: the token is reported only as present or absent.
 */
export async function GET() {
  const denied = await requireSession();
  if (denied) return denied;

  const which = backend();
  const engineUrl = process.env.ENGINE_URL?.trim() ?? "";
  const hasToken = !!process.env.ENGINE_TOKEN?.trim();

  let reachable: boolean | null = null;
  let engineError: string | null = null;
  let engine: Record<string, unknown> | null = null;

  if (which === "engine" && engineUrl) {
    const root = engineUrl.replace(/\/+$/, "");
    try {
      const response = await fetch(`${root}/health`, {
        signal: AbortSignal.timeout(10_000),
        cache: "no-store",
      });
      reachable = response.ok;
      if (!response.ok) engineError = `the engine answered ${response.status}`;
    } catch (error) {
      reachable = false;
      engineError = error instanceof Error ? error.message : String(error);
    }

    // What the engine itself says it is missing. Vercel can reach the droplet
    // even where a browser on a restricted network cannot, so asking through
    // here is often the only way to see this.
    if (reachable && hasToken) {
      try {
        const response = await fetch(`${root}/admin/diagnostics`, {
          headers: { authorization: `Bearer ${process.env.ENGINE_TOKEN!.trim()}` },
          signal: AbortSignal.timeout(10_000),
          cache: "no-store",
        });
        if (response.ok) {
          const d = (await response.json()) as Record<string, any>;
          engine = {
            uptimeSeconds: d.uptimeSeconds,
            memory: d.memory,
            queue: d.queue,
            runsOnDisk: d.runsOnDisk,
            missingForPortedStages: d.missingForPortedStages,
            missingOverall: d.missingOverall,
            recent: d.recent,
          };
        } else {
          engineError = `diagnostics answered ${response.status}` +
            (response.status === 401 ? " — ENGINE_TOKEN does not match the engine's" : "");
        }
      } catch (error) {
        engineError = error instanceof Error ? error.message : String(error);
      }
    }
  }

  return NextResponse.json({
    backend: which,
    raw: process.env.RUN_BACKEND ?? null,
    engineUrl: engineUrl || null,
    engineTokenSet: hasToken,
    reachable,
    engineError,
    engine,
    note:
      which === "n8n"
        ? "Runs go to n8n. Set RUN_BACKEND=engine and redeploy to switch."
        : reachable === false
          ? "Set to engine, but the engine could not be reached from Vercel."
          : "Runs go to the engine.",
  });
}
