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
 * Not on the first appearance. A page arriving with every number spinning from
 * zero is a slot machine; this is for the change from one answer to the next,
 * so the first value is simply the value.
 */

/** Long enough to read as counting, short enough not to be waited for. */
const RUN = 420;

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
  const [shown, setShown] = useState(value);

  // What is on screen right now, which is where the next count starts from.
  // A ref rather than state: a count interrupted halfway by another change
  // should carry on from the figure being looked at, not from the one it was
  // heading for.
  const at = useRef(value);
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
