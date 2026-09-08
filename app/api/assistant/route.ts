import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";

import { errorResponse, requireSession } from "@/lib/api-guard";
import { PLATFORM_DOC } from "@/lib/platformdoc";
import { credentialFor } from "@/lib/providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Asking Claude a question, from inside the console.
 *
 * The key stays here. It is held in the credential store beside the registrar
 * tokens and the hosting logins, read on the way past, and never sent to the
 * browser — which is the whole reason this is a route rather than a fetch from
 * the panel itself.
 *
 * The answer is streamed. A question worth asking often takes twenty seconds to
 * answer, and twenty seconds of nothing is indistinguishable from a broken
 * page; streaming also keeps a long answer clear of the limit on how long a
 * serverless request may take to produce its first byte.
 */

/**
 * What the assistant is told it is looking at.
 *
 * Enough for it to answer about this platform rather than about software in
 * general — somebody asking "why is my run stuck" means a run here, not the
 * concept. Deliberately short: a long briefing is a long prompt on every
 * message, and most of what people ask needs none of it.
 */
const ABOUT =
  "You are answering questions inside a content automation console its owner " +
  "runs their SEO business from. The console does five things: it optimises " +
  "existing pages on WordPress sites (Optimize), repeats that on a schedule " +
  "(Loop), writes whole websites with AI and publishes them (Websites), lists " +
  "the domains and hosted applications across Cloudways, Hostinger, Cloudflare " +
  "and two registrars (Domains, Applications), and reports on how pages rank " +
  "(Performance). A separate engine on a droplet runs the actual pipelines; " +
  "this console starts them and shows what they did.\n\n" +
  "Answer as a colleague who knows this system. Be direct and brief. If a " +
  "question is about something you cannot see — the contents of a particular " +
  "run, what a specific site says — say what you would need rather than " +
  "guessing at it. Never use em dashes or en dashes.";

/**
 * What About Platform adds.
 *
 * The short briefing above is enough to answer "what is a canonical tag" and
 * nothing like enough for "why did my run write nothing", which is the kind of
 * question somebody has while looking at this console. In that mode the whole
 * reference goes in front of it instead.
 *
 * Told to say when the reference does not cover something, because the failure
 * that matters here is a confident answer about a page that does not exist.
 */
const ABOUT_PLATFORM =
  "You are the reference desk for the platform described below. Answer from it. " +
  "Name the real page, the real setting or the real word for the thing, so the " +
  "reader can go and find it.\n\n" +
  "Where the reference does not cover something, say so plainly rather than " +
  "reasoning from how software like this usually works — a confident answer " +
  "about a page that does not exist is worse than no answer. You cannot see " +
  "the code, the current page, or any of this person's own runs, websites or " +
  "domains, so questions about a particular one of those are questions about " +
  "where to look, not what it says.\n\n" +
  "Be direct and brief. Never use em dashes or en dashes.\n\n" +
  "---\n\n" +
  PLATFORM_DOC;

interface Turn {
  role: "user" | "assistant";
  content: string;
}

export async function POST(request: Request) {
  const denied = await requireSession();
  if (denied) return denied;

  let body: { messages?: Turn[]; about?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  /*
   * The conversation, trimmed and checked.
   *
   * Trimmed because the whole history travels on every message and a panel left
   * open all afternoon would otherwise grow without limit. Checked because what
   * arrives is whatever the browser sent, and a malformed turn is a 400 from
   * Anthropic that reads like a fault here.
   */
  const turns = (Array.isArray(body.messages) ? body.messages : [])
    .filter((t) => t && (t.role === "user" || t.role === "assistant"))
    .map((t) => ({ role: t.role, content: String(t.content ?? "").slice(0, 20_000) }))
    .filter((t) => t.content.trim())
    .slice(-24);

  if (!turns.length || turns[turns.length - 1]!.role !== "user") {
    return NextResponse.json({ error: "Nothing to answer." }, { status: 400 });
  }

  const found = await credentialFor("anthropic");
  const apiKey = found?.apiKey?.trim();
  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          "No Anthropic key is saved. Add one on the Keys page and this panel " +
          "starts working; nothing else needs to change.",
      },
      { status: 428 },
    );
  }

  try {
    const client = new Anthropic({ apiKey });

    /*
     * The reference sits behind a cache breakpoint.
     *
     * It is long and identical on every message, so sending it again for each
     * follow-up would be the largest part of the bill for the shortest part of
     * the answer.
     */
    const system = body.about
      ? [{ type: "text" as const, text: ABOUT_PLATFORM, cache_control: { type: "ephemeral" as const } }]
      : ABOUT;

    const stream = client.beta.messages.stream({
      model: "claude-opus-5",
      max_tokens: 64_000,
      system,
      messages: turns,
      /*
       * Middling effort, because this is a sidebar.
       *
       * The panel is for a question asked between two other pieces of work, and
       * an answer that arrives is worth more here than an answer that is
       * marginally better and arrives a minute later. Anything that wants the
       * full weight of the model belongs in a run.
       */
      output_config: { effort: "medium" },
      /*
       * If a request is declined, the same question runs on another model
       * inside the same call rather than coming back empty. Anthropic picks
       * which by the category, so there is no list here to keep current.
       */
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });

    const encoder = new TextEncoder();
    const answer = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const event of stream) {
            if (
              event.type === "content_block_delta" &&
              event.delta.type === "text_delta"
            ) {
              controller.enqueue(encoder.encode(event.delta.text));
            }
          }

          /*
           * A decline that survived the fallback, said out loud.
           *
           * Without this the answer is simply empty, which reads as the panel
           * being broken rather than as an answer having been withheld.
           */
          const done = await stream.finalMessage();
          if (done.stop_reason === "refusal") {
            controller.enqueue(
              encoder.encode(
                "\n\nI cannot answer that one. Ask me something else about the console.",
              ),
            );
          }
        } catch (error) {
          const why = error instanceof Error ? error.message : String(error);
          controller.enqueue(encoder.encode(`\n\n[the answer stopped: ${why}]`));
        } finally {
          controller.close();
        }
      },
      cancel() {
        // The panel was closed or the question withdrawn. Stop paying for the
        // rest of an answer nobody is going to read.
        stream.abort();
      },
    });

    return new Response(answer, {
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
        // Nothing between here and the browser may hold the answer back to
        // buffer it, which would undo the point of streaming at all.
        "x-accel-buffering": "no",
      },
    });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      return NextResponse.json(
        { error: "Anthropic refused the key. Check it on the Keys page." },
        { status: 401 },
      );
    }
    if (error instanceof Anthropic.RateLimitError) {
      return NextResponse.json(
        { error: "Anthropic is rate limiting this key. Try again shortly." },
        { status: 429 },
      );
    }
    if (error instanceof Anthropic.APIError) {
      return NextResponse.json(
        { error: `Anthropic answered ${error.status}: ${error.message}` },
        { status: 502 },
      );
    }
    return errorResponse(error);
  }
}
