"use client";

import { useState, type ReactNode } from "react";

/**
 * Folding a whole card away.
 *
 * The groups inside the Keys card already fold. This is the same idea one
 * level up: the Keys page is three cards of credentials, and the one being
 * changed is rarely more than one of them.
 *
 * Deliberately not the whole title bar, which is what the groups use. A card's
 * head often already holds a button — New group, Refresh — and a button inside
 * a button is not a thing. So the control is its own, at the end of the bar,
 * where it is in the same place on every card whatever else is up there.
 */

/** The arrow. Down when the card is folded away, up when it is open. */
function Chevron() {
  return (
    <svg
      className="fold-chevron"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

export function FoldToggle({
  open,
  what,
  onToggle,
}: {
  open: boolean;
  /** What is being folded, for the button somebody hovers or hears. */
  what: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className="fold-toggle"
      aria-expanded={open}
      aria-label={open ? `Fold ${what} away` : `Open ${what}`}
      title={open ? `Fold ${what} away` : `Open ${what}`}
      onClick={onToggle}
    >
      <Chevron />
    </button>
  );
}

/**
 * What a folded card hides, and how it gets out of the way.
 *
 * A grid row going from nothing to one fraction, because a card opens to
 * whatever its contents come to and no keyframe can know that number. It also
 * animates in both directions, which a height set in script does not.
 */
export function FoldBody({ children }: { children: ReactNode }) {
  return (
    <div className="fold-body">
      <div>{children}</div>
    </div>
  );
}

/** Open or shut, and the class the card wears while it is one or the other. */
export function useFold(startOpen = true) {
  const [open, setOpen] = useState(startOpen);
  return {
    open,
    toggle: () => setOpen((was) => !was),
    /** For the card element, so the arrow and the body both know. */
    className: open ? "card is-foldable is-open" : "card is-foldable",
  };
}
