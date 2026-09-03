"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

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
 * button competing for the same row. Two of those links — Accounts and Keys —
 * are settings rather than places you work, and sat beside Runs and Loop as if
 * they were the same kind of thing. They live here now, with the theme and the
 * way out, which leaves the navigation showing only the three pages a run
 * actually happens on.
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
  current: "runs" | "loop" | "logs" | "domains" | "accounts" | "keys";
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

          <div className="profile-sep" />

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
            <span className={dark ? "switch is-on" : "switch"} aria-hidden>
              <span className="switch-knob" />
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
