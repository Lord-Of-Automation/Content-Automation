import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { record } from "@/lib/audit";
import { errorResponse, requireSession } from "@/lib/api-guard";
import { listSchedules, saveSchedule } from "@/lib/schedules";
import { credentialsFor } from "@/lib/sites";
import { DECLARABLE_CLASSES, parseBodyClassList } from "@/lib/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
  const denied = await requireSession();
  if (denied) return denied;

  try {
    return NextResponse.json({ schedules: await listSchedules() });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * Saves a loop, creating it when the body carries no id.
 *
 * The WordPress credentials are attached here rather than typed into the form,
 * for the same reason a run does not ask for them: this app is where sites are
 * managed, and a loop for a site whose login is already saved should not make
 * anyone paste it a second time. A loop for a site with no saved login is
 * refused — it would run every night and skip every page for want of a
 * password, which is a worse outcome than being told now.
 */
export async function POST(request: Request) {
  const denied = await requireSession();
  if (denied) return denied;

  const session = await auth();
  const actor = session?.user?.name ?? "unknown";

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const websiteUrl = String(body.website_url ?? "").trim();
    if (!websiteUrl) {
      return NextResponse.json({ error: "A website URL is required." }, { status: 400 });
    }

    const credentials = await credentialsFor(websiteUrl);
    if (!credentials && !body.id) {
      return NextResponse.json(
        {
          error:
            "No WordPress login is saved for that site. Add one on the Runs page first, " +
            "or this loop would run every night and publish nothing.",
        },
        { status: 400 },
      );
    }

    const body_classes: Record<string, string[]> = {};
    const declared = (body.body_classes ?? {}) as Record<string, unknown>;
    for (const key of DECLARABLE_CLASSES) {
      const names = parseBodyClassList(declared[key]);
      if (names.length) body_classes[key] = names;
    }

    const saved = await saveSchedule({
      ...body,
      body_classes,
      exclude_paths: String(body.exclude_paths ?? "")
        .split(/[\n,]/)
        .map((v) => v.trim())
        .filter(Boolean),
      ...(credentials
        ? { wp_username: credentials.username, wp_password: credentials.password }
        : {}),
    });

    await record(
      actor,
      body.id ? "schedule-updated" : "schedule-created",
      `${saved.name} — ${saved.mode === "gap" ? "gap filler" : "optimiser"} on ${saved.website_url}, ` +
        `every ${saved.everyHours}h`,
    );

    return NextResponse.json({ schedule: saved });
  } catch (error) {
    return errorResponse(error);
  }
}
