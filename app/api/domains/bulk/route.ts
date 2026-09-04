import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { record } from "@/lib/audit";
import { errorResponse, requireSession } from "@/lib/api-guard";
import { BATCH, runBulk, type BulkAction, type BulkTarget } from "@/lib/bulk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// One batch of twelve, each several round trips. The caller loops.
export const maxDuration = 90;

const ALLOWED: BulkAction[] = [
  "cloudflare-add",
  "cloudflare-point",
  "renew-auto-on",
  "renew-auto-off",
];

export async function POST(request: Request) {
  const denied = await requireSession();
  if (denied) return denied;

  const session = await auth();
  const actor = session?.user?.name ?? "unknown";

  let body: {
    action?: string;
    targets?: Array<{ domain?: string; provider?: string }>;
    groupId?: string;
    accountId?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const action = String(body.action ?? "") as BulkAction;
  if (!ALLOWED.includes(action)) {
    return NextResponse.json({ error: "That is not a bulk action." }, { status: 400 });
  }

  // Validated here rather than trusted, because a bulk write is exactly where a
  // malformed name would be least noticed among three hundred good ones.
  const targets: BulkTarget[] = [];
  for (const t of body.targets ?? []) {
    const domain = String(t.domain ?? "").trim().toLowerCase();
    const provider = String(t.provider ?? "");
    if (!/^[a-z0-9][a-z0-9.-]{1,252}\.[a-z]{2,63}$/.test(domain)) continue;
    if (provider !== "godaddy" && provider !== "gandi") continue;
    targets.push({ domain, provider });
  }

  if (!targets.length) {
    return NextResponse.json({ error: "No usable domains in that selection." }, { status: 400 });
  }

  try {
    const results = await runBulk(action, targets, {
      groupId: body.groupId,
      accountId: body.accountId,
    });

    // Recorded per batch rather than per domain. A run of three hundred would
    // otherwise be three hundred log lines and drive everything else out of a
    // capped log — but a bulk write must leave a trace, so the counts and the
    // failures go in.
    const failed = results.filter((r) => !r.ok);
    await record(
      actor,
      "dns-changed",
      `Bulk ${action}: ${results.length - failed.length} ok, ${failed.length} failed` +
        (failed.length ? ` — ${failed.slice(0, 5).map((f) => f.domain).join(", ")}` : ""),
    );

    return NextResponse.json({ results, batch: BATCH });
  } catch (error) {
    return errorResponse(error);
  }
}
