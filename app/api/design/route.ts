import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { errorResponse, requireSession } from "@/lib/api-guard";
import { getPalette, savePalette, TOKENS } from "@/lib/palette";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await requireSession();
  if (denied) return denied;

  try {
    // The tokens travel with the palette rather than being imported by the
    // page. They carry the defaults, and a default that reached the browser by
    // a second route could disagree with the one the server saves against.
    return NextResponse.json({ palette: await getPalette(), tokens: TOKENS });
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
    const palette = await savePalette(await request.json(), actor);
    return NextResponse.json({ palette });
  } catch (error) {
    return errorResponse(error);
  }
}
