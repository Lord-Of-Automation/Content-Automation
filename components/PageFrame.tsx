"use client";

import { Fragment } from "react";
import { usePathname } from "next/navigation";

/**
 * What makes a page arrive rather than appear.
 *
 * The arrival itself is CSS on <main>, and CSS animations play once, when the
 * element is mounted. Between two pages of this console that is not a given:
 * every page renders the same <main> in the same place, so React is entitled
 * to keep the element and change what is inside it, and an element that was
 * never remounted never plays its animation again. The first page you opened
 * would arrive and every page after it would cut.
 *
 * A key on the path settles it. React discards the old page and builds the new
 * one when the key changes, which is what makes the animation play, and a
 * Fragment carries a key without putting a wrapper in the document — this sits
 * in the root layout, and a <div> here would be a <div> around every page on
 * the platform forever.
 *
 * Deliberately the path and not the whole URL. A run is chosen by a query
 * string on the Runs page, and re-mounting the console every time somebody
 * clicked a run in the list would throw away what it had loaded and animate a
 * page they had not left.
 */
export default function PageFrame({ children }: { children: React.ReactNode }) {
  return <Fragment key={usePathname()}>{children}</Fragment>;
}
