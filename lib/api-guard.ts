import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { N8nConfigError } from "./n8n";

export async function requireSession(): Promise<NextResponse | null> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  return null;
}

/** Turns a thrown error into a response the UI can actually act on. */
export function errorResponse(error: unknown): NextResponse {
  if (error instanceof N8nConfigError) {
    return NextResponse.json(
      { error: error.message, kind: "config" },
      { status: 500 }
    );
  }

  const message =
    error instanceof Error ? error.message : "Something went wrong.";

  return NextResponse.json({ error: message, kind: "upstream" }, { status: 502 });
}
