import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { record } from "@/lib/audit";
import { errorResponse, requireSession } from "@/lib/api-guard";
import { listAllApplications } from "@/lib/hosting";
import { credentialsFor, normaliseDomain } from "@/lib/sites";
import {
  apiBase, checkSite, publishPage, setFrontPage, slugFor, WordPressError,
} from "@/lib/wordpress";
import { getWebsite, saveWebsite, type PublishedTo, type Website } from "@/lib/websites";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function idOf(value: string): string | null {
  return /^[\w-]{1,64}$/.test(value) ? value : null;
}

/**
 * Where a generated site can be published, and whether it is ready to be.
 *
 * Every application the connected hosts know about, paired with whether this
 * console holds a WordPress login for its domain. A host can say a site exists;
 * only the WordPress credential store can say whether we may write to it, and
 * the answer to "why is this greyed out" should be on the row rather than
 * discovered by pressing it.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireSession();
  if (denied) return denied;

  const { id } = await params;
  if (!idOf(id)) return NextResponse.json({ error: "Bad id." }, { status: 400 });

  try {
    const site = await getWebsite(id);
    if (!site) return NextResponse.json({ error: "No such website." }, { status: 404 });

    const [hosted, logins] = await Promise.all([
      listAllApplications(),
      import("@/lib/sites").then((m) => m.listSites()),
    ]);

    const known = new Map(logins.map((row) => [row.domain, row]));

    const targets = hosted.apps
      // A site with no address of any kind cannot be reached, so it cannot be
      // published to. Saying nothing about it beats offering it and failing.
      .filter((app) => app.domain || app.stagingUrl)
      .map((app) => {
        const address = app.domain || app.stagingUrl;
        const domain = normaliseDomain(address) ?? "";
        const login = known.get(domain);
        return {
          key: app.key,
          host: app.host,
          label: app.label,
          address,
          domain,
          platform: app.platform,
          place: app.placeLabel,
          /** Whether a WordPress login is on file for it. */
          ready: Boolean(login),
          username: login?.username ?? "",
          /** False when AUTH_SECRET changed and the stored password is lost. */
          readable: login?.readable ?? false,
        };
      })
      .sort((a, b) => Number(b.ready) - Number(a.ready) || a.label.localeCompare(b.label));

    return NextResponse.json({
      targets,
      sources: hosted.sources,
      connected: hosted.connected,
      published: site.published,
      /*
       * Where it went last time, as the list names places.
       *
       * Worked out here rather than in the browser, so the comparison uses the
       * same rule that decides which login belongs to which site: a site
       * published to one spelling of its address has to match the row offering
       * another.
       */
      publishedDomain: site.published ? normaliseDomain(site.published.address) ?? "" : "",
      pages: site.pages.map((p) => ({ slug: p.slug, title: p.title })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * Publishing, one step at a time.
 *
 * A site of a dozen pages is a dozen round trips to somebody else's WordPress,
 * which is comfortably longer than a serverless function is allowed to live. So
 * the console drives it: check the credentials, then one call per page, then
 * finish. That also means it can name the page it is on rather than showing a
 * spinner that ends either in a finished site or in nothing.
 *
 * Every step is separately authorised and separately safe to retry.
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

  let body: {
    step?: string;
    address?: string;
    slug?: string;
    status?: string;
    withDesign?: boolean;
    fullWidth?: boolean;
    fit?: string;
    asFront?: boolean;
    frontPageId?: number;
    host?: string;
    label?: string;
    pages?: Record<string, number>;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const address = String(body.address ?? "").trim();
  if (!address) return NextResponse.json({ error: "Publish to where?" }, { status: 400 });

  try {
    const site = await getWebsite(id);
    if (!site) return NextResponse.json({ error: "No such website." }, { status: 404 });

    if (site.status === "building") {
      return NextResponse.json(
        { error: "This site is still being written. Publishing now would send half of it." },
        { status: 409 },
      );
    }

    /*
     * The login for the target, from the store the runs already use.
     *
     * Never from the request. A credential that arrives in a publish call is a
     * credential in a log, in a browser's memory and in whatever sat between;
     * the store exists so that it travels once, to the Sites page, and never
     * again.
     */
    const login = await credentialsFor(address);
    if (!login) {
      return NextResponse.json(
        {
          error:
            `No WordPress login is saved for ${normaliseDomain(address) ?? address}. ` +
            `Add one on the Sites page: an application password from that site's ` +
            `Users screen, not the login password.`,
        },
        { status: 428 },
      );
    }

    if (body.step === "check") {
      const found = await checkSite(address, login.username, login.password);
      return NextResponse.json({ check: found });
    }

    if (body.step === "page") {
      const page = site.pages.find((p) => p.slug === String(body.slug ?? ""));
      if (!page) return NextResponse.json({ error: "No such page." }, { status: 404 });

      /*
       * The pages as WordPress will address them, for the navigation.
       *
       * A generated site links its pages by the slugs it gave them, and the
       * front page has none at all. WordPress serves a page at its own slug,
       * and serves the front page at the root only if it has been told which
       * page that is. So the navigation is built against what will actually be
       * there rather than against what the preview used.
       */
      const front = site.pages[0];
      const chromePages = site.pages.map((p) => ({
        ...p,
        slug:
          body.asFront && p === front ? "" : slugFor(p, site.name),
      }));

      const result = await publishPage({
        address,
        user: login.username,
        password: login.password,
        page,
        design: body.withDesign ? site.design : null,
        status: body.status === "publish" ? "publish" : "draft",
        fallbackSlug: site.name,
        fullWidth: Boolean(body.fullWidth),
        fit: body.fit === "canvas" ? "canvas" : "inside",
        // The palette and the column width, which is most of what makes a
        // published page look like the one that was previewed.
        theme: body.withDesign ? site.theme : undefined,
        /*
         * The site, so a page taking over from the theme brings the header and
         * footer it had in the preview.
         *
         * Its links are rewritten to the addresses WordPress will serve the
         * pages at, since the generated site addresses its pages by file and
         * WordPress addresses them by slug.
         */
        site:
          body.fit === "canvas" && body.withDesign
            ? { ...site, pages: chromePages }
            : undefined,
        chrome:
          body.fit === "canvas"
            ? { current: slugFor(page, site.name), year: new Date().getFullYear() }
            : undefined,
        // The site's own background, needed only when the theme's is hidden
        // along with everything else it draws.
        background: site.theme?.background ?? "",
        // Only when publishing to the same place as last time. An id from
        // another site is another site's page.
        knownId:
          site.published && normaliseDomain(site.published.address) === login.domain
            ? site.published.pages[page.slug]
            : undefined,
      });

      return NextResponse.json({ page: result });
    }

    if (body.step === "front") {
      const pageId = Number(body.frontPageId ?? 0);
      if (!pageId) return NextResponse.json({ error: "Which page?" }, { status: 400 });
      await setFrontPage(address, login.username, login.password, pageId);
      return NextResponse.json({ ok: true });
    }

    if (body.step === "finish") {
      const published: PublishedTo = {
        address: apiBase(address).replace(/\/wp-json$/, ""),
        host: String(body.host ?? ""),
        label: String(body.label ?? login.domain),
        pages: Object.fromEntries(
          Object.entries(body.pages ?? {}).map(([slug, pageId]) => [slug, Number(pageId)]),
        ),
        status: body.status === "publish" ? "publish" : "draft",
        withDesign: Boolean(body.withDesign),
        fit:
          body.fit === "canvas" ? "canvas" : body.withDesign ? "inside" : "theme",
        at: new Date().toISOString(),
        by: actor,
      };

      const updated: Website = { ...site, published };
      await saveWebsite(updated);
      await record(
        actor,
        "website-published",
        `${site.name} to ${published.label}, ` +
          `${Object.keys(published.pages).length} page(s), ${published.status}`,
      );

      return NextResponse.json({ website: updated });
    }

    return NextResponse.json({ error: "Unknown step." }, { status: 400 });
  } catch (error) {
    // A refusal from the far end is the target's answer, not this console
    // falling over, and deserves its own status rather than a 500.
    if (error instanceof WordPressError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status === 401 || error.status === 403 ? 401 : 502 },
      );
    }
    return errorResponse(error);
  }
}
