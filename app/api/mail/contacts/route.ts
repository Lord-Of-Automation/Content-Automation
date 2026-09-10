import { NextResponse } from "next/server";

import { errorResponse, requireSession } from "@/lib/api-guard";
import { mailContacts } from "@/lib/mail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** The prospects that have an address, and whether each has been written to. */
export async function GET(request: Request) {
  const denied = await requireSession();
  if (denied) return denied;

  const asked = new URL(request.url).searchParams;
  try {
    return NextResponse.json({
      contacts: await mailContacts(asked.get("sheet") ?? "", asked.get("tab") ?? ""),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
