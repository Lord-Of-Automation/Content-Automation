import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { currentUser } from "./actor";
import { N8nConfigError } from "./n8n";
import { EngineConfigError, RunNotFoundError } from "./engine";
import { PERMISSIONS } from "./permissionlist";
import { may } from "./permissions";

export async function requireSession(): Promise<NextResponse | null> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  return null;
}

/**
 * A session, and the permission this route belongs to.
 *
 * Most routes stop at requireSession, because most permissions are only
 * enforced by which pages the menu offers. A route that spends money on
 * instructions nobody has run before cannot rely on that: the address works
 * whether or not the link is shown, so it checks for itself.
 *
 * The refusal names the permission in the words the Accounts page uses, so
 * whoever reads it knows what to ask for.
 */
export async function requirePermission(permission: string): Promise<NextResponse | null> {
  const denied = await requireSession();
  if (denied) return denied;

  if (await may(await currentUser(), permission)) return null;

  const label = PERMISSIONS.find((one) => one.id === permission)?.label ?? permission;
  return NextResponse.json(
    { error: `You are not allowed to use ${label}. Ask an admin to grant it.` },
    { status: 403 }
  );
}

/** Turns a thrown error into a response the UI can actually act on. */
export function errorResponse(error: unknown): NextResponse {
  if (error instanceof N8nConfigError || error instanceof EngineConfigError) {
    return NextResponse.json(
      { error: error.message, kind: "config" },
      { status: 500 }
    );
  }

  // A run the backend has never heard of is not a gateway failure. It happens
  // routinely after switching RUN_BACKEND, because each side issues its own
  // ids and the console remembers the last one it was looking at.
  if (error instanceof RunNotFoundError) {
    return NextResponse.json(
      { error: error.message, kind: "not-found" },
      { status: 404 }
    );
  }

  const message =
    error instanceof Error ? error.message : "Something went wrong.";

  return NextResponse.json({ error: message, kind: "upstream" }, { status: 502 });
}
