import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { record } from "@/lib/audit";
import { errorResponse, requireSession } from "@/lib/api-guard";
import { fileOf, renderPage } from "@/lib/siteshell";
import { getWebsite } from "@/lib/websites";
import { zip } from "@/lib/zip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The whole site, as files you can open.
 *
 * The same renderer the preview uses, so what downloads is what was on screen.
 * Addresses are written as filenames rather than paths, because an export is
 * opened from a folder where "/about" is not a file and "/" is not a page —
 * this way the site works when double-clicked, with no server involved.
 *
 * Useful for a WordPress site too, even though its theme will supply its own
 * header and footer. It is the only way to read the whole thing offline, hand
 * it to somebody for approval, or keep a copy of what was written.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireSession();
  if (denied) return denied;

  const { id } = await params;
  if (!/^[\w-]{1,64}$/.test(id)) {
    return NextResponse.json({ error: "Bad id." }, { status: 400 });
  }

  const session = await auth();
  const actor = session?.user?.name ?? "unknown";

  try {
    const site = await getWebsite(id);
    if (!site) return NextResponse.json({ error: "No such website." }, { status: 404 });
    if (!site.pages.length) {
      return NextResponse.json({ error: "That website has no pages yet." }, { status: 400 });
    }

    const year = new Date().getFullYear();
    const files = site.pages.map((page) => ({
      name: fileOf(page),
      content: renderPage(site, page, { current: page.slug, asFiles: true, year }),
    }));

    // A file saying what this is and what it is not, because an export handed
    // to somebody else arrives with no context at all.
    files.push({
      name: "README.txt",
      content: [
        site.name,
        site.tagline,
        "",
        `${site.pages.length} page(s), written for: ${site.topic}`,
        `Built as: ${site.format === "wordpress" ? "WordPress" : "static HTML"}`,
        "",
        "Open index.html to read it. Every page links to the others by",
        "filename, so this works from a folder without a web server.",
        site.format === "wordpress"
          ? "\nThis site is meant for WordPress, where the theme supplies the\nheader and footer. The ones here stand in for those."
          : "",
      ]
        .filter(Boolean)
        .join("\n"),
    });

    const archive = zip(files);
    const safe = site.name.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "website";

    await record(actor, "website-exported", `${site.name}, ${site.pages.length} page(s)`);

    return new NextResponse(new Uint8Array(archive), {
      headers: {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="${safe}.zip"`,
        "content-length": String(archive.length),
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
