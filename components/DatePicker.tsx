"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/**
 * A calendar that looks like the rest of the console.
 *
 * The native date input renders differently in every browser and cannot be
 * styled: Chrome draws a grey spinner triple, Safari a stepper, Firefox
 * something else again, and none of them take the panel's colours. On a page
 * where every other control is hand-built, it was the one thing that announced
 * which browser you were in.
 *
 * It is also the wrong shape for this job. These dates are all a year out, and
 * a native picker opens on today and makes you page forward twelve times. This
 * one opens on the month the value is in, or on a year from today when there is
 * no value, and offers "a year from today" as a single button — which is the
 * answer for every token here, since that is the longest life GoDaddy grants.
 *
 * The value is an ISO date, "2027-04-20", so it goes into the API unchanged.
 */

const DAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Local parts, never UTC. new Date("2027-04-20") is midnight UTC, which is the
 *  day before in the Americas, so a picker built on it shows the wrong date. */
function parseISO(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const at = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(at.getTime()) ? null : at;
}

function toISO(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** The cells for one month, padded so the first row starts on a Monday. */
function gridFor(year: number, month: number): Array<Date | null> {
  const first = new Date(year, month, 1);
  // getDay is Sunday-first; these calendars are Monday-first.
  const lead = (first.getDay() + 6) % 7;
  const days = new Date(year, month + 1, 0).getDate();

  const cells: Array<Date | null> = Array(lead).fill(null);
  for (let d = 1; d <= days; d += 1) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export default function DatePicker({
  id,
  value,
  onChange,
  placeholder = "not set",
}: {
  id: string;
  /** ISO "YYYY-MM-DD", or "" for none. */
  value: string;
  onChange: (iso: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = useMemo(() => parseISO(value), [value]);
  const today = useMemo(() => new Date(), []);

  // A year out is where these dates live, so that is where the calendar opens
  // when there is nothing to open on.
  const [cursor, setCursor] = useState<Date>(() => {
    const at = parseISO(value);
    if (at) return new Date(at.getFullYear(), at.getMonth(), 1);
    const ahead = new Date();
    ahead.setFullYear(ahead.getFullYear() + 1);
    return new Date(ahead.getFullYear(), ahead.getMonth(), 1);
  });

  const wrap = useRef<HTMLDivElement>(null);

  // Follow the value when it changes from outside, so reopening the picker
  // after a save does not show a month unrelated to what is in the box.
  useEffect(() => {
    const at = parseISO(value);
    if (at) setCursor(new Date(at.getFullYear(), at.getMonth(), 1));
  }, [value]);

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

  const cells = gridFor(cursor.getFullYear(), cursor.getMonth());

  const step = (months: number) =>
    setCursor((c) => new Date(c.getFullYear(), c.getMonth() + months, 1));

  const pick = (date: Date) => {
    onChange(toISO(date));
    setOpen(false);
  };

  const inAYear = () => {
    const at = new Date();
    at.setFullYear(at.getFullYear() + 1);
    pick(at);
  };

  const label = selected
    ? selected.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })
    : placeholder;

  return (
    <div className="datepick" ref={wrap}>
      <button
        type="button"
        id={id}
        className={open ? "datepick-trigger is-open" : "datepick-trigger"}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M3 10h18M8 3v4M16 3v4" />
        </svg>
        <span className={selected ? "datepick-value" : "datepick-value is-empty"}>{label}</span>
        {selected ? (
          // A span, not a button: a button inside a button is invalid markup
          // and the browser silently hoists it out, which breaks the trigger.
          <span
            role="button"
            tabIndex={0}
            className="datepick-clear"
            title="Clear the date"
            onClick={(e) => {
              e.stopPropagation();
              onChange("");
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                onChange("");
              }
            }}
          >
            ×
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="datepick-panel" role="dialog" aria-label="Choose a date">
          <div className="datepick-head">
            <button type="button" className="datepick-step" onClick={() => step(-1)} aria-label="Previous month">
              ‹
            </button>
            <span className="datepick-month">
              {MONTHS[cursor.getMonth()]} {cursor.getFullYear()}
            </span>
            <button type="button" className="datepick-step" onClick={() => step(1)} aria-label="Next month">
              ›
            </button>
          </div>

          <div className="datepick-days">
            {DAYS.map((d) => (
              <span key={d} className="datepick-dayname">
                {d}
              </span>
            ))}
            {cells.map((date, at) =>
              date ? (
                <button
                  type="button"
                  key={toISO(date)}
                  className={
                    "datepick-day" +
                    (selected && sameDay(date, selected) ? " is-selected" : "") +
                    (sameDay(date, today) ? " is-today" : "") +
                    (date < today && !sameDay(date, today) ? " is-past" : "")
                  }
                  onClick={() => pick(date)}
                >
                  {date.getDate()}
                </button>
              ) : (
                <span key={`pad-${at}`} className="datepick-pad" />
              ),
            )}
          </div>

          {/* The answer for every token on this page, since a year is the
              longest life GoDaddy grants one. */}
          <div className="datepick-foot">
            <button type="button" className="datepick-shortcut" onClick={inAYear}>
              A year from today
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
