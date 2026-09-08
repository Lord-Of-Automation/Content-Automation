/**
 * Publishing a generated site into a WordPress site.
 *
 * Of everything the connected hosts offer, this is the one road that reaches
 * all of them. Cloudways has no endpoint that will take a file: no upload, no
 * git, nothing that writes to a disk — its API manages applications, not their
 * contents. Hostinger does have one, but only for its own sites. WordPress, on
 * the other hand, is what nearly every application on both hosts is running,
 * and WordPress has had a write API in core since 4.7.
 *
 * So this talks to WordPress rather than to a host, and works the same whether
 * the site sits on Cloudways, on Hostinger, or somewhere neither of them knows
 * about.
 *
 * ---
 *
 * Authentication is an application password: a credential WordPress issues per
 * application, revocable on its own, and the mechanism core added precisely so
 * that integrations stop asking people for their login. It is sent as HTTP
 * Basic, which WordPress only accepts over HTTPS, which is why every address
 * here is forced to it.
 *
 * The admin password this console already shows for a Cloudways application is
 * deliberately not used. It is the login password, WordPress will not accept it
 * over the API, and an integration that hoards the password to the whole site
 * when a scoped one exists is doing it wrong.
 *
 * ---
 *
 * A page is matched by slug before it is written, and the id it comes back with
 * is remembered. Publishing the same site twice updates the same pages rather
 * than making a second copy of each, which is the difference between a feature
 * and a mess somebody has to clean up by hand.
 */

import { scopeCss } from "./cssscope";
import type { SiteDesign, WebsitePage } from "./websites";

/** The class the published content sits inside, and what its CSS is confined to. */
export const WRAP_CLASS = "ca-site";

/**
 * How many times the wrapper is repeated in every selector.
 *
 * `.ca-site.ca-site.ca-site h2` matches exactly what `.ca-site h2` matches — an
 * element only has to carry the class once — but it counts as three classes
 * when the browser decides which rule wins.
 *
 * That is the whole problem with publishing a design into somebody's theme. The
 * generated stylesheet loads after the theme's, so on a tie it wins; but a
 * theme does not write `h2`, it writes `.entry-content h2` or
 * `.wp-site-blocks .entry-content h2`, and specificity is settled before order
 * is ever consulted. One class against three loses every time, and the page
 * arrives wearing the theme's headings.
 *
 * Three is enough to clear the selectors themes actually use, and ties still
 * fall our way on order. It is also reversible in a way `!important` is not: a
 * person editing the page in WordPress afterwards can still override any of it
 * from the theme's own customiser, which is not true once every declaration
 * shouts.
 */
const WEIGHT = 3;

/** `.ca-site.ca-site.ca-site` — the selector every scoped rule is built on. */
export const SCOPE = `.${WRAP_CLASS}`.repeat(WEIGHT);

/**
 * Undo what a theme does to the box our content lands in.
 *
 * A theme wraps post content in something of its own — `.entry-content`, or a
 * block theme's constrained layout — and that box carries a width, a padding
 * and often a margin. A generated design brings its own idea of how wide it
 * should be, and cannot express it from inside a box already narrowed to
 * something else.
 *
 * Emitted before the design's own rules and at the same weight, so anything the
 * design says about the same properties wins on order, and everything the theme
 * says loses on specificity.
 */
function normalise(fullWidth: boolean): string {
  const base =
    `${SCOPE}{max-width:none;width:auto;float:none;clear:both;` +
    `margin-left:auto;margin-right:auto;padding-left:0;padding-right:0}`;

  if (!fullWidth) return base;

  /*
   * Escaping the theme's column entirely.
   *
   * Some designs are built to run edge to edge — a full-bleed hero, a footer
   * band in a colour. Inside a theme's seven-hundred-pixel column they read as
   * a narrow strip of something that was meant to be a page.
   *
   * The margin trick rather than a transform: a transform makes the wrapper a
   * containing block, which quietly breaks anything positioned fixed inside it.
   * `clip` rather than `hidden` so the page can still be scrolled to the side
   * on a narrow screen without the browser inventing a scrollbar for it.
   */
  return (
    `${SCOPE}{max-width:none;float:none;clear:both;` +
    `width:100vw;margin-left:calc(50% - 50vw);margin-right:calc(50% - 50vw);` +
    `padding-left:0;padding-right:0;overflow-x:clip}`
  );
}

export class WordPressError extends Error {
  readonly status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.name = "WordPressError";
    this.status = status;
  }
}

/**
 * Turn whatever somebody typed into the address of a WordPress API.
 *
 * People paste "example.com", "https://example.com/", "example.com/wp-admin"
 * and "https://example.com/wp-json/". All of them mean the same site.
 */
export function apiBase(raw: string): string {
  let value = raw.trim();
  if (!value) throw new WordPressError("No address for the site.");

  if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
  // Application passwords are refused over plain HTTP, so there is no point
  // trying: it would fail later and less clearly.
  value = value.replace(/^http:\/\//i, "https://");

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new WordPressError(`"${raw}" is not an address.`);
  }

  const path = url.pathname
    .replace(/\/(wp-json|wp-admin|wp-login\.php)\/?.*$/i, "")
    .replace(/\/+$/, "");

  return `${url.origin}${path}/wp-json`;
}

async function call(
  base: string,
  path: string,
  auth: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<unknown> {
  const { json, ...rest } = init;

  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
      ...rest,
      headers: {
        authorization: auth,
        accept: "application/json",
        ...(json === undefined ? {} : { "content-type": "application/json" }),
        ...(rest.headers ?? {}),
      },
      body: json === undefined ? rest.body : JSON.stringify(json),
      cache: "no-store",
      redirect: "follow",
      signal: AbortSignal.timeout(45_000),
    });
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    throw new WordPressError(`${base} did not answer: ${why}`);
  }

  const text = await response.text();
  let body: Record<string, unknown> | unknown[] | null = null;
  try {
    body = JSON.parse(text);
  } catch {
    // Some hosts answer a blocked API with an HTML error page. Saying so beats
    // reporting a JSON parse failure nobody can act on.
  }

  if (!response.ok) {
    const said =
      body && !Array.isArray(body) && typeof body.message === "string"
        ? body.message
        : text.slice(0, 200).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

    if (response.status === 401 || response.status === 403) {
      throw new WordPressError(
        `WordPress refused the credentials${said ? `: ${said}` : "."} ` +
          `Check the username and that the application password has not been revoked.`,
        response.status,
      );
    }
    if (response.status === 404) {
      throw new WordPressError(
        `WordPress has no API at ${base}. Either the address is wrong or the ` +
          `REST API is disabled on that site.`,
        404,
      );
    }
    throw new WordPressError(
      `WordPress answered ${response.status}${said ? `: ${said}` : ""}`,
      response.status,
    );
  }

  if (body === null) {
    throw new WordPressError(
      `${base} answered with something that is not JSON, so it is probably not ` +
        `a WordPress API.`,
    );
  }
  return body;
}

function basic(user: string, password: string): string {
  // Application passwords are shown with spaces for readability. WordPress
  // strips them itself, but only sometimes, so they go before they are sent.
  const clean = password.replace(/\s+/g, "");
  return `Basic ${Buffer.from(`${user}:${clean}`, "utf8").toString("base64")}`;
}

export interface SiteCheck {
  ok: boolean;
  /** The site's own name, so somebody can confirm they picked the right one. */
  name: string;
  description: string;
  /** Who the credentials belong to. */
  who: string;
  /** Whether that account may publish pages, rather than only write drafts. */
  canPublish: boolean;
  /** Whether it may keep style and script in page content. */
  canKeepMarkup: boolean;
  home: string;
  base: string;
}

/**
 * Confirm the address, the credentials and what they are allowed to do.
 *
 * Run before anything is written. A publish that fails on page four because the
 * account cannot publish has already made three pages nobody asked for.
 */
export async function checkSite(
  address: string,
  user: string,
  password: string,
): Promise<SiteCheck> {
  const base = apiBase(address);
  const auth = basic(user, password);

  const root = (await call(base, "/", auth)) as Record<string, unknown>;
  const me = (await call(base, "/wp/v2/users/me?context=edit", auth)) as {
    name?: string;
    slug?: string;
    capabilities?: Record<string, boolean>;
  };

  const can = me.capabilities ?? {};

  return {
    ok: true,
    name: String(root.name ?? "").trim(),
    description: String(root.description ?? "").trim(),
    who: String(me.name ?? me.slug ?? user),
    canPublish: can.publish_pages === true || can.administrator === true,
    canKeepMarkup: can.unfiltered_html === true || can.administrator === true,
    home: String(root.home ?? "").trim(),
    base,
  };
}

export interface PageResult {
  slug: string;
  title: string;
  /** The WordPress page id, so the next publish updates rather than duplicates. */
  id: number;
  link: string;
  created: boolean;
  /** What could not be done but did not stop the page being written. */
  warnings: string[];
}

/**
 * The content of one page, as WordPress should hold it.
 *
 * The design travels with the page rather than being installed on the site: a
 * generated site's stylesheet inside a `<style>` tag, every selector confined
 * to a wrapper the content sits in. It cannot be a theme, and it must not be
 * allowed to reach the theme, so it is neither.
 *
 * Confined, but not thereby weaker than the theme it is landing beside. Every
 * selector is weighted so it outranks what a theme writes about the same
 * elements — see SCOPE — because a design that loses every argument with the
 * theme is not a design that was published.
 *
 * Passing `design` as null publishes the words alone, so the pages take on the
 * look of the site they are joining. That is the right answer when the pages
 * are being added to somewhere that already exists, and the wrong one when the
 * generated site is the point.
 */
export function pageContent(
  page: WebsitePage,
  design: SiteDesign | null,
  options: { fullWidth?: boolean } = {},
): string {
  const body = `<div class="${WRAP_CLASS}">\n${page.bodyHtml}\n</div>`;
  if (!design?.css?.trim()) return body;

  const css = scopeCss(design.css, SCOPE);
  return `<style>\n${normalise(Boolean(options.fullWidth))}\n${css}\n</style>\n${body}`;
}

/** WordPress needs a slug; the front page's is empty here. */
export function slugFor(page: WebsitePage, fallback: string): string {
  const slug = page.slug.trim().replace(/^\/+|\/+$/g, "");
  if (slug) return slug;
  return (
    fallback
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "home"
  );
}

export interface PublishOne {
  address: string;
  user: string;
  password: string;
  page: WebsitePage;
  design: SiteDesign | null;
  /** Live, or waiting for somebody to look at it first. */
  status: "publish" | "draft";
  /** The slug to use when the page has none, which is the front page. */
  fallbackSlug: string;
  /** Whether the design may break out of the theme's content column. */
  fullWidth?: boolean;
  /** A page id from a previous publish, tried before searching by slug. */
  knownId?: number;
}

/**
 * Write one page, and say what happened to it.
 *
 * One page per call rather than a whole site per call. A site of a dozen pages
 * is a dozen round trips to somebody else's server, which is longer than a
 * serverless function is allowed to live; and doing them one at a time means
 * the console can show which page it is on instead of a spinner that either
 * ends in a finished site or in nothing.
 */
export async function publishPage(options: PublishOne): Promise<PageResult> {
  const base = apiBase(options.address);
  const auth = basic(options.user, options.password);
  const slug = slugFor(options.page, options.fallbackSlug);

  /*
   * Find it before writing it.
   *
   * By remembered id first, since a page whose slug was edited here should
   * still update the page it came from rather than leave the old one behind and
   * make a new one. By slug second, which also catches a page somebody made by
   * hand at the address we are about to use.
   */
  let existing = 0;
  if (options.knownId) {
    try {
      const found = (await call(base, `/wp/v2/pages/${options.knownId}?context=edit`, auth)) as {
        id?: number;
        status?: string;
      };
      if (found.id && found.status !== "trash") existing = found.id;
    } catch {
      // Deleted since, or never ours. Fall through to the slug.
    }
  }

  if (!existing) {
    const matches = (await call(
      base,
      `/wp/v2/pages?slug=${encodeURIComponent(slug)}&status=any&per_page=1&context=edit`,
      auth,
    )) as Array<{ id?: number }>;
    if (Array.isArray(matches) && matches[0]?.id) existing = matches[0].id;
  }

  const payload: Record<string, unknown> = {
    title: options.page.title,
    slug,
    content: pageContent(options.page, options.design, { fullWidth: options.fullWidth }),
    excerpt: options.page.metaDescription,
    status: options.status,
    menu_order: options.page.order,
  };

  const written = (await call(
    base,
    existing ? `/wp/v2/pages/${existing}` : "/wp/v2/pages",
    auth,
    { method: "POST", json: payload },
  )) as { id?: number; link?: string };

  if (!written.id) {
    throw new WordPressError("WordPress accepted the page but did not say which one it is.");
  }

  const warnings: string[] = [];

  /*
   * The meta title and description, for whichever SEO plugin is installed.
   *
   * Attempted rather than required, and separately, so that a site without Yoast
   * or Rank Math still gets its pages. WordPress ignores meta keys nothing has
   * registered, so sending both costs one request and no harm.
   */
  const seo = {
    _yoast_wpseo_title: options.page.metaTitle,
    _yoast_wpseo_metadesc: options.page.metaDescription,
    rank_math_title: options.page.metaTitle,
    rank_math_description: options.page.metaDescription,
  };
  if (options.page.metaTitle || options.page.metaDescription) {
    try {
      await call(base, `/wp/v2/pages/${written.id}`, auth, {
        method: "POST",
        json: { meta: seo },
      });
    } catch (error) {
      warnings.push(
        `The meta title and description were not set: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  return {
    slug,
    title: options.page.title,
    id: written.id,
    link: String(written.link ?? ""),
    created: !existing,
    warnings,
  };
}

/**
 * Point the site's front page at one of the published pages.
 *
 * Optional and asked for explicitly, because it changes what visitors see when
 * they type the domain — which is the single most consequential thing this can
 * do to a site that already exists.
 */
export async function setFrontPage(
  address: string,
  user: string,
  password: string,
  pageId: number,
): Promise<void> {
  const base = apiBase(address);
  await call(base, "/wp/v2/settings", basic(user, password), {
    method: "POST",
    json: { show_on_front: "page", page_on_front: pageId },
  });
}
