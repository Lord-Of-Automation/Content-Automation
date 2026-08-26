import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { N8nConfigError } from "./n8n";
import { EngineConfigError, RunNotFoundError } from "./engine";

export async function requireSession(): Promise<NextResponse | null> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  return null;
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
