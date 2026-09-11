import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { errorResponse, requireSession } from "@/lib/api-guard";
import { getPalette, savePalette, TOKENS } from "@/lib/palette";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await requireSession();
  if (denied) return denied;

  const session = await auth();

  try {
    // The tokens travel with the palette rather than being imported by the
    // page. They carry the defaults, and a default that reached the browser by
    // a second route could disagree with the one the server saves against.
    //
    // The palette is the signed-in account's own. Nobody else's is readable
    // through here, which is the point of it being theirs.
    return NextResponse.json({
      palette: await getPalette(session?.user?.name),
      tokens: TOKENS,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request) {
  const denied = await requireSession();
  if (denied) return denied;

  const session = await auth();
  const who = session?.user?.name ?? "";

  try {
    const palette = await savePalette(await request.json(), who);
    return NextResponse.json({ palette });
  } catch (error) {
    return errorResponse(error);
  }
}
