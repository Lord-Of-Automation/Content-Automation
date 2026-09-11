import { NextResponse } from "next/server";

import { errorResponse, requireSession } from "@/lib/api-guard";
import { threadImage } from "@/lib/mail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One picture out of one conversation, as bytes.
 *
 * Bytes rather than JSON, so the page can point an img at this and let the
 * browser do what browsers do with pictures: fetch it when it scrolls into
 * view, decode it off the main thread, and keep it. Base64 in a JSON payload
 * would be a third larger, would go through the React tree, and would be
 * fetched again every time the conversation was opened.
 *
 * The engine decides whether this picture may be read at all: the address has
 * to be a conversation it started, and the message and picture have to be in
 * it. Nothing is checked twice here, because a second opinion that disagreed
 * would only be a way to get the answer wrong.
 */
export async function GET(request: Request) {
  const denied = await requireSession();
  if (denied) return denied;

  const asked = new URL(request.url).searchParams;
  const email = String(asked.get("email") ?? "").trim().toLowerCase();
  const message = String(asked.get("message") ?? "").trim();
  const id = String(asked.get("id") ?? "").trim();

  if (!email || !message || !id) {
    return NextResponse.json({ error: "No picture was named." }, { status: 400 });
  }

  try {
    const picture = await threadImage(email, message, id);
    const bytes = Buffer.from(picture.data, "base64");

    return new Response(new Uint8Array(bytes), {
      headers: {
        "content-type": picture.mime,
        "content-length": String(bytes.length),
        /*
         * Kept for a while, and privately.
         *
         * The bytes never change — Gmail's id for an attachment names those
         * exact bytes — so re-fetching on every open is pure waste. Private
         * because this is somebody's mail and a shared cache in front of this
         * console must not hold a copy.
         */
        "cache-control": "private, max-age=3600",
        // Shown, never run. Whatever a publisher sent is displayed as a
        // picture and nothing else, whatever the file turns out to contain.
        "content-disposition": "inline",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
