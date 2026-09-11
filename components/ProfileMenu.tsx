"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import type { Section } from "@/lib/nav";

type Theme = "light" | "dark";

/** Read whatever the no-flash script in the layout already decided. */
function currentTheme(): Theme {
  if (typeof document === "undefined") return "light";
  const set = document.documentElement.getAttribute("data-theme");
  if (set === "light" || set === "dark") return set;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function UserIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function Chevron() {
  return (
    <svg className="profile-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

/**
 * Everything about the person using the console, behind one control.
 *
 * The header was five navigation links, a name, a theme button and a sign-out
 * button competing for the same row. Three of those links — Accounts, Keys and
 * the activity log — are not places you work: two are settings, and the third
 * is a record you read when something has already gone wrong. They sat beside
 * Runs and Loop as if they were the same kind of thing. They live here now,
 * with the theme and the way out, which leaves the navigation showing only the
 * pages work actually happens on.
 *
 * Sign out stays a form posting to the server action, so it works with
 * JavaScript disabled and cannot be triggered by a stray click being replayed.
 */
export default function ProfileMenu({
  name,
  current,
  signOut,
}: {
  name: string;
  current: Section;
  /** The logout server action, handed down from the server component. */
  signOut: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  // Null until mounted. The server cannot know the viewer's OS setting, so
  // naming the theme during SSR would guarantee a hydration mismatch.
  const [theme, setTheme] = useState<Theme | null>(null);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => setTheme(currentTheme()), []);

  // Close on a click anywhere else, and on Escape. Both are what a menu is
  // expected to do, and neither is worth a dependency.
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

  function toggleTheme() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("ca:theme", next);
    } catch {
      // Private windows and blocked site data throw here. The change still
      // applies to this page view; it just will not be remembered.
    }
    setTheme(next);
  }

  const dark = theme === "dark";

  return (
    <div className="profile" ref={wrap}>
      <button
        type="button"
        className={open ? "profile-trigger is-open" : "profile-trigger"}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <UserIcon />
        <span className="profile-name">{name}</span>
        <Chevron />
      </button>

      {open ? (
        <div className="profile-menu" role="menu">
          <div className="profile-menu-head">
            <span className="profile-menu-name">{name}</span>
            <span className="profile-menu-note">Signed in</span>
          </div>

          <Link
            href="/accounts"
            role="menuitem"
            className={
              current === "accounts" ? "profile-item is-current" : "profile-item"
            }
            onClick={() => setOpen(false)}
          >
            {/* A globe, not a person. These are logins to other people's
                WordPress sites, not accounts on this console. */}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <circle cx="12" cy="12" r="9" />
              <path d="M3 12h18M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18Z" />
            </svg>
            Website Accounts
          </Link>

          <Link
            href="/keys"
            role="menuitem"
            className={current === "keys" ? "profile-item is-current" : "profile-item"}
            onClick={() => setOpen(false)}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M21 2l-2 2m-7.6 7.6a5 5 0 1 1-7 7 5 5 0 0 1 7-7Zm0 0L15 8m0 0 3 3 3-3-3-3" />
            </svg>
            Keys
          </Link>

          <Link
            href="/logs"
            role="menuitem"
            className={current === "logs" ? "profile-item is-current" : "profile-item"}
            onClick={() => setOpen(false)}
          >
            {/* A list with a tick beside it: this is the record of what was
                done and by whom, not a stack of error output. */}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M9 5h10M9 12h10M9 19h10M4.5 5.5l1 1 2-2M4.5 12.5l1 1 2-2M4.5 19.5l1 1 2-2" />
            </svg>
            Activity log
          </Link>

          {/* With the other things that change how the platform behaves
              rather than what it is looking at. An instruction attached to a
              site is set once and then forgotten about, which is what the
              pages in this menu have in common. */}
          <Link
            href="/prompts"
            role="menuitem"
            className={current === "prompts" ? "profile-item is-current" : "profile-item"}
            onClick={() => setOpen(false)}
          >
            {/* A page with lines on it and a pen. */}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M13 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8" />
              <path d="M9 8h5M9 12h4M9 16h3" />
              <path d="m17.5 3.5 3 3L15 12l-3.5.5.5-3.5Z" />
            </svg>
            Prompts
          </Link>

          <div className="profile-sep" />

          {/* Beside the dark mode switch rather than up with the pages,
              because it is the same subject: this one chooses the colours,
              that one chooses which set of them is showing. */}
          <Link
            href="/design"
            role="menuitem"
            className={current === "design" ? "profile-item is-current" : "profile-item"}
            onClick={() => setOpen(false)}
          >
            {/* A swatch on a palette. */}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M12 3a9 9 0 1 0 0 18c.8 0 1.5-.7 1.5-1.5 0-.4-.2-.8-.4-1-.3-.3-.4-.6-.4-1 0-.9.7-1.5 1.5-1.5H16a5 5 0 0 0 5-5c0-4.4-4-8-9-8Z" />
              <circle cx="7.5" cy="12" r="1.1" fill="currentColor" stroke="none" />
              <circle cx="10" cy="7.8" r="1.1" fill="currentColor" stroke="none" />
              <circle cx="15" cy="8.2" r="1.1" fill="currentColor" stroke="none" />
            </svg>
            Appearance
          </Link>

          {/* Left in place while the theme is unknown, so the menu does not
              change height on the first frame after it opens. */}
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={dark}
            className="profile-item profile-item-toggle"
            onClick={toggleTheme}
            disabled={theme === null}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
            </svg>
            Dark mode
            <span className={dark ? "profile-switch is-on" : "profile-switch"} aria-hidden>
              <span className="profile-switch-knob" />
            </span>
          </button>

          <div className="profile-sep" />

          <form action={signOut}>
            <button type="submit" role="menuitem" className="profile-item profile-item-bad">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
              </svg>
              Sign out
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
