import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { record } from "@/lib/audit";
import { errorResponse, requireSession } from "@/lib/api-guard";
import {
  addCloudflareAccount, allStatuses, clearProvider, PROVIDERS,
  removeCloudflareAccount, saveProvider, specFor,
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

export async function GET(request: Request) {
  const denied = await requireSession();
  if (denied) return denied;

  try {
    const statuses = await allStatuses();

    // Asked for separately, because it costs a request per account and the
    // form should render before anybody has been to Cloudflare and back.
    if (new URL(request.url).searchParams.get("check")) {
      const { accountSummaries } = await import("@/lib/cloudflare");
      const cloudflare = await accountSummaries().catch(() => []);
      return NextResponse.json({ ...payload(statuses), cloudflare });
    }

    return NextResponse.json(payload(statuses));
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
    /** Cloudflare only: one credential to append, or one to drop. */
    add?: { token?: string; accountId?: string };
    remove?: string;
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
    // Cloudflare is added one at a time and removed one at a time, rather than
    // saved as a block. None of its tokens can be shown back, so a form that
    // edited the whole list would make you retype every one of them to change
    // any of them.
    if (id === "cloudflare" && body.add) {
      const added = await addCloudflareAccount(
        String(body.add.token ?? ""),
        String(body.add.accountId ?? ""),
        actor,
      );
      if (!added.ok) return NextResponse.json({ error: added.error }, { status: 400 });
      await record(
        actor,
        "keys-updated",
        `Cloudflare: added the account ending ${String(body.add.token ?? "").slice(-4)}`,
      );
      return NextResponse.json(payload(await allStatuses()));
    }

    if (id === "cloudflare" && body.remove) {
      const dropped = await removeCloudflareAccount(String(body.remove), actor);
      if (!dropped.ok) return NextResponse.json({ error: dropped.error }, { status: 400 });
      await record(actor, "keys-updated", `Cloudflare: removed ${body.remove}`);
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
