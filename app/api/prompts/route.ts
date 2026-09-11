import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { record } from "@/lib/audit";
import { errorResponse, requireSession } from "@/lib/api-guard";
import { deleteSitePrompt, listSitePrompts, saveSitePrompt } from "@/lib/siteprompts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * The instruction each site carries, kept on the engine.
 *
 * Nothing is validated here beyond the domain being present. The engine reads
 * these at the moment a page is written and is the only thing that can say
 * what it will accept; a second set of rules on this side would disagree with
 * it the first time either changed.
 *
 * Audited, because an instruction that changes how a site is written changes
 * every page written for it from then on, and "when did this start sounding
 * different" is a question somebody asks months later.
 */
export async function GET() {
  const denied = await requireSession();
  if (denied) return denied;

  try {
    return NextResponse.json({ prompts: await listSitePrompts() });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request) {
  const denied = await requireSession();
  if (denied) return denied;

  const session = await auth();
  const actor = session?.user?.name ?? "unknown";

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const domain = String(body.domain ?? "").trim();
    const prompt = String(body.prompt ?? "");

    if (!domain) {
      return NextResponse.json({ error: "No domain was given." }, { status: 400 });
    }

    const prompts = await saveSitePrompt(domain, prompt, actor);
    await record(actor, "prompt-saved", domain);
    return NextResponse.json({ prompts });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  const denied = await requireSession();
  if (denied) return denied;

  const session = await auth();
  const actor = session?.user?.name ?? "unknown";

  try {
    const domain = String(new URL(request.url).searchParams.get("domain") ?? "").trim();
    if (!domain) {
      return NextResponse.json({ error: "No domain was given." }, { status: 400 });
    }

    const prompts = await deleteSitePrompt(domain);
    await record(actor, "prompt-deleted", domain);
    return NextResponse.json({ prompts });
  } catch (error) {
    return errorResponse(error);
  }
}
