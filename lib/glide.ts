"use client";

import { useCallback, useLayoutEffect, useRef } from "react";

/**
 * Rows that travel to their new places instead of teleporting.
 *
 * Sorting a table by another column replaces every row in one frame. The
 * answer is correct and completely illegible: the domain you were reading is
 * somewhere else now and there is no way to tell where it went, so the only
 * thing to do is find it again.
 *
 * This measures where each row was, lets React put them where they belong, and
 * then moves each one from where it was to where it is. The row you were
 * looking at slides past the others and you can follow it.
 *
 * The technique is the usual one, done in this order because it is the only
 * order that avoids a frame of the wrong thing on screen: read the old
 * positions, let the browser lay out the new ones, then offset each row back
 * to where it started and animate that offset away. Nothing is ever drawn in
 * the wrong place, because the offset is applied in a layout effect, before
 * paint.
 *
 * It moves rows rather than fading them. A fade says something changed; this
 * says what changed into what, which is the question somebody sorting a table
 * is asking.
 */

/** How long a row takes to reach its new place. */
const RUN = 340;

/**
 * How long a captured set of positions stays worth using.
 *
 * A capture is taken just before something is asked for and the rows move when
 * the answer arrives, which for a table is the next frame and for a list that
 * has to be re-fetched is a moment later. Past this it is stale: the page has
 * moved on and animating from those positions would fling rows across the
 * screen for no reason.
 */
const KEEP = 4_000;

export interface Glide {
  /** Goes on the element that holds the rows. */
  ref: React.MutableRefObject<HTMLElement | null>;
  /** Call immediately before whatever re-orders them. */
  capture: () => void;
}

function stillness(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function useGlide<T extends HTMLElement = HTMLElement>(): {
  ref: React.MutableRefObject<T | null>;
  capture: () => void;
} {
  const box = useRef<T | null>(null);
  const from = useRef<Map<string, number> | null>(null);
  const taken = useRef(0);

  const capture = useCallback(() => {
    const el = box.current;
    if (!el || stillness()) return;

    const map = new Map<string, number>();
    for (const row of el.querySelectorAll<HTMLElement>("[data-glide]")) {
      map.set(row.dataset.glide!, row.getBoundingClientRect().top);
    }
    from.current = map;
    taken.current = performance.now();
  }, []);

  /*
   * Runs after every render and does nothing unless a capture is waiting.
   *
   * A capture that finds nothing moved is kept rather than thrown away: the
   * render that follows a click is often only a button going busy, and the
   * rows do not move until the answer comes back a moment later. It is thrown
   * away once it is too old to mean anything.
   */
  useLayoutEffect(() => {
    const el = box.current;
    const was = from.current;
    if (!el || !was) return;

    if (performance.now() - taken.current > KEEP) {
      from.current = null;
      return;
    }

    let moved = 0;
    for (const row of el.querySelectorAll<HTMLElement>("[data-glide]")) {
      const before = was.get(row.dataset.glide!);
      if (before === undefined) continue;

      const shift = before - row.getBoundingClientRect().top;
      // A row that did not move does not need telling it did not move, and a
      // sub-pixel shift is a rounding difference rather than a change of place.
      if (Math.abs(shift) < 1) continue;

      moved += 1;
      row.animate(
        [{ transform: `translateY(${shift}px)` }, { transform: "none" }],
        { duration: RUN, easing: "cubic-bezier(0.2, 0, 0, 1)" },
      );
    }

    if (moved) from.current = null;
  });

  return { ref: box, capture };
}
