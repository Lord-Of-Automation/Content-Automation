import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { record } from "@/lib/audit";
import { errorResponse, requirePermission } from "@/lib/api-guard";
import { startRun } from "@/lib/engine";
import { LANGUAGE_CODES, MARKET_CODES } from "@/lib/markets";
import {
  ENGINE_OUTDATED,
  listCustomRuns,
  listPageTypes,
  type CustomAction,
} from "@/lib/pagetypes";
import { credentialsFor, normaliseDomain } from "@/lib/sites";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Custom runs: the list, and starting one.
 *
 * Always the engine, whatever RUN_BACKEND says. n8n has no idea what a page
 * type is, and the fallback that switch exists for would be a workflow that
 * rewrites the page instead.
 *
 * Starting one asks the engine for its page types first, every time. An engine
 * from before page types does not refuse a run it does not understand — it
 * runs the optimiser over the address it was given, which rewrites a live page
 * nobody asked to have rewritten. The list is the cheapest question that
 * proves the engine knows the word, so nothing starts without its answer.
 */

export async function GET() {
  const denied = await requirePermission("custom");
  if (denied) return denied;

  try {
    return NextResponse.json({ runs: await listCustomRuns(30) });
  } catch (error) {
    return errorResponse(error);
  }
}

/** An http or https address, or null. */
function webAddress(raw: unknown): URL | null {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) return null;
  try {
    const url = new URL(text);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

function bad(error: string): NextResponse {
  return NextResponse.json({ error }, { status: 400 });
}

const ACTIONS: CustomAction[] = ["optimise", "add", "design"];

export async function POST(request: Request) {
  const denied = await requirePermission("custom");
  if (denied) return denied;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return bad("Invalid JSON body.");
  }
  if (!body || typeof body !== "object") return bad("Nothing was sent.");

  const action = String(body.action ?? "") as CustomAction;
  if (!ACTIONS.includes(action)) {
    return bad("Say whether to optimise a page, add one, or draft a page type.");
  }

  // ---- what every run needs
  const market = String(body.market ?? "").trim().toLowerCase();
  if (!MARKET_CODES.has(market)) return bad("Choose a market from the list.");
  const language = String(body.language ?? "").trim().toLowerCase();
  if (!LANGUAGE_CODES.has(language)) return bad("Choose a language from the list.");

  const pageTypeId = String(body.page_type_id ?? "").trim();
  if (!/^[\w.-]{0,80}$/.test(pageTypeId)) return bad("That is not a page type.");

  // ---- what each job needs
  let websiteUrl = "";
  let sourceUrl = "";
  let exampleUrls: string[] = [];
  let designNote = "";
  let target = "";

  if (action === "optimise") {
    const page = webAddress(body.website_url);
    if (!page) return bad("Give the address of the page to rewrite, starting with https://");
    // A bare domain is what the optimiser takes to mean every page on the site.
    // One page is what this job is for, so a site is refused rather than guessed at.
    if (page.pathname === "/" || page.pathname === "") {
      return bad("That is a whole site. Give the full address of the one page to rewrite.");
    }
    websiteUrl = page.toString();
    target = websiteUrl;
  } else if (action === "add") {
    const site = webAddress(body.website_url);
    if (!site) return bad("Give your website's address, starting with https://");
    const source = webAddress(body.source_url);
    if (!source) return bad("Give the address of the page to write from, starting with https://");
    websiteUrl = site.toString();
    sourceUrl = source.toString();
    target = `${sourceUrl} on ${websiteUrl}`;
  } else {
    const given = Array.isArray(body.example_urls)
      ? body.example_urls.map((one) => String(one ?? "").trim())
      : String(body.example_urls ?? "").split(/\s+/);
    const listed = [...new Set(given.filter(Boolean))];
    if (!listed.length) return bad("Give at least one example page.");
    if (listed.length > 3) return bad("Give at most three example pages.");
    const parsed = listed.map(webAddress);
    const wrong = listed.find((_, at) => !parsed[at]);
    if (wrong) return bad(`${wrong} is not a web address. Each one starts with https://`);
    exampleUrls = parsed.map((one) => one!.toString());

    designNote = String(body.design_note ?? "").trim();
    if (designNote.length > 1000) {
      return bad("Keep the description to a thousand characters.");
    }
    target = exampleUrls.join(", ");
  }

  const actor = (await auth())?.user?.name ?? "unknown";

  try {
    // Both jobs end by writing to WordPress. Asked now, because the engine
    // would otherwise find out only after it has paid for the page.
    if (action !== "design" && !(await credentialsFor(websiteUrl))) {
      return bad(
        `No WordPress login is saved for ${normaliseDomain(websiteUrl) ?? "this site"}. ` +
          "Add one on the Website Accounts page first.",
      );
    }

    const { pageTypes, engineReady } = await listPageTypes();
    if (!engineReady) {
      return NextResponse.json({ error: ENGINE_OUTDATED, kind: "engine-outdated" }, { status: 409 });
    }
    // Checked here because the list is already in hand, and a run started with
    // a type that has since been deleted fails later and less clearly.
    if (pageTypeId && !pageTypes.some((one) => one.id === pageTypeId)) {
      return bad("That page type no longer exists. Choose another, or let it be detected.");
    }

    const result = await startRun({
      mode: "custom",
      custom_action: action,
      page_type_id: action === "design" ? "" : pageTypeId,
      website_url: websiteUrl,
      source_url: sourceUrl,
      example_urls: exampleUrls,
      design_note: designNote,
      market,
      language,
      publish_new_pages: action === "add" && body.publish_new_pages === true,
      /*
       * The optimiser's settings, at exactly what the engine assumes when they
       * are absent. The type insists on them, and a custom run takes its
       * direction from the page type rather than from any of these.
       */
      max_crawl_pages: 0,
      pages_to_optimise: 0,
      reuse_crawl_days: 0,
      exclude_paths: [],
      brief_doc_id: "",
      body_classes: {},
    });

    const id = result.executionId ?? "";
    await record(
      actor,
      "run-started",
      `custom ${action} ${target}` + (id ? ` → execution #${id}` : ""),
    );

    // Said loudly, because it means the engine ran something else — most
    // likely the optimiser, over the address above.
    const warning =
      result.mode === "custom"
        ? undefined
        : `The engine started this as ${result.mode ? `"${result.mode}"` : "an unnamed run"}, ` +
          "not as a custom run. Stop it now and update the engine " +
          "(cd /opt/src && git pull && docker compose up -d --build).";

    return NextResponse.json({
      executionId: id,
      note: result.note,
      ...(warning ? { warning } : {}),
    });
  } catch (error) {
    await record(
      actor,
      "run-failed",
      `custom ${action} ${target} — ${error instanceof Error ? error.message : "Unknown error."}`,
    );
    return errorResponse(error);
  }
}
