import { NextResponse } from "next/server";

import { errorResponse, requireSession } from "@/lib/api-guard";
import { listExecutions, startRun } from "@/lib/n8n";
import { validateRunInput } from "@/lib/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const denied = await requireSession();
  if (denied) return denied;

  try {
    const executions = await listExecutions(25);
    return NextResponse.json({ executions });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  const denied = await requireSession();
  if (denied) return denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = validateRunInput(body);
  if (!parsed.ok) {
    return NextResponse.json(
      { error: "Check the highlighted fields.", fieldErrors: parsed.errors },
      { status: 400 }
    );
  }

  try {
    const result = await startRun(parsed.value);
    return NextResponse.json({ ...result, input: parsed.value });
  } catch (error) {
    return errorResponse(error);
  }
}
