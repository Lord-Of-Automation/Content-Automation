import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { record } from "@/lib/audit";
import { errorResponse, requireSession } from "@/lib/api-guard";
import { credentialsFor, normaliseDomain } from "@/lib/sites";
import { listMedia, uploadMedia, WordPressError } from "@/lib/wordpress";
import { getWebsite } from "@/lib/websites";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * A site's pictures, which live where the site does.
 *
 * The console keeps none of its own. Every generated site is published into
 * WordPress, and WordPress has had a media library, thumbnails and srcset since
 * long before we turned up; a second copy here would mean two places to keep in
 * step, a bill, and pictures served from somewhere other than the page showing
 * them.
 *
 * What it costs is that a site with nowhere to be published has nowhere to put
 * a picture either. That is said plainly rather than worked around, which is
 * what the `connected` answer below is for.
 */
function idOf(value: string): string | null {
  return /^[\w-]{1,64}$/.test(value) ? value : null;
}

/**
 * The largest file that can reach WordPress through here.
 *
 * A serverless function refuses a request body over four and a half megabytes,
 * at the infrastructure level, whatever the code says. The password for the
 * far end must never reach the browser, so the file has to come this way, so
 * the limit is real. Said out loud in the editor rather than discovered as a
 * failure part way through an upload.
 */
const MOST = 4_400_000;

/** Where this website's pictures live, and whether we may reach it. */
async function library(id: string) {
  const site = await getWebsite(id);
  if (!site) return { error: "No such website." as const };

  const address = site.published?.address ?? "";
  if (!address) {
    return {
      site,
      connected: false as const,
      why: "not-published" as const,
    };
  }

  const login = await credentialsFor(address);
  if (!login) {
    return {
      site,
      connected: false as const,
      why: "no-login" as const,
      domain: normaliseDomain(address) ?? address,
    };
  }

  return { site, connected: true as const, address, login };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireSession();
  if (denied) return denied;

  const { id } = await params;
  if (!idOf(id)) return NextResponse.json({ error: "Bad id." }, { status: 400 });

  try {
    const found = await library(id);
    if ("error" in found) return NextResponse.json({ error: found.error }, { status: 404 });

    if (!found.connected) {
      return NextResponse.json({
        connected: false,
        why: found.why,
        domain: "domain" in found ? found.domain : "",
        limit: MOST,
      });
    }

    const url = new URL(request.url);
    const page = await listMedia(found.address, found.login.username, found.login.password, {
      search: url.searchParams.get("search") ?? "",
      page: Number(url.searchParams.get("page") ?? 1),
    });

    return NextResponse.json({
      connected: true,
      where: found.site.published?.label ?? found.login.domain,
      limit: MOST,
      ...page,
    });
  } catch (error) {
    if (error instanceof WordPressError) {
      return NextResponse.json({ error: error.message }, { status: 502 });
    }
    return errorResponse(error);
  }
}

/**
 * Add a picture to the site's library.
 *
 * The file arrives as itself rather than wrapped in JSON, since encoding it
 * would make it a third larger for no reason and the limit above is tight
 * enough already.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireSession();
  if (denied) return denied;

  const { id } = await params;
  if (!idOf(id)) return NextResponse.json({ error: "Bad id." }, { status: 400 });

  const session = await auth();
  const actor = session?.user?.name ?? "unknown";

  try {
    const found = await library(id);
    if ("error" in found) return NextResponse.json({ error: found.error }, { status: 404 });

    if (!found.connected) {
      return NextResponse.json(
        {
          error:
            found.why === "not-published"
              ? "This website has not been published yet, so there is nowhere to put a picture."
              : "The site it was published to has no WordPress login saved.",
          why: found.why,
        },
        { status: 428 },
      );
    }

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file was sent." }, { status: 400 });
    }
    if (!/^image\//.test(file.type)) {
      return NextResponse.json(
        { error: `${file.type || "That"} is not a picture.` },
        { status: 400 },
      );
    }
    if (file.size > MOST) {
      return NextResponse.json(
        {
          error:
            `That file is ${(file.size / 1_000_000).toFixed(1)}MB and the most that can be ` +
            `sent through here is ${(MOST / 1_000_000).toFixed(1)}MB.`,
          tooBig: true,
        },
        { status: 413 },
      );
    }

    const made = await uploadMedia(found.address, found.login.username, found.login.password, {
      name: file.name || "image",
      type: file.type,
      bytes: await file.arrayBuffer(),
      alt: String(form.get("alt") ?? ""),
      title: String(form.get("title") ?? ""),
    });

    await record(actor, "website-edited", `Added ${made.url} to ${found.login.domain}`);
    return NextResponse.json({ item: made });
  } catch (error) {
    if (error instanceof WordPressError) {
      return NextResponse.json({ error: error.message }, { status: 502 });
    }
    return errorResponse(error);
  }
}
