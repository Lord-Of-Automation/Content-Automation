import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { record } from "@/lib/audit";
import { errorResponse, requireSession } from "@/lib/api-guard";
import { credentialFor } from "@/lib/providers";
import { keepRevision, sameContent, snapshot } from "@/lib/revisions";
import { applyTool, describeSite, isWrite, SITE_TOOLS } from "@/lib/siteedits";
import { getWebsite, saveWebsite, type Website } from "@/lib/websites";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Reading three pages and rewriting two is several model calls end to end, and
// each one is a whole page of HTML coming back. The ceiling is the platform's
// rather than a judgement; an edit that runs past it saves nothing, which is
// the safe way to lose, and the panel says so.
export const maxDuration = 300;

/**
 * Editing a generated website by describing the change.
 *
 * The visual editor is faster for anything you can point at. This is for what
 * you cannot: the same change on every page, a tone adjusted throughout, a
 * section added wherever it belongs. You say what you want and it works through
 * the pages itself.
 *
 * It edits a copy and saves once, at the end. That is what makes it safe to
 * use: the version it replaced is kept, so the whole conversation undoes in one
 * click on the Versions tab, and a run that goes wrong halfway leaves the site
 * exactly as it was rather than half rewritten.
 *
 * Progress is streamed as it happens, because a request that reads four pages
 * and rewrites three takes minutes, and minutes of nothing is indistinguishable
 * from a broken page.
 */

/** How many times round the read-write loop before it is told to stop. */
const MOST_TURNS = 24;

const RULES = `
You edit a website that this platform generated, on behalf of the person who
owns it. They are looking at the site in an editor while you work.

How to work:

- Look before you write. Call list_pages when a request could touch more than
  one page, and read_page before every write_page. A body you write replaces
  the whole body, so writing one you have not read destroys work you cannot see.
- Do what was asked and stop. If somebody asks for a shorter homepage, do not
  also fix the footer you happened to notice. Say what you noticed instead and
  let them decide.
- Where a request is ambiguous in a way that changes the work, ask before
  editing rather than guessing and editing. Where it is ambiguous in a way that
  does not, pick the obvious reading and say which you picked.
- Match the site. Its voice, its heading levels, its markup habits and its
  language are already established on the pages you are editing. A page you
  rewrite should not read as though it came from somewhere else.
- Keep the HTML plain: headings, paragraphs, lists, links, tables, images. The
  document, the header, the footer and the styling are supplied around what you
  write, so a body never carries them.

When you are done, say in a sentence or two what you changed, page by page. If
you changed nothing, say that plainly and why. Never use em dashes or en dashes.
`.trim();

interface Turn {
  role: "user" | "assistant";
  content: string;
}

/** One line of the stream. The client reads these as they arrive. */
type Event =
  | { t: "text"; v: string }
  | { t: "doing"; v: string }
  | { t: "did"; v: string }
  | { t: "done"; saved: boolean; website: Website | null }
  | { t: "error"; v: string };

function idOf(value: string): string | null {
  return /^[\w-]{1,64}$/.test(value) ? value : null;
}

/** What a tool call is called while it runs, in words rather than in code. */
function narrate(name: string, input: Record<string, unknown>): string {
  const slug = typeof input.slug === "string" ? input.slug || "the front page" : "";
  switch (name) {
    case "list_pages": return "Looking at the pages";
    case "read_page": return `Reading ${slug}`;
    case "write_page": return `Editing ${slug}`;
    case "add_page": return `Adding ${slug}`;
    case "remove_page": return `Removing ${slug}`;
    case "set_site": return "Changing the site's name";
    case "set_theme": return "Changing the colours and type";
    case "set_header": return "Changing the header";
    case "set_footer": return "Changing the footer";
    default: return name;
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireSession();
  if (denied) return denied;

  const { id } = await params;
  if (!idOf(id)) return NextResponse.json({ error: "Bad id." }, { status: 400 });

  let body: { messages?: Turn[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const turns = (Array.isArray(body.messages) ? body.messages : [])
    .filter((t) => t && (t.role === "user" || t.role === "assistant"))
    .map((t) => ({ role: t.role, content: String(t.content ?? "").slice(0, 20_000) }))
    .filter((t) => t.content.trim())
    .slice(-20);

  if (!turns.length || turns[turns.length - 1]!.role !== "user") {
    return NextResponse.json({ error: "Nothing to do." }, { status: 400 });
  }

  const site = await getWebsite(id);
  if (!site) return NextResponse.json({ error: "No such website." }, { status: 404 });

  const found = await credentialFor("anthropic");
  const apiKey = found?.apiKey?.trim();
  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          "No Anthropic key is saved. Add one on the Keys page and this starts " +
          "working; nothing else needs to change.",
      },
      { status: 428 },
    );
  }

  const session = await auth();
  const actor = session?.user?.name ?? "unknown";
  const client = new Anthropic({ apiKey });
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: Event) =>
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));

      /*
       * The working copy.
       *
       * Every tool writes to this and nothing writes to storage until the loop
       * ends. So a conversation that fails in the middle leaves the site as it
       * was, rather than as far as it got.
       */
      let working = site;
      let wrote = false;

      const history: Anthropic.Beta.BetaMessageParam[] = turns.map((t) => ({
        role: t.role,
        content: t.content,
      }));

      try {
        for (let round = 0; round < MOST_TURNS; round += 1) {
          const answer = client.beta.messages.stream({
            model: "claude-opus-5",
            max_tokens: 32_000,
            system: [
              { type: "text", text: RULES, cache_control: { type: "ephemeral" } },
              // Outside the cache breakpoint: the site changes as it is edited,
              // and a cached description would describe the site as it was.
              { type: "text", text: `The site as it stands:\n\n${describeSite(working)}` },
            ],
            messages: history,
            tools: SITE_TOOLS,
            /*
             * High, unlike the sidebar's medium. This one rewrites somebody's
             * pages, and a careless edit costs them a restore and a reread of
             * the whole page rather than a second question.
             */
            output_config: { effort: "high" },
            betas: ["server-side-fallback-2026-07-01"],
            fallbacks: "default",
          });

          for await (const event of answer) {
            if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
              send({ t: "text", v: event.delta.text });
            }
          }

          const message = await answer.finalMessage();
          history.push({ role: "assistant", content: message.content });

          const calls = message.content.filter(
            (block): block is Anthropic.Beta.BetaToolUseBlock => block.type === "tool_use",
          );
          if (!calls.length) break;

          const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
          for (const call of calls) {
            const input = (call.input ?? {}) as Record<string, unknown>;
            send({ t: "doing", v: narrate(call.name, input) });

            const outcome = applyTool(working, call.name, input);
            working = outcome.site;
            if (outcome.result.ok && isWrite(call.name)) {
              wrote = true;
              send({ t: "did", v: outcome.result.said });
            }

            results.push({
              type: "tool_result",
              tool_use_id: call.id,
              content: outcome.result.said,
              is_error: !outcome.result.ok,
            });
          }

          history.push({ role: "user", content: results });
        }

        /*
         * Saved once, and only when the site actually differs.
         *
         * Compared rather than trusted: a conversation can call write_page with
         * the body it already had, and a save that changed nothing should not
         * push a real version out of a list that only holds twenty five.
         */
        let saved = false;
        if (wrote && !sameContent(snapshot(site), snapshot(working))) {
          const updated: Website = {
            ...working,
            status: working.status === "building" ? working.status : "ready",
            updatedAt: new Date().toISOString(),
            updatedBy: actor,
          };
          await keepRevision(site, "claude");
          await saveWebsite(updated);
          await record(actor, "website-edited", `${updated.name}, edited by Claude`);
          working = updated;
          saved = true;
        }

        send({ t: "done", saved, website: saved ? working : null });
      } catch (error) {
        const why =
          error instanceof Anthropic.AuthenticationError
            ? "Anthropic refused the key. Check it on the Keys page."
            : error instanceof Anthropic.RateLimitError
              ? "Anthropic is rate limiting this key. Try again shortly."
              : error instanceof Error
                ? error.message
                : "Something went wrong.";
        /*
         * Nothing is saved on the way out.
         *
         * A half-applied set of edits is the one outcome worse than none: the
         * site would be in a state nobody asked for and nobody described.
         */
        send({ t: "error", v: why });
      } finally {
        controller.close();
      }
    },
    cancel() {
      // The panel was closed or the edit withdrawn. Whatever was written to the
      // copy goes with it, which is the same promise as the failure path.
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
      "x-accel-buffering": "no",
    },
  });
}
