/**
 * What this platform is, written down so it can be asked about.
 *
 * The assistant on the side of every page knows what any model knows plus a
 * paragraph. That is enough to answer "what is a canonical tag" and nothing
 * like enough to answer "why did my run write nothing", which is the kind of
 * question somebody actually has while looking at this console.
 *
 * So this is the reference it reads in About Platform mode: the pages and what
 * each is for, the two programs and which one does what, the vocabulary, and
 * the handful of things that are true here and surprising anywhere else.
 *
 * It is prose rather than a file listing on purpose. A list of routes tells a
 * reader what exists; it does not tell them that publishing goes through a
 * plugin rather than core WordPress, which is the fact that actually answers
 * questions. Where a name appears it is the real one, so an answer can point
 * at something findable.
 *
 * It goes into the prompt behind a cache breakpoint, so asking a second
 * question does not pay to send it again.
 *
 * Keeping it true is a manual job, and a stale line here is worse than a
 * missing one: the assistant states it with the same confidence either way.
 * Anything below that stops being true should be corrected in the same change
 * that makes it untrue.
 */

export const PLATFORM_DOC = `
# The platform

Two programs that share a bill and nothing else.

**The console** is a Next.js application on Vercel. It is the whole interface:
every page a person sees, every credential, every record of what was made. It
starts work and shows what happened. It runs no pipelines itself.

**The engine** is a Node service on a DigitalOcean droplet at /opt/src, behind
Caddy, deployed by hand with: cd /opt/src && git pull && docker compose up -d
--build. It does the actual work — crawling, researching, writing, publishing —
and reports progress back. It has its own Anthropic key in its own environment;
the console's key is separate and the two never share one.

A change to the console is live as soon as it is pushed. A change to the engine
is live when somebody runs that command. This trips people up: a fix can be
merged and still not be running.

# The pages

**Optimize** (/runs) rewrites pages that already exist on a WordPress site. You
give it a site, a market and a language, it crawls, picks pages worth working
on, researches each, rewrites it and publishes it back. This is the original
job the platform was built for.

**Loop** (/loop) is the same work on a schedule. A loop holds a site and its
settings and starts a run every so often — four times a day through to weekly.

Both live under the SEO menu in the header.

**Websites** (/websites) is different work: writing a site that does not exist
yet. You describe it, name the topic and the keywords, choose WordPress or
static HTML and how many pages, and the engine writes the whole thing. What
comes back is editable here — see the editor below — and can then be published
onto any connected host.

**Domains** (/domains) lists every domain across the connected registrars and
Cloudflare, with DNS, groups and bulk edits. **Name generator**
(/domains/generate) finds names that are free and prices them.

**Applications** (/apps) lists what is hosted, across Cloudways and Hostinger
together. Per application: its domain, its admin login, cache clearing, cloning,
deleting, changing the primary domain. What a row can do depends on the host, so
a Hostinger row simply lacks the things only Cloudways offers.

**Performance** (/performance) reports rankings and traffic from Google Search
Console.

**Logs** (/logs) is the audit trail: who did what, when.

**Keys** (/keys) holds every credential, encrypted. **Accounts** (/accounts)
holds who may sign in. Both are settings, so they live in the profile menu
rather than the navigation.

# The website editor

Opening a generated website (/websites/[id]) gives four tabs.

**Pages** is the visual editor. The page renders in a sandboxed frame and is
edited in place: click anything to select it, type where the cursor is, drag the
blue handles on a box to size it, move a block among its neighbours. The panel
on the right changes type and box properties. The site's name, tagline, footer
words, link labels and page titles in the menus are all editable where they are
read, because each of them is a setting with somewhere to go.

**Header and footer** holds what has no text to click: whether the navigation
shows, where a link points, whether there is a copyright line.

**Versions** is history. Every save keeps the version it replaced, up to 25 per
site, and restoring is itself a save so it can be undone.

**Publish** puts the site on a host.

# Publishing

Publishing a generated site means writing its pages into WordPress on a site you
choose. That is the only route, and the reason is worth knowing: Cloudways has
no API that will accept a file — no upload, no git, nothing that writes to disk —
and Hostinger's file endpoints only reach Hostinger's own sites. WordPress is
what nearly every application on both hosts is running, and WordPress has a
write API. So the platform talks to WordPress rather than to a host.

It needs a WordPress application password per target site, saved in the console.
The Publish tab can fetch one: it sends you to that site's own authorisation
screen, you approve, and WordPress mints one and hands it back. A login password
will not work — WordPress refuses those over its API.

Three ways a published page can look:

- **Exactly like the generated site** — the theme's header, footer and sidebar
  are hidden on those pages only, and the generated design takes the page over.
- **The design, inside the theme** — the theme's chrome stays.
- **Like the rest of the target site** — the words alone, no design.

Publishing twice updates the same pages rather than duplicating them, because
the page ids are remembered. Drafts are the default.

# Images

A generated site's pictures live in the WordPress media library of the site it
is published to. The console stores none of its own. That means a website with
nowhere to be published has nowhere to put a picture, and the editor says so
rather than offering an upload that could only fail. Uploads pass through the
console because the site's password must never reach the browser, and a
serverless request body stops at about four and a half megabytes.

# What the engine does to a page

A run over an existing site, in order: read the site's settings, crawl it, build
a link graph, pick which pages are worth working on, and then per page — classify
it, find what is missing, research it, draft it, write the meta and the FAQ,
insert internal links, and publish.

What happens in the middle depends on what the page is. The classifier sorts
pages into classes, and the two that get special treatment are:

- **game_review** — looks the game up in the Slots Launch catalogue, embeds the
  demo, builds a screenshot gallery, and researches the game's specifications.
- **casino_review** — visits the operator's site, reads the lobby, writes it up,
  and generates story images of a withdrawal and a support chat.

A featured image is chosen per page: the provider's tile for a game, the
operator's own share card or logo for a casino. Not a gallery screenshot — one
slot mid-spin looks like every other one at thumbnail size.

Publishing goes through a WordPress plugin called the content bridge, at
/wp-json/n8n/v1/content, not core WordPress. The plugin handles the featured
image, the FAQ schema, the SEO meta and copying a page's theme template.

# Vocabulary

- **Run** — one execution of a pipeline. Has an id, a step list, a cost and a
  log. Can be stopped, and a failed one can be resumed from where it stopped.
- **Loop** — a schedule that starts runs.
- **Website** — a site written by the platform, as opposed to one it optimises.
- **Application** — something hosted, on Cloudways or Hostinger.
- **Content bridge** — the WordPress plugin the engine publishes through.
- **The catalogue** — Slots Launch, the game data source.

# Things that surprise people

- The console deploys itself; the engine does not.
- A run that finishes with nothing published usually means the selection step
  chose no pages, not that writing failed. The step list says which.
- Cloudways cannot clear the cache for one application, only for a whole server.
  The console clears a single site through Cloudflare instead.
- Cloudways API v1 was scheduled to end in March 2026 and still answers.
- Publishing needs an application password, never the login password.
- Artifacts of a failed run are deleted after three days. The run record, its
  settings and its history are kept.
`.trim();
