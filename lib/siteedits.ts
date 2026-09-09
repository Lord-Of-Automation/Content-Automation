/**
 * The edits Claude is allowed to make to a generated website, and what they do.
 *
 * The visual editor already lets somebody change anything by hand. This is the
 * same set of changes reached by describing them instead, which matters for the
 * ones that are tedious rather than hard: the same disclaimer on nine pages, a
 * heading style applied throughout, a tone made less breathless everywhere.
 *
 * Three rules shape the list.
 *
 * It cannot see the whole site at once. A site of twenty pages with long bodies
 * is more than is worth putting in front of a model on every message, so the
 * pages arrive as a list of names and are read one at a time. That costs a turn
 * per page and buys a feature that works on a large site rather than one that
 * works until a site gets big.
 *
 * It writes to a copy. Nothing here touches storage; the caller decides whether
 * to keep the result, and keeps the version it replaced when it does. So a
 * conversation that goes wrong costs a revision to undo rather than the site.
 *
 * It cannot touch how the site was made. The brief, the topic, the run that
 * wrote it and where it was published are the record of its making, and a site
 * claiming to have been built from something it was not is worse than a site
 * with an awkward heading.
 */

import {
  cleanFooter, cleanHeader, cleanPage, cleanTheme, type Website, type WebsitePage,
} from "./websites";

/** What one accepted tool call did, in the words the person will read. */
export interface EditNote {
  tool: string;
  said: string;
}

export type ToolResult = { ok: true; said: string } | { ok: false; said: string };

/**
 * The tools, as the model is shown them.
 *
 * Descriptions do the work here. A tool named write_page with no description
 * gets used for everything including the things a narrower tool does better,
 * so each one says what it is for and, where it matters, what it is not for.
 */
export const SITE_TOOLS = [
  {
    name: "list_pages",
    description:
      "List every page on the site: its slug, title, menu order and how long " +
      "its body is. Costs nothing and reads nothing. Call it first when a " +
      "request could touch more than one page, or when you are not certain " +
      "which page somebody means.",
    input_schema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "read_page",
    description:
      "Read one page in full: its title, its meta title and description, and " +
      "its body HTML. Always read a page before writing it. Writing a body " +
      "you have not read replaces work you cannot see.",
    input_schema: {
      type: "object" as const,
      properties: {
        slug: {
          type: "string",
          description: "The page's slug. The front page's slug is the empty string, which has to be passed as one rather than left out.",
        },
      },
      required: ["slug"],
    },
  },
  {
    name: "write_page",
    description:
      "Change one page. Only the fields you pass are changed, so a title can " +
      "be fixed without resending the body. bodyHtml replaces the whole body, " +
      "so it must be the complete page, not the part you altered. The body is " +
      "the content between the header and the footer: no <html>, <head>, " +
      "<body>, <header> or <footer> tags, and no <style> or <script>.",
    input_schema: {
      type: "object" as const,
      properties: {
        slug: { type: "string", description: "Which page. Empty string is the front page." },
        title: { type: "string", description: "The page's name, as menus show it." },
        metaTitle: { type: "string", description: "The title search engines show." },
        metaDescription: { type: "string", description: "The description search engines show." },
        bodyHtml: { type: "string", description: "The complete new body." },
      },
      required: ["slug"],
    },
  },
  {
    name: "add_page",
    description:
      "Add a page that does not exist. Give it a slug nothing else uses. It " +
      "goes last in the menu unless you say otherwise.",
    input_schema: {
      type: "object" as const,
      properties: {
        slug: { type: "string", description: "Lowercase words joined by hyphens." },
        title: { type: "string" },
        bodyHtml: { type: "string", description: "The page's content, as body HTML." },
        metaTitle: { type: "string" },
        metaDescription: { type: "string" },
        order: { type: "number", description: "Menu position, lowest first." },
      },
      required: ["slug", "title", "bodyHtml"],
    },
  },
  {
    name: "remove_page",
    description:
      "Delete a page. Ask before doing this unless you were plainly told to. " +
      "A site must keep at least one page, and the front page cannot go.",
    input_schema: {
      type: "object" as const,
      properties: { slug: { type: "string" } },
      required: ["slug"],
    },
  },
  {
    name: "set_site",
    description: "Change the site's name or its tagline.",
    input_schema: {
      type: "object" as const,
      properties: { name: { type: "string" }, tagline: { type: "string" } },
      required: [],
    },
  },
  {
    name: "set_theme",
    description:
      "Change how the site looks: its accent colour, its background, its text " +
      "colour, whether it is set in a sans or a serif face, and how wide the " +
      "text column runs. Colours are hex, like #1b2430.",
    input_schema: {
      type: "object" as const,
      properties: {
        accent: { type: "string", description: "Links and anything meant to draw the eye." },
        background: { type: "string" },
        ink: { type: "string", description: "The colour of the words." },
        font: { type: "string", enum: ["sans", "serif"] },
        width: { type: "number", description: "The text column's width in pixels, 480 to 1400." },
      },
      required: [],
    },
  },
  {
    name: "set_header",
    description:
      "Change the header: whether the name, the tagline and the navigation " +
      "show at all, and any links beyond the site's own pages. Passing links " +
      "replaces the whole list.",
    input_schema: {
      type: "object" as const,
      properties: {
        showName: { type: "boolean" },
        showTagline: { type: "boolean" },
        showNav: { type: "boolean" },
        links: {
          type: "array",
          items: {
            type: "object",
            properties: { label: { type: "string" }, url: { type: "string" } },
            required: ["label", "url"],
          },
        },
      },
      required: [],
    },
  },
  {
    name: "set_footer",
    description:
      "Change the footer: the words in it, whether it carries a copyright " +
      "line, and its links. Passing links replaces the whole list.",
    input_schema: {
      type: "object" as const,
      properties: {
        text: { type: "string" },
        showCopyright: { type: "boolean" },
        links: {
          type: "array",
          items: {
            type: "object",
            properties: { label: { type: "string" }, url: { type: "string" } },
            required: ["label", "url"],
          },
        },
      },
      required: [],
    },
  },
];

/**
 * The page a slug names, or nothing.
 *
 * An omitted slug is not the front page, and the difference is the whole
 * reason this is written out. The front page's slug is the empty string, and
 * String(undefined ?? "") is also the empty string, so a write_page call that
 * simply forgot its slug was finding the front page and overwriting the
 * homepage with a draft meant for somewhere else. The schema says the field is
 * required, which is a request rather than a guarantee.
 *
 * So the front page has to be asked for as "", deliberately, and anything that
 * is not a string at all matches nothing.
 */
function find(site: Website, slug: unknown): WebsitePage | undefined {
  if (typeof slug !== "string") return undefined;
  const wanted = slug.trim().replace(/^\/+|\/+$/g, "");
  return site.pages.find((p) => p.slug === wanted);
}

/** Said whenever a slug named nothing, so the next attempt can be right. */
function noSuchPage(site: Website): string {
  return (
    `There is no page with that slug. Pass one of these exactly, and the front ` +
    `page as an empty string: ${names(site)}.`
  );
}

function names(site: Website): string {
  return site.pages
    .map((p) => `"${p.slug || "(front page)"}"`)
    .join(", ");
}

/**
 * Markup a page body may not contain.
 *
 * The renderer wraps every body in the site's own document and chrome, so a
 * body carrying its own <html> or <header> produces a page nested inside a page.
 * Scripts and styles are refused for a plainer reason: a body is content, the
 * look lives in the theme and the design, and a model that can write a <script>
 * into a site somebody then publishes is a larger thing than this is.
 */
const FORBIDDEN = /<\s*(html|head|body|header|footer|script|style)\b/i;

/**
 * Run one tool call against a working copy.
 *
 * Every refusal comes back as a sentence the model can act on rather than an
 * exception, because a tool that throws ends the conversation and a tool that
 * explains itself gets a second, better attempt. The copy is only ever replaced
 * on success, so a refused call leaves nothing behind.
 */
export function applyTool(
  site: Website,
  name: string,
  input: Record<string, unknown>,
): { site: Website; result: ToolResult } {
  const no = (said: string) => ({ site, result: { ok: false as const, said } });

  switch (name) {
    case "list_pages": {
      const rows = [...site.pages]
        .sort((a, b) => a.order - b.order)
        .map(
          (p) =>
            `slug "${p.slug}"${p.slug ? "" : " (the front page)"} — "${p.title}", ` +
            `order ${p.order}, ${p.bodyHtml.length} characters`,
        );
      return {
        site,
        result: {
          ok: true,
          said: rows.length ? rows.join("\n") : "This site has no pages.",
        },
      };
    }

    case "read_page": {
      const page = find(site, input.slug);
      if (!page) return no(noSuchPage(site));
      return {
        site,
        result: {
          ok: true,
          said:
            `title: ${page.title}\nmetaTitle: ${page.metaTitle}\n` +
            `metaDescription: ${page.metaDescription}\n\nbodyHtml:\n${page.bodyHtml}`,
        },
      };
    }

    case "write_page": {
      const page = find(site, input.slug);
      if (!page) return no(noSuchPage(site));

      if (input.bodyHtml !== undefined) {
        const body = String(input.bodyHtml);
        if (!body.trim()) return no("A page cannot have an empty body.");
        const found = body.match(FORBIDDEN);
        if (found) {
          return no(
            `A page body may not contain <${found[1]}>. The renderer supplies the ` +
              "document, the header and the footer, and the look lives in the theme. " +
              "Send only the content between them.",
          );
        }
      }

      /*
       * Cleaned by the same function the hand editor's saves go through, so a
       * page Claude wrote and a page somebody typed are held to one standard.
       *
       * The index it is given is 0 for the front page and 1 for anything else,
       * because that argument only decides whether the slug is allowed to be
       * empty. The slug and the order are then put back as they were: a slug
       * that moves is a published address that stops resolving, and reordering
       * is a menu change, not a wording change.
       */
      const next = cleanPage(
        {
          ...page,
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.metaTitle !== undefined ? { metaTitle: input.metaTitle } : {}),
          ...(input.metaDescription !== undefined
            ? { metaDescription: input.metaDescription }
            : {}),
          ...(input.bodyHtml !== undefined ? { bodyHtml: input.bodyHtml } : {}),
        },
        page.slug ? 1 : 0,
      );
      const kept = { ...next, slug: page.slug, order: page.order };

      return {
        site: { ...site, pages: site.pages.map((p) => (p === page ? kept : p)) },
        result: { ok: true, said: `Changed "${kept.title}".` },
      };
    }

    case "add_page": {
      const slug = String(input.slug ?? "").trim().replace(/^\/+|\/+$/g, "");
      if (!slug) return no("A new page needs a slug. Only the front page may have none.");
      if (find(site, slug)) return no(`There is already a page at "${slug}".`);
      // The same ceiling the store keeps. Writing a sixty-first page would
      // silently drop it on save, which is the worst way to be told no.
      if (site.pages.length >= 60) {
        return no("This site already has sixty pages, which is as many as it can hold.");
      }

      const body = String(input.bodyHtml ?? "");
      const found = body.match(FORBIDDEN);
      if (found) return no(`A page body may not contain <${found[1]}>.`);

      const order =
        typeof input.order === "number"
          ? input.order
          : Math.max(0, ...site.pages.map((p) => p.order)) + 1;

      // Never index 0: a page being added is never the front page, and index 0
      // is what tells cleanPage a page is allowed to have no slug at all.
      const page = cleanPage({ ...input, slug, bodyHtml: body }, 1);
      return {
        site: { ...site, pages: [...site.pages, { ...page, slug, order }] },
        result: { ok: true, said: `Added "${page.title}" at /${slug}.` },
      };
    }

    case "remove_page": {
      const page = find(site, input.slug);
      if (!page) return no(noSuchPage(site));
      if (!page.slug) return no("The front page cannot be removed.");
      if (site.pages.length <= 1) return no("A site must keep at least one page.");
      return {
        site: { ...site, pages: site.pages.filter((p) => p !== page) },
        result: { ok: true, said: `Removed "${page.title}".` },
      };
    }

    case "set_site": {
      const next = {
        ...site,
        ...(input.name !== undefined
          ? { name: String(input.name).trim().slice(0, 80) || site.name }
          : {}),
        ...(input.tagline !== undefined
          ? { tagline: String(input.tagline).trim().slice(0, 200) }
          : {}),
      };
      return { site: next, result: { ok: true, said: `The site is now "${next.name}".` } };
    }

    case "set_theme": {
      const theme = cleanTheme({ ...site.theme, ...input });
      return {
        site: { ...site, theme },
        result: {
          ok: true,
          said:
            `accent ${theme.accent}, background ${theme.background}, ink ${theme.ink}, ` +
            `${theme.font}, ${theme.width}px wide.`,
        },
      };
    }

    case "set_header": {
      const header = cleanHeader({ ...site.header, ...input });
      return { site: { ...site, header }, result: { ok: true, said: "The header is changed." } };
    }

    case "set_footer": {
      const footer = cleanFooter({ ...site.footer, ...input });
      return { site: { ...site, footer }, result: { ok: true, said: "The footer is changed." } };
    }

    default:
      return no(`There is no tool called ${name}.`);
  }
}

/** Whether a tool call changed anything, as opposed to only having looked. */
export function isWrite(name: string): boolean {
  return name !== "list_pages" && name !== "read_page";
}

/**
 * What the site is, put in front of the model once.
 *
 * The pages are named and measured but not quoted: reading one is a tool call,
 * and a system prompt carrying twenty bodies would cost more on every message
 * than the whole conversation is worth. Everything that is small enough to send
 * whole is sent whole, because a model that has to ask for the footer before it
 * can change a word in it wastes a turn on something that fits in a line.
 */
export function describeSite(site: Website): string {
  const pages = [...site.pages]
    .sort((a, b) => a.order - b.order)
    .map(
      (p) =>
        `- "${p.slug || "(front page)"}" — ${p.title} (${p.bodyHtml.length} characters)`,
    )
    .join("\n");

  return [
    `Name: ${site.name}`,
    `Tagline: ${site.tagline || "(none)"}`,
    `Topic: ${site.topic}`,
    `Language: ${site.language}`,
    `Built as: ${site.format === "wordpress" ? "WordPress" : "static HTML"}`,
    site.published
      ? `Published to ${site.published.address} as ${site.published.status === "publish" ? "live pages" : "drafts"}.`
      : "Not published anywhere yet.",
    "",
    `Pages (${site.pages.length}):`,
    pages || "(none)",
    "",
    `Theme: ${JSON.stringify(site.theme)}`,
    `Header: ${JSON.stringify(site.header)}`,
    `Footer: ${JSON.stringify(site.footer)}`,
  ].join("\n");
}
