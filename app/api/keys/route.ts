import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { record } from "@/lib/audit";
import { errorResponse, requireSession } from "@/lib/api-guard";
import { backend } from "@/lib/backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * The engine's credentials, read and written through the console.
 *
 * They live on the engine rather than here: it is the thing that uses them,
 * and keeping them there means this app never holds a key it has no use for.
 * Values are never returned in either direction — the listing reports which
 * names are set and a masked tail, which is enough to tell two keys apart and
 * not enough to use one.
 */
async function callEngine(init: RequestInit): Promise<Response> {
  const url = process.env.ENGINE_URL?.trim();
  const token = process.env.ENGINE_TOKEN?.trim();

  if (!url || !token) {
    throw new Error("ENGINE_URL and ENGINE_TOKEN must both be set to manage credentials.");
  }

  return fetch(`${url.replace(/\/+$/, "")}/admin/credentials`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
  });
}

export async function GET() {
  const denied = await requireSession();
  if (denied) return denied;

  if (backend() !== "engine") {
    return NextResponse.json({
      credentials: [],
      note: "Runs currently go to n8n, whose credentials are managed in n8n itself.",
    });
  }

  try {
    const response = await callEngine({ method: "GET" });
    const body = await response.json();
    return NextResponse.json(body, { status: response.status });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  const denied = await requireSession();
  if (denied) return denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const session = await auth();
  const actor = session?.user?.name ?? "unknown";

  try {
    const response = await callEngine({ method: "POST", body: JSON.stringify(body) });
    const result = await response.json();

    // The names, never the values — an audit trail should say what changed
    // without becoming somewhere secrets are written down.
    if (Array.isArray(result.changed) && result.changed.length) {
      await record(actor, "keys-updated", result.changed.join(", "));
    }

    return NextResponse.json(result, { status: response.status });
  } catch (error) {
    return errorResponse(error);
  }
}
