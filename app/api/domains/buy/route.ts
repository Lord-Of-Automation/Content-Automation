import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { record } from "@/lib/audit";
import { requireSession } from "@/lib/api-guard";
import {
  GoDaddyBuyError,
  quoteDomain,
  registerDomain,
  registrationStatus,
} from "@/lib/godaddybuy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A quote and a registration are each one call to GoDaddy, but a registration
// on a slow day is not a ten second operation.
export const maxDuration = 60;

/**
 * Buying a domain, in the three steps GoDaddy splits it into.
 *
 * A quote, then the purchase, then polling until it lands. The split is what
 * makes an honest confirmation possible: the price in the dialog is the price
 * in the token, and the token is what the purchase quotes, so the figure
 * somebody agreed to is the figure that gets charged.
 *
 * The browser never names a price. It asks for a quote, shows what came back,
 * and sends the token — a page that could name its own price could name any
 * price, and this is the one part of the console where that would cost money.
 */

function failed(error: unknown) {
  const message =
    error instanceof GoDaddyBuyError
      ? error.message
      : error instanceof Error
        ? error.message
        : "That did not work.";
  // A refusal from GoDaddy is not this console falling over, and a 502 would
  // send somebody looking at the wrong thing.
  return NextResponse.json({ error: message }, { status: error instanceof GoDaddyBuyError ? 400 : 502 });
}

export async function POST(request: Request) {
  const denied = await requireSession();
  if (denied) return denied;

  const session = await auth();
  const actor = session?.user?.name ?? "unknown";

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const domain = String(body.domain ?? "").trim().toLowerCase();
    const period = Math.max(1, Math.min(10, Math.round(Number(body.period) || 1)));

    if (!domain) {
      return NextResponse.json({ error: "No domain was named." }, { status: 400 });
    }

    // --- what it would cost -------------------------------------------------
    if (body.action === "quote") {
      const quote = await quoteDomain(domain, period);
      if (!quote.available) {
        return NextResponse.json(
          { error: `${domain} is not available to register.` },
          { status: 409 },
        );
      }
      // Not audited. Asking the price of something is not an act on the world,
      // and a log of every price somebody looked at would bury the one line in
      // it that matters.
      return NextResponse.json({ quote });
    }

    // --- the charge ---------------------------------------------------------
    const quoteToken = String(body.quoteToken ?? "").trim();
    const idempotencyKey = String(body.idempotencyKey ?? "").trim();
    const agreements = Array.isArray(body.agreements) ? body.agreements.map(String) : [];

    if (!quoteToken) {
      return NextResponse.json(
        { error: "That purchase carries no quote, so there is no agreed price." },
        { status: 400 },
      );
    }
    if (!idempotencyKey) {
      return NextResponse.json(
        { error: "That purchase carries no idempotency key, so a retry could buy twice." },
        { status: 400 },
      );
    }

    /*
     * Written down before it happens, not after.
     *
     * A purchase that times out on the way back still bought the domain, and a
     * log written only on success would have no record of the one attempt
     * anybody needs to find. The line says what was asked for; the line after
     * it says how it went.
     */
    await record(actor, "domain-buying", `${domain} for ${period} year(s)`);

    const started = await registerDomain({
      domain,
      period,
      quoteToken,
      agreements,
      idempotencyKey,
    });

    await record(actor, "domain-bought", `${domain}, registration ${started.registrationId}`);
    return NextResponse.json({ registration: started });
  } catch (error) {
    return failed(error);
  }
}

/** Where a registration got to. CONFIRMED means it is still happening. */
export async function GET(request: Request) {
  const denied = await requireSession();
  if (denied) return denied;

  const id = String(new URL(request.url).searchParams.get("id") ?? "").trim();
  if (!id) return NextResponse.json({ error: "No registration was named." }, { status: 400 });

  try {
    return NextResponse.json({ registration: await registrationStatus(id) });
  } catch (error) {
    return failed(error);
  }
}
