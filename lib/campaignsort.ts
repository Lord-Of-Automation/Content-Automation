/**
 * The order of the publisher table on the campaign tab.
 *
 * Apart from the component because the rules are worth checking on their own:
 * which way a column runs the first time it is clicked, where a row with an
 * empty cell goes, and what settles two rows that tie. None of that is visible
 * from reading a table of forty rows, and all of it is wrong in a way somebody
 * would only notice as "the sorting is odd".
 */

import type { Opportunity } from "./mail";

/**
 * The columns, and which way each one is worth reading first.
 *
 * Not all ascending. The question a column is there to answer decides its
 * direction: the best publishers are the ones with the highest rating and the
 * most traffic, and the cheapest are the ones worth having first. Starting
 * every column at A to Z would mean two clicks on most of them before the
 * table said anything.
 */
export const COLUMNS = [
  ["domain", "Domain", "asc", "text"],
  ["rating", "DR", "desc", "number"],
  ["traffic", "Traffic", "desc", "number"],
  ["price", "Price", "asc", "number"],
  ["geo", "GEO", "asc", "text"],
  ["language", "Language", "asc", "text"],
  ["sender", "Send from", "asc", "text"],
  ["email", "Email", "asc", "text"],
  ["notes", "Notes", "asc", "text"],
] as const;

export type SortKey = (typeof COLUMNS)[number][0];
export type Direction = "asc" | "desc";

export const FIRST_DIRECTION: Record<SortKey, Direction> = Object.fromEntries(
  COLUMNS.map(([key, , first]) => [key, first]),
) as Record<SortKey, Direction>;

/** Which columns are quantities, whatever shape their values arrive in. */
const NUMERIC: Record<SortKey, boolean> = Object.fromEntries(
  COLUMNS.map(([key, , , kind]) => [key, kind === "number"]),
) as Record<SortKey, boolean>;

/**
 * A cell in a number column, as a number.
 *
 * The three quantity columns are read out of a spreadsheet, and a spreadsheet
 * holds whatever somebody typed: 12,500 with a comma, 12.5K, $120, 70/100,
 * 45 %. The engine converts what it recognises, but it is one parser against
 * every way a person writes a number, and anything it does not recognise
 * arrives here as the text it was.
 *
 * Comparing that text would order 9 after 100, because "9" comes after "1".
 * So it is read as a quantity here too, and a cell with no number in it at all
 * counts as missing and sinks, which is what an empty cell does.
 */
export function quantity(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;

  const said = value.trim().toLowerCase();
  if (!said) return null;

  // The first run of digits, and any thousand marks or decimal point inside
  // it. Whatever surrounds it -- a currency, a slash, a per cent, a word -- is
  // not part of the quantity.
  const found = /[0-9][0-9,. ]*/.exec(said);
  if (!found) return null;

  const digits = Number(found[0].replace(/[, ]/g, "").replace(/\.$/, ""));
  if (!Number.isFinite(digits)) return null;

  // A K or an M immediately after it, which is how traffic is usually written.
  const after = said.slice(found.index + found[0].length).trimStart();
  const scale = after.startsWith("k") ? 1_000 : after.startsWith("m") ? 1_000_000 : 1;
  return digits * scale;
}

/**
 * One column's worth of ordering.
 *
 * A row with nothing in the column sinks to the bottom either way round.
 * Flipping the direction is for reading the same column from the other end,
 * and a sheet where half the prices are blank should not answer "cheapest
 * first" with forty blanks.
 */
export function order(rows: Opportunity[], key: SortKey, direction: Direction): Opportunity[] {
  const sign = direction === "asc" ? 1 : -1;
  const asNumbers = NUMERIC[key];

  /*
   * Each row carried beside the one value being sorted on.
   *
   * Read once per row rather than once per comparison, because a sort over a
   * few thousand rows asks for the same cell a great many times. Carried
   * alongside rather than looked up by domain: the same domain appears twice
   * in a prospect list often enough, and a lookup would give both lines
   * whichever of the two values was read last.
   */
  const marked = rows.map((row) => ({
    row,
    value: asNumbers
      ? quantity(row[key])
      : String(row[key] ?? "").trim().toLowerCase(),
  }));

  return marked
    .sort((one, two) => {
    const a = one.row;
    const b = two.row;
    const left = one.value;
    const right = two.value;

    const leftMissing = left === null || left === "";
    const rightMissing = right === null || right === "";
    if (leftMissing || rightMissing) {
      if (leftMissing && rightMissing) return a.domain.localeCompare(b.domain);
      return leftMissing ? 1 : -1;
    }

    if (typeof left === "number" && typeof right === "number") {
      if (left !== right) return (left - right) * sign;
    } else {
      const said = String(left).localeCompare(String(right), undefined, { numeric: true });
      if (said !== 0) return said * sign;
    }

    // Equal on the column asked for. The domain settles it, so the order is
    // the same every time rather than depending on how the sheet was read.
    return a.domain.localeCompare(b.domain);
    })
    .map((each) => each.row);
}
