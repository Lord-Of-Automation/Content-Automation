import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { errorResponse, requireSession } from "@/lib/api-guard";
import { addAccount, listAccounts } from "@/lib/accounts";
import { record } from "@/lib/audit";
import { adminUser } from "@/lib/actor";
import { may, permissionsFor, restrictionsApply, setPermissions } from "@/lib/permissions";
import { PERMISSIONS } from "@/lib/permissionlist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await requireSession();
  if (denied) return denied;

  try {
    const accounts = await listAccounts();
    return NextResponse.json({
      accounts,
      // What each of them may do, and the list of everything that can be
      // granted. Both travel with the accounts because the page is useless
      // without either and a second request would be a second chance to be
      // looking at a stale answer.
      permissions: await permissionsFor(accounts),
      catalogue: PERMISSIONS,
      admin: adminUser(),
      // Whether any of the above is being enforced. Nobody with full access
      // means nobody to enforce it on behalf of, so everybody has everything
      // and the page has to say so.
      inCharge: await restrictionsApply(),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Changing what one account may do. */
export async function PUT(request: Request) {
  const denied = await requireSession();
  if (denied) return denied;

  const session = await auth();
  const actor = session?.user?.name ?? "unknown";

  // Only somebody who may change permissions can change permissions. Without
  // this the page is a suggestion, since the request behind it is one anybody
  // signed in could make by hand.
  if (!(await may(actor, "accounts"))) {
    return NextResponse.json(
      { error: "You are not allowed to change what people can do." },
      { status: 403 },
    );
  }

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const user = String(body.user ?? "").trim();
    const granted = Array.isArray(body.permissions) ? body.permissions.map(String) : [];

    const saved = await setPermissions(user, granted, actor);
    if (!saved.ok) return NextResponse.json({ error: saved.error }, { status: 400 });

    await record(actor, "permissions-changed", `${user}: ${granted.join(", ") || "nothing"}`);

    const accounts = await listAccounts();
    return NextResponse.json({
      accounts,
      permissions: await permissionsFor(accounts),
      inCharge: await restrictionsApply(),
    });
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
  await record(
    session?.user?.name ?? "unknown",
    "account-created",
    `Created "${result.username}"` +
      (result.persisted ? "" : " (not saved: read-only filesystem)")
  );

  return NextResponse.json(result);
}
