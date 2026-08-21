import { NextResponse } from "next/server";

import { errorResponse, requireSession } from "@/lib/api-guard";
import { executionUrl, getExecution } from "@/lib/n8n";

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

  if (!/^\d+$/.test(id)) {
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
