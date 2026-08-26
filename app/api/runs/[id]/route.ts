import { NextResponse } from "next/server";

import { errorResponse, requireSession } from "@/lib/api-guard";
import { executionUrl, getExecution } from "@/lib/backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Pulling includeData=true can be slow on a run carrying base64 screenshots.
export const maxDuration = 60;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireSession();
  if (denied) return denied;

  const { id } = await params;

  // n8n ids are numeric; engine ids are a timestamp and a salt. Accept both,
  // or every engine run reads as a bad id.
  if (!/^[\w.-]{1,64}$/.test(id)) {
    return NextResponse.json({ error: "Bad execution id." }, { status: 400 });
  }

  try {
    const execution = await getExecution(id);
    return NextResponse.json({
      execution,
      n8nUrl: executionUrl(id),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
