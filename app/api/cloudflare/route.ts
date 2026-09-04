import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { record } from "@/lib/audit";
import { errorResponse, requireSession } from "@/lib/api-guard";
import {
  accounts, CloudflareConfigError, createRecord, createZone, deleteRecord,
  findZone, listRecords, updateRecord,
} from "@/lib/cloudflare";
import { groupById } from "@/lib/dnsgroups";
import { sweep, watchZone } from "@/lib/cfwatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Creating a zone and writing a group's worth of records in one call.
export const maxDuration = 60;

function domainOf(value: unknown): string {
  const domain = String(value ?? "").trim().toLowerCase();
  if (!/^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) {
    throw new Error("That is not a domain name.");
  }
  return domain;
}

/**
 * A record's name, as Cloudflare wants it.
 *
 * Groups store "@" and "www" so that one group serves every domain. Cloudflare
 * wants the full name and treats "@" as a literal label rather than the apex,
 * so a group written through unchanged would create a hostname called "@".
 */
function fullName(name: string, domain: string): string {
  const label = name.trim();
  if (!label || label === "@") return domain;
  if (label.endsWith(domain)) return label;
  return `${label}.${domain}`;
}

/** Reads one zone: its status and its records. Or sweeps the pending ones. */
export async function GET(request: Request) {
  const denied = await requireSession();
  if (denied) return denied;

  try {
    const params = new URL(request.url).searchParams;

    // The sweep runs here rather than on a timer this app does not have. It is
    // idempotent and rate-limited inside, so a page loading twice in a minute
    // costs one round of checks at most.
    if (params.get("sweep")) {
      return NextResponse.json(await sweep());
    }

    // Which accounts exist, so the add dialog can offer a choice rather than
    // silently picking one when there is more than one.
    if (params.get("accounts")) {
      const list = await accounts();
      return NextResponse.json({
        // The label and the id only. The token never leaves the server.
        accounts: list
          .filter((a) => a.accountId)
          .map((a) => ({ id: a.accountId, label: a.label })),
      });
    }

    const domain = domainOf(params.get("domain"));
    const found = await findZone(domain);
    if (!found) return NextResponse.json({ zone: null, records: [] });

    return NextResponse.json({
      zone: found.zone,
      records: await listRecords(found.zone.id, found.account.token),
    });
  } catch (error) {
    if (error instanceof CloudflareConfigError) {
      return NextResponse.json({ error: error.message, kind: "config" }, { status: 500 });
    }
    return errorResponse(error);
  }
}

/** Adds the domain to Cloudflare, optionally writing a saved group's records. */
export async function POST(request: Request) {
  const denied = await requireSession();
  if (denied) return denied;

  const session = await auth();
  const actor = session?.user?.name ?? "unknown";

  let body: { domain?: string; groupId?: string; accountId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  try {
    const domain = domainOf(body.domain);
    const { zone, account } = await createZone(domain, body.accountId);

    // Records written after the zone exists and before anybody is told to move
    // the name servers, so the site answers correctly the moment Cloudflare
    // takes over rather than serving nothing until somebody notices.
    const written: string[] = [];
    const failed: string[] = [];

    if (body.groupId) {
      const group = await groupById(String(body.groupId));
      if (group) {
        for (const r of group.records) {
          try {
            await createRecord(zone.id, {
              type: r.type,
              name: fullName(r.name, domain),
              content: r.content === "@" ? domain : r.content,
              ttl: r.ttl,
              proxied: r.proxied,
              priority: r.priority,
            }, account.token);
            written.push(`${r.type} ${r.name}`);
          } catch (e) {
            // One refused record must not undo a zone that was created
            // correctly. Cloudflare adds its own records on creation, so a
            // clash here is ordinary; the panel shows what actually landed.
            failed.push(`${r.type} ${r.name}: ${e instanceof Error ? e.message : "refused"}`);
          }
        }
      }
    }

    await watchZone(domain, zone.id);
    await record(
      actor,
      "dns-changed",
      `Added ${domain} to Cloudflare` +
        (written.length ? `, ${written.length} record(s) written` : "") +
        (failed.length ? `, ${failed.length} refused` : ""),
    );

    return NextResponse.json({ zone, written, failed });
  } catch (error) {
    if (error instanceof CloudflareConfigError) {
      return NextResponse.json({ error: error.message, kind: "config" }, { status: 500 });
    }
    const message = error instanceof Error ? error.message : "";
    if (/already has a zone|not a domain|account id/i.test(message)) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    return errorResponse(error);
  }
}

/** Writes or deletes one record on an existing zone. */
export async function PUT(request: Request) {
  const denied = await requireSession();
  if (denied) return denied;

  const session = await auth();
  const actor = session?.user?.name ?? "unknown";

  let body: {
    domain?: string;
    zoneId?: string;
    recordId?: string;
    remove?: boolean;
    record?: {
      type: string;
      name: string;
      content: string;
      ttl?: number;
      proxied?: boolean;
      priority?: number;
    };
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  try {
    const domain = domainOf(body.domain);
    const zoneId = String(body.zoneId ?? "");
    if (!/^[0-9a-f]{32}$/i.test(zoneId)) throw new Error("That is not a zone id.");

    // The token that owns the zone, because another account's token is refused
    // and the refusal reads exactly like a permissions problem.
    const owner = await findZone(domain);
    if (!owner) throw new Error("No Cloudflare zone for that domain in any configured account.");

    if (body.remove) {
      const recordId = String(body.recordId ?? "");
      if (!/^[0-9a-f]{32}$/i.test(recordId)) throw new Error("That is not a record id.");
      await deleteRecord(zoneId, recordId, owner.account.token);
      await record(actor, "dns-changed", `${domain}: deleted a Cloudflare record`);
      return NextResponse.json({ ok: true });
    }

    if (!body.record) {
      return NextResponse.json({ error: "Nothing to write." }, { status: 400 });
    }

    const input = {
      ...body.record,
      name: fullName(body.record.name, domain),
      content: body.record.content === "@" ? domain : body.record.content,
    };

    if (body.recordId) {
      await updateRecord(zoneId, String(body.recordId), input, owner.account.token);
    } else {
      await createRecord(zoneId, input, owner.account.token);
    }

    await record(
      actor,
      "dns-changed",
      `${domain} on Cloudflare: ${input.type} ${input.name} = ${String(input.content).slice(0, 120)}`,
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof CloudflareConfigError) {
      return NextResponse.json({ error: error.message, kind: "config" }, { status: 500 });
    }
    const message = error instanceof Error ? error.message : "";
    if (/not a |refused the/i.test(message)) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    return errorResponse(error);
  }
}
