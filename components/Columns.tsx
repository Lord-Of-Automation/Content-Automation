"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * Choosing which columns a table shows.
 *
 * The domains table is eleven columns because eleven facts are worth having
 * somewhere. They are not all worth having at once: somebody checking renewals
 * does not need the name servers, and somebody moving DNS does not need the
 * prices. Hiding the rest is what turns a wide table into a readable one, and
 * it costs nothing to put back.
 *
 * What is remembered is which columns are HIDDEN, not which are shown. That
 * looks like a detail and decides how this ages: a column added next year
 * appears for everybody, instead of being invisible to every person who ever
 * touched this menu.
 *
 * Some columns cannot be hidden. The tick boxes and the row actions are not
 * facts about the thing, they are how you act on it, and a table where those
 * can be turned off is a table somebody can lock themselves out of.
 */

export interface ColumnSpec {
  key: string;
  label: string;
  /** Always shown, and not offered in the menu. */
  fixed?: boolean;
  /** Hidden until somebody asks for it, rather than shown until they do not. */
  offByDefault?: boolean;
}

interface Chosen {
  /** Whether this column is drawn. */
  shown: (key: string) => boolean;
  hidden: Set<string>;
  toggle: (key: string) => void;
  showAll: () => void;
  /** How many the reader has turned off, for the button to say so. */
  count: number;
}

/**
 * The choice, kept in this browser.
 *
 * Local rather than on the account on purpose. Which columns you want is a
 * property of the screen you are sitting at as much as of the work, and
 * somebody on a laptop should not have their choice followed onto a monitor.
 */
export function useColumns(name: string, specs: ColumnSpec[]): Chosen {
  const key = `ca:cols:${name}`;

  const initial = useMemo(
    () => new Set(specs.filter((s) => s.offByDefault && !s.fixed).map((s) => s.key)),
    [specs],
  );

  const [hidden, setHidden] = useState<Set<string>>(initial);

  /*
   * Read after mounting, not during.
   *
   * The server renders this too and cannot see localStorage, so reading it in
   * the initial state would render one thing on the server and another in the
   * browser, which React reports as a hydration mismatch.
   */
  useEffect(() => {
    try {
      const kept = window.localStorage.getItem(key);
      if (kept) setHidden(new Set(JSON.parse(kept) as string[]));
    } catch {
      // A browser that refuses storage still gets a working table.
    }
  }, [key]);

  const remember = useCallback(
    (next: Set<string>) => {
      setHidden(next);
      try {
        window.localStorage.setItem(key, JSON.stringify([...next]));
      } catch {
        // As above.
      }
    },
    [key],
  );

  const fixed = useMemo(
    () => new Set(specs.filter((s) => s.fixed).map((s) => s.key)),
    [specs],
  );

  const toggle = useCallback(
    (which: string) => {
      if (fixed.has(which)) return;
      const next = new Set(hidden);
      if (next.has(which)) next.delete(which);
      else next.add(which);
      remember(next);
    },
    [fixed, hidden, remember],
  );

  return {
    shown: (which: string) => fixed.has(which) || !hidden.has(which),
    hidden,
    toggle,
    showAll: () => remember(new Set()),
    count: specs.filter((s) => !s.fixed && hidden.has(s.key)).length,
  };
}

function ColumnsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9.5 4v16M15 4v16" />
    </svg>
  );
}

/**
 * The menu itself.
 *
 * A popover rather than a dialog: it is a preference somebody adjusts while
 * looking at the table, and a dialog would cover the thing being adjusted.
 */
export function ColumnPicker({
  specs,
  chosen,
  label = "Columns",
}: {
  specs: ColumnSpec[];
  chosen: Chosen;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  const offerable = specs.filter((s) => !s.fixed);

  /*
   * The last one standing cannot be turned off.
   *
   * A table with every optional column hidden is a column of tick boxes and a
   * column of buttons, which reads as a bug rather than as a choice.
   */
  const onlyOne = offerable.filter((s) => chosen.shown(s.key)).length <= 1;

  return (
    <div className="cols" ref={wrap}>
      <button
        type="button"
        className={chosen.count ? "btn btn-ghost btn-sm is-on" : "btn btn-ghost btn-sm"}
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((on) => !on)}
        title="Choose which columns this table shows"
      >
        <ColumnsIcon />
        {label}
        {chosen.count ? <span className="cols-count">{chosen.count} hidden</span> : null}
      </button>

      {open ? (
        <div className="cols-panel" role="group" aria-label="Columns shown">
          <div className="cols-list">
            {offerable.map((spec) => {
              const on = chosen.shown(spec.key);
              return (
                <label className="cols-item" key={spec.key}>
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={on && onlyOne}
                    onChange={() => chosen.toggle(spec.key)}
                  />
                  <span>{spec.label}</span>
                </label>
              );
            })}
          </div>

          <div className="cols-foot">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={!chosen.count}
              onClick={() => chosen.showAll()}
            >
              Show all
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
