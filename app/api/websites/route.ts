import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { record } from "@/lib/audit";
import { errorResponse, requireSession } from "@/lib/api-guard";
import { fetchBuiltSite, startBuild } from "@/lib/engine";
import {
  DEFAULT_FOOTER, DEFAULT_HEADER, DEFAULT_THEME, listWebsites, newWebsiteId,
  saveWebsite, settleFrom, type Website,
} from "@/lib/websites";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Copies across whatever a build run has written so far.
 *
 * Done when the list is read rather than by a job or a webhook. The engine has
 * no way to call back into a console it does not know the address of, and a
 * poller would be a second moving part to keep alive for something that only
 * matters while somebody is looking at the page.
 *
 * The site is fetched while the run is still going as well as after, so a build
 * halfway through shows the pages it has written rather than nothing at all.
 */
async function catchUp(site: Website, actor: string): Promise<Website> {
  if (site.status !== "building" || !site.runId) return site;

  const updated = settleFrom(site, await fetchBuiltSite(site.runId), actor);
  if (updated === site) return site;

  await saveWebsite(updated);
  return updated;
}

export async function GET() {
  const denied = await requireSession();
  if (denied) return denied;

  const session = await auth();
  const actor = session?.user?.name ?? "unknown";

  try {
    const rows = await listWebsites();
    // Only the ones still being written, which is nearly always none.
    const settled = await Promise.all(rows.map((site) => catchUp(site, actor)));
    return NextResponse.json({ websites: settled });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * Start writing a new website.
 *
 * The record is created immediately, before the run has written a word, so the
 * list has something to show and the build has somewhere to land. A build that
 * fails leaves a record saying so rather than nothing at all, which is the
 * difference between "it did not work" and "did I imagine pressing the button".
 */
export async function POST(request: Request) {
  const denied = await requireSession();
  if (denied) return denied;

  const session = await auth();
  const actor = session?.user?.name ?? "unknown";

  let body: {
    brief?: string;
    topic?: string;
    keywords?: string | string[];
    format?: string;
    pageCount?: number;
    name?: string;
    language?: string;
    primaryKeyword?: string;
    market?: string;
    houseRules?: string;
    referenceUrl?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const brief = String(body.brief ?? "").trim();
  const topic = String(body.topic ?? "").trim();
  if (!brief) {
    return NextResponse.json({ error: "Say what the website is for." }, { status: 400 });
  }
  if (!topic) {
    return NextResponse.json({ error: "Say what the website is about." }, { status: 400 });
  }

  const keywords = (
    Array.isArray(body.keywords) ? body.keywords : String(body.keywords ?? "").split(/[\n,]/)
  )
    .map((k) => String(k ?? "").trim())
    .filter(Boolean)
    .slice(0, 40);

  const format = body.format === "static" ? "static" : "wordpress";
  const pageCount = Math.max(1, Math.min(30, Number(body.pageCount) || 5));
  const name = String(body.name ?? "").trim().slice(0, 80);
  const language = String(body.language ?? "en").trim().toLowerCase().slice(0, 8) || "en";

  try {
    const started = await startBuild({
      brief,
      topic,
      keywords,
      site_format: format,
      page_count: pageCount,
      site_name: name,
      language,
      primary_keyword: String(body.primaryKeyword ?? "").trim().slice(0, 120),
      site_market: String(body.market ?? "gb").trim().toLowerCase().slice(0, 8),
      house_rules: String(body.houseRules ?? "").trim().slice(0, 6000),
      reference_url: String(body.referenceUrl ?? "").trim().slice(0, 500),
    });

    const now = new Date().toISOString();
    const site: Website = {
      id: newWebsiteId(),
      name: name || topic,
      tagline: "",
      description: brief,
      topic,
      keywords,
      format,
      language,
      status: "building",
      runId: started.executionId,
      note: started.note ?? "",
      pages: [],
      header: DEFAULT_HEADER,
      footer: DEFAULT_FOOTER,
      theme: DEFAULT_THEME,
      design: null,
      createdAt: now,
      createdBy: actor,
      updatedAt: now,
      updatedBy: actor,
    };

    await saveWebsite(site);
    await record(actor, "website-created", `${site.name} (${format}, ${pageCount} pages)`);

    return NextResponse.json({ website: site });
  } catch (error) {
    return errorResponse(error);
  }
}
