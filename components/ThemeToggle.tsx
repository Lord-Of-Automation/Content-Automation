"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark";

/** Read whatever the no-flash script in the layout already decided. */
function currentTheme(): Theme {
  if (typeof document === "undefined") return "light";
  const set = document.documentElement.getAttribute("data-theme");
  if (set === "light" || set === "dark") return set;
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export default function ThemeToggle() {
  // Rendered only after mount: the server cannot know the viewer's OS setting,
  // so labelling the button during SSR would guarantee a hydration mismatch.
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    setTheme(currentTheme());
  }, []);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("ca:theme", next);
    } catch {
      // Private windows and blocked site data throw here. The toggle still
      // works for this page view; it just will not be remembered.
    }
    setTheme(next);
  }

  if (theme === null) {
    // Hold the button's footprint so the header does not jump on mount.
    return <span className="btn btn-ghost theme-toggle" aria-hidden />;
  }

  const goingDark = theme === "light";

  return (
    <button
      type="button"
      onClick={toggle}
      className="btn btn-ghost theme-toggle"
      title={goingDark ? "Switch to dark theme" : "Switch to light theme"}
    >
      {goingDark ? (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      )}
      {goingDark ? "Dark" : "Light"}
    </button>
  );
}
