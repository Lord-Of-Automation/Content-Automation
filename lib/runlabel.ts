/**
 * What a run is called on screen.
 *
 * The engine issues one sequence of ids for everything it does, so a campaign
 * and a site build are "412" and "413" on the same list with nothing to tell
 * them apart. Everywhere else that matters the kind is obvious from the page
 * you are on; on the Runs page it is not, because that page is all of them.
 *
 * So a campaign is written "Mail-412". The id itself is untouched — it is
 * still what the engine is asked about, what a link carries and what a log
 * line says — and this is only how it is printed.
 */

export const MAIL_PREFIX = "Mail-";

export function runLabel(id: string, mail: boolean): string {
  return mail ? `${MAIL_PREFIX}${id}` : id;
}

/**
 * The id inside a label, whichever form it came in.
 *
 * For anything that reads a run id back out of something a person can type or
 * paste — a URL, a search box — so that pasting "Mail-412" finds run 412
 * rather than nothing.
 */
export function runId(label: string): string {
  const value = String(label ?? "").trim();
  const bare = value.startsWith("#") ? value.slice(1) : value;
  return bare.toLowerCase().startsWith(MAIL_PREFIX.toLowerCase())
    ? bare.slice(MAIL_PREFIX.length)
    : bare;
}
