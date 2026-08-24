import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { errorResponse } from "@/lib/api-guard";
import {
  exchangesFor,
  forget,
  markdownFor,
  recordExchange,
  scopeFor,
} from "@/lib/memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * n8n calls this from inside a run, where there is no session, so a shared
 * secret stands in. The same header the trigger already uses, so there is no
 * second secret to configure and forget.
 */
function fromWorkflow(request: Request): boolean {
  const expected = process.env.N8N_WEBHOOK_SECRET;
  if (!expected) return false;
  const supplied = request.headers.get("x-trigger-secret") ?? "";
  return supplied.length > 0 && supplied === expected;
}

async function allowed(request: Request): Promise<boolean> {
  if (fromWorkflow(request)) return true;
  const session = await auth();
  return Boolean(session?.user);
}

export async function GET(request: Request) {
  if (!(await allowed(request))) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const params = new URL(request.url).searchParams;
  const url = params.get("url") ?? params.get("domain") ?? "";

  try {
    if (params.get("format") === "json") {
      return NextResponse.json({
        scope: scopeFor(url),
        exchanges: await exchangesFor(url),
      });
    }

    // Markdown by default: the caller is an n8n HTTP node feeding this straight
    // into the next prompt, and text needs no unwrapping at the other end.
    return new NextResponse(await markdownFor(url), {
      status: 200,
      headers: { "content-type": "text/markdown; charset=utf-8" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  if (!(await allowed(request))) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  try {
    const result = await recordExchange({
      url: body.url,
      node: body.node,
      prompt: body.prompt,
      response: body.response,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  // Clearing a transcript is a person's decision, so no workflow shortcut here.
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const url = new URL(request.url).searchParams.get("domain") ?? "";
  try {
    const cleared = await forget(url);
    if (!cleared) {
      return NextResponse.json(
        { error: "Nothing stored for that scope." },
        { status: 404 }
      );
    }
    return NextResponse.json({ ok: true, scope: scopeFor(url) });
  } catch (error) {
    return errorResponse(error);
  }
}
