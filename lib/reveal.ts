"use client";

import { useState } from "react";

/**
 * Which rows in a paged list have only just been shown.
 *
 * Every long table on this platform draws the first page and keeps a "Show
 * more" under it. The rows that button reveals are newly mounted, so the
 * arrival animation the table already has does play for them — but it plays
 * for all twenty at once, because the stagger is written against a row's
 * position in the whole table and everything past the eighth shares the last
 * delay. Twenty rows appearing together after a pause is a flicker, not an
 * arrival.
 *
 * So the delay for a revealed row is counted from the top of the batch rather
 * than the top of the table, and handed back as an inline style because that
 * is what beats the stylesheet's own delays without a second set of rules.
 *
 * It deliberately knows nothing about tables. The run list on the Runs page is
 * a list of buttons with the same button under it and the same problem.
 */

/** How far apart the revealed rows arrive, and where that stops growing. */
const STEP = 28;
const CAP = 10;

export function useReveal(visible: number): (index: number) => { animationDelay: string } | undefined {
  /*
   * Where the newest batch starts.
   *
   * Adjusted during render rather than in an effect: an effect runs after
   * paint, by which time the rows have already been drawn and the frame that
   * needed the delay is gone.
   */
  const [was, setWas] = useState(visible);
  const [from, setFrom] = useState(-1);

  if (visible !== was) {
    // Grown means somebody asked for more, and the batch starts where the last
    // one ended. Shrunk means a filter changed and the whole table is new
    // again, which the table's own arrival already covers.
    setFrom(visible > was ? was : -1);
    setWas(visible);
  }

  return (index: number) => {
    if (from < 0 || index < from) return undefined;
    return { animationDelay: `${Math.min(index - from, CAP) * STEP}ms` };
  };
}
