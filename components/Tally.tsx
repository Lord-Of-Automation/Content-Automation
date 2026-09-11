"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A number that counts to its new value instead of jumping to it.
 *
 * Changing the range on the Search Console page rewrites every figure on it at
 * once — four totals and four columns of rows. Nothing moves, so there is no
 * signal that anything happened other than the digits being different, and
 * whether a number went up or down is exactly what somebody changing the range
 * is asking.
 *
 * Counting answers that without a word. A figure that runs upward went up, one
 * that runs down went down, and the distance it travels is roughly how much.
 *
 * It runs on the first appearance too, from zero. These figures arrive after a
 * fetch, so the page has already been sitting there with a row of skeletons
 * where they go, and counting is what makes them land rather than simply
 * replace the placeholder. It is over in a quarter of a second either way.
 */

/**
 * Short enough that the digits in between cannot be read.
 *
 * Which is the point of them. Nobody wants to know that the figure passed
 * through 816 on its way to 1,284 — what the count is for is the direction and
 * roughly the distance, and a run slow enough to read each step invites
 * somebody to try.
 */
const RUN = 260;

/**
 * Fast first and slow at the end.
 *
 * Which is what makes it read as landing on a figure rather than sliding to
 * one. A linear count feels like a progress bar.
 */
function ease(t: number): number {
  return 1 - (1 - t) ** 3;
}

export default function Tally({
  value,
  format,
  className,
}: {
  value: number;
  /** How the number is written. The same function the page used before. */
  format: (n: number) => string;
  className?: string;
}) {
  // Starts at nothing, so the first value counts up to itself rather than
  // appearing. Every figure this is used for arrives after a fetch, so there is
  // no frame where the real number was already on screen to jump from.
  const [shown, setShown] = useState(0);

  // What is on screen right now, which is where the next count starts from.
  // A ref rather than state: a count interrupted halfway by another change
  // should carry on from the figure being looked at, not from the one it was
  // heading for.
  const at = useRef(0);
  const frame = useRef(0);

  useEffect(() => {
    if (value === at.current) return;

    const from = at.current;
    const gap = value - from;

    const still =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (still) {
      at.current = value;
      setShown(value);
      return;
    }

    // performance.now rather than Date.now: it is the clock the frames are
    // handed, so the count cannot drift against them.
    const began = performance.now();

    const step = (now: number) => {
      const through = Math.min(1, (now - began) / RUN);
      const here = from + gap * ease(through);
      at.current = through === 1 ? value : here;
      setShown(at.current);
      if (through < 1) frame.current = requestAnimationFrame(step);
    };

    frame.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame.current);
  }, [value]);

  /*
   * Held to the width of the widest figure it passes through.
   *
   * Counting to 1,284 runs through 999 and 1,000, and a number that changes
   * width mid-count drags the column beside it back and forth. tabular-nums
   * fixes the digits; this fixes the count.
   */
  return (
    <span className={className ? `tally ${className}` : "tally"}>
      <span className="tally-now">{format(shown)}</span>
      <span className="tally-room" aria-hidden>
        {format(Math.max(Math.abs(value), Math.abs(at.current)))}
      </span>
    </span>
  );
}
