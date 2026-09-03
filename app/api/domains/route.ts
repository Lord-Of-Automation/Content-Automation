import { NextResponse } from "next/server";

import { errorResponse, requireSession } from "@/lib/api-guard";
import { listAllDomains } from "@/lib/domains";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Two registrars, each paging and pricing per extension, and Gandi wants a
// request per domain for its name servers.
export const maxDuration = 90;

export async function GET() {
  const denied = await requireSession();
  if (denied) return denied;

  try {
    // No try/catch around each reader here: listAllDomains already turns one
    // registrar failing into a note beside the others, so an error reaching
    // this line means something wider went wrong.
    return NextResponse.json(await listAllDomains());
  } catch (error) {
    return errorResponse(error);
  }
}
