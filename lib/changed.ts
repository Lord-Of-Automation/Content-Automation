"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Whether this value has just changed.
 *
 * Six views here poll on a timer, so a run's status moves without anybody
 * touching anything. It moved silently, which is the worst way for a number to
 * change: either you miss it, or you catch it and stop trusting the rest of the
 * list because you do not know what else moved while you were reading.
 *
 * Returns true for a moment after a change, which the caller turns into a
 * class. The first value is never a change: everything is new when a page
 * loads, and lighting up the whole table on arrival says nothing.
 */
export function useChanged(value: unknown, forMs = 1200): boolean {
  const previous = useRef<unknown>(undefined);
  const [changed, setChanged] = useState(false);

  useEffect(() => {
    const first = previous.current === undefined;
    const moved = !first && previous.current !== value;
    previous.current = value;

    if (!moved) return;

    setChanged(true);
    const timer = window.setTimeout(() => setChanged(false), forMs);
    return () => window.clearTimeout(timer);
  }, [value, forMs]);

  return changed;
}
