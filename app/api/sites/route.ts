import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { record } from "@/lib/audit";
import { errorResponse, requireSession } from "@/lib/api-guard";
import { deleteSite, listSites, saveSite } from "@/lib/sites";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await requireSession();
  if (denied) return denied;

  try {
    // Summaries only: passwords never travel back to the browser, not even
    // masked, so a page left open is not a credential store.
    return NextResponse.json({ sites: await listSites() });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  const denied = await requireSession();
  if (denied) return denied;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const domain = typeof body.domain === "string" ? body.domain : "";
  const username = typeof body.username === "string" ? body.username : "";
  const password = typeof body.password === "string" ? body.password : "";

  const session = await auth();
  const actor = session?.user?.name ?? "unknown";

  try {
    const result = await saveSite(domain, username, password, actor);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    await record(
      actor,
      "site-saved",
      `${result.replaced ? "Updated" : "Added"} WordPress login for ${result.domain} (user ${username.trim()})`
    );
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  const denied = await requireSession();
  if (denied) return denied;

  const domain = new URL(request.url).searchParams.get("domain") ?? "";
  const session = await auth();
  const actor = session?.user?.name ?? "unknown";

  try {
    const removed = await deleteSite(domain);
    if (!removed) {
      return NextResponse.json({ error: "No such domain." }, { status: 404 });
    }
    await record(actor, "site-removed", `Removed WordPress login for ${domain}`);
    return NextResponse.json({ ok: true, domain });
  } catch (error) {
    return errorResponse(error);
  }
}
