"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";

export interface NavItem {
  href: string;
  label: string;
  /** One line under the label, so the choice is obvious without clicking it. */
  note: string;
  current: boolean;
}

/**
 * A top-level nav entry that opens rather than navigates.
 *
 * "Domains" is not a page any more, it is two pages, and a parent that is both
 * a link and a menu makes you guess whether clicking it goes somewhere or opens
 * something. So it opens, and every destination is in the menu.
 *
 * Hover is the fast path and not the only one. A hover-only menu is unreachable
 * by keyboard and unusable on a touch screen, where there is no hover at all —
 * so it also opens on click and on focus, and closes on Escape or a click
 * outside.
 *
 * The close is delayed by a beat. The gap between the button and the panel is a
 * few pixels of nothing, and a menu that vanishes while the pointer crosses it
 * is a menu you have to approach at exactly the right angle.
 */
export default function NavMenu({
  label,
  items,
  active,
}: {
  label: string;
  items: NavItem[];
  /** Whether one of the children is the page being shown. */
  active: boolean;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const shutting = useRef<ReturnType<typeof setTimeout> | null>(null);
  const menuId = useId();

  const hold = () => {
    if (shutting.current) clearTimeout(shutting.current);
    shutting.current = null;
    setOpen(true);
  };

  const release = () => {
    if (shutting.current) clearTimeout(shutting.current);
    shutting.current = setTimeout(() => setOpen(false), 160);
  };

  useEffect(() => {
    if (!open) return;

    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // A pending close must not fire after the component has gone.
  useEffect(() => () => {
    if (shutting.current) clearTimeout(shutting.current);
  }, []);

  return (
    <div
      className="navmenu"
      ref={wrap}
      onMouseEnter={hold}
      onMouseLeave={release}
      onFocus={hold}
      onBlur={(e) => {
        if (!wrap.current?.contains(e.relatedTarget as Node)) release();
      }}
    >
      <button
        type="button"
        className={
          "topnav-link navmenu-trigger" +
          (active ? " is-current" : "") +
          (open ? " is-open" : "")
        }
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((v) => !v)}
      >
        {label}
        <svg className="navmenu-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open ? (
        <div className="navmenu-panel" id={menuId} role="menu">
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              role="menuitem"
              className={item.current ? "navmenu-item is-current" : "navmenu-item"}
              onClick={() => setOpen(false)}
            >
              <span className="navmenu-item-label">{item.label}</span>
              <span className="navmenu-item-note">{item.note}</span>
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}
