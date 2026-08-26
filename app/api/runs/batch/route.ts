import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { record } from "@/lib/audit";
import { errorResponse, requireSession } from "@/lib/api-guard";
import { startRun } from "@/lib/backend";
import { validateRunInput } from "@/lib/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** More than this in one go is a sign someone pasted the wrong thing. */
const MAX_URLS = 25;

export type BatchResult = {
  started: { url: string; executionId: string | null; startedAt: string }[];
  failed: { url: string; error: string }[];
  skipped: string[];
};

export async function POST(request: Request) {
  const denied = await requireSession();
  if (denied) return denied;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const rawUrls = Array.isArray(body.urls) ? body.urls : [];
  const urls: string[] = [];
  for (const value of rawUrls) {
    const url = typeof value === "string" ? value.trim() : "";
    // Duplicates in a pasted list are a mistake, not an instruction to pay twice.
    if (url && !urls.includes(url)) urls.push(url);
  }

  if (urls.length === 0) {
    return NextResponse.json({ error: "No URLs given." }, { status: 400 });
  }
  if (urls.length > MAX_URLS) {
    return NextResponse.json(
      { error: `That is ${urls.length} URLs. The limit is ${MAX_URLS} per batch.` },
      { status: 400 }
    );
  }

  const session = await auth();
  const actor = session?.user?.name ?? "unknown";

  const result: BatchResult = { started: [], failed: [], skipped: [] };

  // Triggering returns as soon as n8n hands back an execution id, so these are
  // quick. n8n then runs them under its own concurrency limits, which is why
  // this fires them all rather than waiting for each to finish: nothing has to
  // stay open on the client for the queue to drain.
  const deadline = Date.now() + 45_000;

  for (const [index, url] of urls.entries()) {
    if (Date.now() > deadline) {
      result.skipped.push(...urls.slice(index));
      break;
    }

    const parsed = validateRunInput({ ...body, website_url: url });
    if (!parsed.ok) {
      result.failed.push({
        url,
        error: Object.values(parsed.errors)[0] ?? "Invalid input.",
      });
      continue;
    }

    try {
      const run = await startRun(parsed.value);
      result.started.push({
        url,
        executionId: run.executionId,
        startedAt: run.startedAt,
      });
      await record(
        actor,
        "run-started",
        `${url} (${parsed.value.market}/${parsed.value.language}, ` +
          `${parsed.value.max_crawl_pages} page${parsed.value.max_crawl_pages === 1 ? "" : "s"})` +
          (run.executionId ? ` → execution #${run.executionId}` : "") +
          ` [batch ${index + 1}/${urls.length}]`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error.";
      result.failed.push({ url, error: message });
      await record(actor, "run-failed", `${url} — ${message}`);
    }
  }

  try {
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
