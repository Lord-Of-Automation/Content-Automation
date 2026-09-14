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
  ["domain", "Domain", "asc"],
  ["rating", "DR", "desc"],
  ["traffic", "Traffic", "desc"],
  ["price", "Price", "asc"],
  ["geo", "GEO", "asc"],
  ["language", "Language", "asc"],
  ["sender", "Send from", "asc"],
  ["email", "Email", "asc"],
  ["notes", "Notes", "asc"],
] as const;

export type SortKey = (typeof COLUMNS)[number][0];
export type Direction = "asc" | "desc";

export const FIRST_DIRECTION: Record<SortKey, Direction> = Object.fromEntries(
  COLUMNS.map(([key, , first]) => [key, first]),
) as Record<SortKey, Direction>;

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

  return [...rows].sort((a, b) => {
    const left = a[key];
    const right = b[key];

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
  });
}
