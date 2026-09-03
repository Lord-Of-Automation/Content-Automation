import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { record } from "@/lib/audit";
import { errorResponse, requireSession } from "@/lib/api-guard";
import { clearKey, keyStatus, saveKey } from "@/lib/godaddykey";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * The GoDaddy token, read and written through the console.
 *
 * Separate from /api/keys, which forwards everything to the engine. The engine
 * has no use for this one: only the Domains page calls GoDaddy, and that page
 * is served from here.
 *
 * The token is never returned in either direction. The status carries whether
 * one is set, where it came from, its last four characters, and when it
 * expires, which is enough to tell two tokens apart and not enough to use one.
 */
export async function GET() {
  const denied = await requireSession();
  if (denied) return denied;

  try {
    return NextResponse.json(await keyStatus());
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request) {
  const denied = await requireSession();
  if (denied) return denied;

  const session = await auth();
  const actor = session?.user?.name ?? "unknown";

  let body: { token?: string; expiresAt?: string };
  try {
    body = (await request.json()) as { token?: string; expiresAt?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  try {
    const result = await saveKey(String(body.token ?? ""), String(body.expiresAt ?? ""), actor);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

    // The tail and the expiry, never the token. An audit trail should say what
    // changed without becoming somewhere a credential is written down.
    await record(
      actor,
      "keys-updated",
      `GoDaddy token ending ${result.tail}` +
        (body.expiresAt ? `, expiring ${String(body.expiresAt).slice(0, 10)}` : ""),
    );

    return NextResponse.json(await keyStatus());
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE() {
  const denied = await requireSession();
  if (denied) return denied;

  const session = await auth();
  const actor = session?.user?.name ?? "unknown";

  try {
    await clearKey();
    await record(actor, "keys-updated", "Removed the stored GoDaddy token.");
    return NextResponse.json(await keyStatus());
  } catch (error) {
    return errorResponse(error);
  }
}
