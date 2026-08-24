import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { errorResponse, requireSession } from "@/lib/api-guard";
import { addAccount, listAccounts } from "@/lib/accounts";
import { record } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await requireSession();
  if (denied) return denied;

  try {
    return NextResponse.json({ accounts: listAccounts() });
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

  const input = (body ?? {}) as Record<string, unknown>;
  const username = typeof input.username === "string" ? input.username : "";
  const password =
    typeof input.password === "string" && input.password.length
      ? input.password
      : null;

  const result = await addAccount(username, password);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  const session = await auth();
  record(
    session?.user?.name ?? "unknown",
    "account-created",
    `Created "${result.username}"` +
      (result.persisted ? "" : " (not saved: read-only filesystem)")
  );

  return NextResponse.json(result);
}
