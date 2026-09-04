import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { errorResponse, requireSession } from "@/lib/api-guard";
import {
  addToGroup, deleteDomainGroup, listDomainGroups, removeFromGroup,
} from "@/lib/domaingroups";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await requireSession();
  if (denied) return denied;

  try {
    return NextResponse.json({ groups: await listDomainGroups() });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request) {
  const denied = await requireSession();
  if (denied) return denied;

  const session = await auth();
  const actor = session?.user?.name ?? "unknown";

  let body: { id?: string; name?: string; domains?: string[]; remove?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  try {
    const result = body.remove
      ? await removeFromGroup(String(body.id ?? ""), body.domains ?? [], actor)
      : await addToGroup(
          { id: body.id, name: body.name, domains: body.domains ?? [] },
          actor,
        );

    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ ...result, groups: await listDomainGroups() });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  const denied = await requireSession();
  if (denied) return denied;

  try {
    const body = (await request.json()) as { id?: string };
    await deleteDomainGroup(String(body.id ?? ""));
    return NextResponse.json({ groups: await listDomainGroups() });
  } catch (error) {
    return errorResponse(error);
  }
}
