import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { record } from "@/lib/audit";
import { errorResponse, requireSession } from "@/lib/api-guard";
import {
  deleteRrset, getNameservers, readZone, setNameservers, writeRrset, type Rrset,
} from "@/lib/dns";
import { specFor, type ProviderId } from "@/lib/providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 45;

/**
 * Reading and changing where one domain points.
 *
 * Every write here reaches the registry and, through it, the whole internet.
 * The guards that matter live in lib/dns.ts, where they cannot be skipped by
 * calling this route differently; what this file adds is the audit trail. A
 * change of name servers takes a site down as surely as deleting it, and doing
 * that without a record of who and when is not something to ship.
 */

function providerOf(value: unknown): ProviderId {
  const id = String(value ?? "");
  const spec = specFor(id);
  // Only the two that are wired. The others store a credential and read nothing.
  if (!spec || (id !== "godaddy" && id !== "gandi")) {
    throw new Error("That registrar cannot be edited from here.");
  }
  return id as ProviderId;
}

function domainOf(value: unknown): string {
  const domain = String(value ?? "").trim().toLowerCase();
  if (!/^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) {
    throw new Error("That is not a domain name.");
  }
  return domain;
}

export async function GET(request: Request) {
  const denied = await requireSession();
  if (denied) return denied;

  try {
    const params = new URL(request.url).searchParams;
    const provider = providerOf(params.get("provider"));
    const domain = domainOf(params.get("domain"));

    // The name servers first, because whether the zone is the live one is read
    // off them rather than reported by either API.
    const nameServers = await getNameservers(provider, domain);
    const zone = await readZone(provider, domain, nameServers);

    return NextResponse.json({ domain, provider, nameServers, ...zone });
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
    provider?: string;
    domain?: string;
    nameServers?: string[];
    rrset?: Rrset;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  try {
    const provider = providerOf(body.provider);
    const domain = domainOf(body.domain);

    if (Array.isArray(body.nameServers)) {
      // Recorded before the call, so an attempt that fails halfway is still
      // attributable. A name server change is the one write here that can take
      // a site off the internet.
      const before = await getNameservers(provider, domain).catch(() => []);
      await setNameservers(provider, domain, body.nameServers);
      await record(
        actor,
        "dns-changed",
        `${domain} name servers: ${before.join(", ") || "unknown"} → ${body.nameServers.join(", ")}`,
      );
      return NextResponse.json({ ok: true });
    }

    if (body.rrset) {
      await writeRrset(provider, domain, body.rrset);
      await record(
        actor,
        "dns-changed",
        `${domain} ${body.rrset.type} ${body.rrset.name} = ${body.rrset.values.join(", ").slice(0, 200)}`,
      );
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Nothing to change." }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    // A rejected value is something to correct in the form, not an upstream
    // failure to retry.
    if (/not a |at least two|cannot be edited|needs a value|Time to live|listed twice|more name servers|Name servers are changed/i.test(message)) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  const denied = await requireSession();
  if (denied) return denied;

  const session = await auth();
  const actor = session?.user?.name ?? "unknown";

  let body: { provider?: string; domain?: string; name?: string; type?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  try {
    const provider = providerOf(body.provider);
    const domain = domainOf(body.domain);
    const name = String(body.name ?? "");
    const type = String(body.type ?? "");

    await deleteRrset(provider, domain, name, type);
    await record(actor, "dns-changed", `${domain} deleted ${type} ${name}`);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/cannot be deleted|not a |Name servers are changed/i.test(message)) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    return errorResponse(error);
  }
}
