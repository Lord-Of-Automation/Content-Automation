import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { record } from "@/lib/audit";
import { errorResponse, requireSession } from "@/lib/api-guard";
import {
  allStatuses, clearProvider, PROVIDERS, saveCloudflareAccounts, saveProvider, specFor,
} from "@/lib/providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Registrar credentials, read and written through the console.
 *
 * Separate from /api/keys, which forwards everything to the engine. The engine
 * has no use for these: only the Domains page calls a registrar, and that page
 * is served from here.
 *
 * Nothing secret is returned in either direction. The status says which fields
 * are set, the last four characters of each, and when the credential expires —
 * enough to tell two apart and not enough to use one.
 */

/** The form's shape and its current state, so the page needs one request. */
function payload(statuses: Awaited<ReturnType<typeof allStatuses>>) {
  return {
    providers: PROVIDERS.map((p) => ({
      id: p.id,
      label: p.label,
      wired: p.wired,
      blurb: p.blurb,
      // The pattern stays on the server. It is a validation rule, not a
      // description, and the message it produces is what the browser needs.
      fields: p.fields.map((f) => ({
        name: f.name,
        label: f.label,
        secret: f.secret,
        multiline: f.multiline ?? false,
        placeholder: f.placeholder,
        hint: f.hint,
      })),
    })),
    statuses,
  };
}

export async function GET() {
  const denied = await requireSession();
  if (denied) return denied;

  try {
    return NextResponse.json(payload(await allStatuses()));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request) {
  const denied = await requireSession();
  if (denied) return denied;

  const session = await auth();
  const actor = session?.user?.name ?? "unknown";

  let body: {
    id?: string;
    values?: Record<string, string>;
    expiresAt?: string;
    /** Cloudflare only: one row per account, merged on the id. */
    accounts?: Array<{ accountId?: string; token?: string }>;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const id = String(body.id ?? "");
  const spec = specFor(id);
  if (!spec) return NextResponse.json({ error: "There is no such provider." }, { status: 400 });

  try {
    // Cloudflare arrives as rows rather than one blob, because several accounts
    // is the normal case for it and a list of secrets cannot be edited as text
    // when none of them can be shown back.
    if (id === "cloudflare" && Array.isArray(body.accounts)) {
      const saved = await saveCloudflareAccounts(
        body.accounts.map((a) => ({
          accountId: String(a.accountId ?? ""),
          token: String(a.token ?? ""),
        })),
        actor,
      );
      if (!saved.ok) return NextResponse.json({ error: saved.error }, { status: 400 });
      await record(actor, "keys-updated", `Cloudflare: ${body.accounts.length} account(s)`);
      return NextResponse.json(payload(await allStatuses()));
    }

    const result = await saveProvider(
      id,
      body.values ?? {},
      String(body.expiresAt ?? ""),
      actor,
    );
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

    // Which fields changed and when it expires. Never a value: an audit trail
    // should say what happened without becoming somewhere a secret is written.
    const changed = Object.entries(body.values ?? {})
      .filter(([, v]) => String(v ?? "").trim())
      .map(([k]) => k);
    await record(
      actor,
      "keys-updated",
      `${spec.label}: ${changed.length ? changed.join(", ") : "expiry only"}` +
        (body.expiresAt ? `, expiring ${String(body.expiresAt).slice(0, 10)}` : ""),
    );

    return NextResponse.json(payload(await allStatuses()));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  const denied = await requireSession();
  if (denied) return denied;

  const session = await auth();
  const actor = session?.user?.name ?? "unknown";

  let body: { id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const spec = specFor(String(body.id ?? ""));
  if (!spec) return NextResponse.json({ error: "There is no such provider." }, { status: 400 });

  try {
    await clearProvider(spec.id);
    await record(actor, "keys-updated", `Removed the ${spec.label} credential.`);
    return NextResponse.json(payload(await allStatuses()));
  } catch (error) {
    return errorResponse(error);
  }
}
