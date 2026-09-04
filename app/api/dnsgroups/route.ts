import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { errorResponse, requireSession } from "@/lib/api-guard";
import { deleteGroup, listGroups, saveGroup, STARTER } from "@/lib/dnsgroups";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await requireSession();
  if (denied) return denied;

  try {
    const groups = await listGroups();
    // The starter is offered rather than saved, so an untouched installation
    // shows the shape of a group without pretending somebody made one.
    return NextResponse.json({ groups, starter: groups.length ? [] : STARTER });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request) {
  const denied = await requireSession();
  if (denied) return denied;

  const session = await auth();
  const actor = session?.user?.name ?? "unknown";

  try {
    const body = await request.json();
    const result = await saveGroup(body, actor);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ groups: await listGroups(), id: result.id });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  const denied = await requireSession();
  if (denied) return denied;

  try {
    const body = (await request.json()) as { id?: string };
    await deleteGroup(String(body.id ?? ""));
    return NextResponse.json({ groups: await listGroups() });
  } catch (error) {
    return errorResponse(error);
  }
}
