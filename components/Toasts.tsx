"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Feedback about something you just did, out of the way of what you were doing.
 *
 * The alternative was a notice pinned into the page, which pushed the list down
 * and stayed there until the next action replaced it — so "the loop is paused"
 * sat on screen long after anyone cared, and moved the row you were reaching
 * for while you reached.
 *
 * Success goes away on its own; failure does not. A message you might want and
 * a message you need to read are not the same thing, and four seconds is fine
 * for the first and much too short for the second.
 */

export type ToastTone = "ok" | "bad";

export interface Toast {
  id: number;
  tone: ToastTone;
  text: string;
  /** On its way out. Kept in the list until the exit animation has played. */
  leaving?: boolean;
}

/** How long a success stays. Long enough to read twice, short enough to ignore. */
const LINGER = 4000;

/**
 * How long the exit takes, and how long removal waits for it.
 *
 * One number, because the two have to agree: remove sooner and the toast
 * vanishes mid-slide, later and there is a gap where it has finished animating
 * and is still occupying the stack. Kept in step with toast-out in globals.css.
 */
const EXIT = 200;

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const leaving = useRef(new Set<number>());

  /**
   * Starts a toast leaving.
   *
   * Two steps rather than one: marked first so it can animate out, removed when
   * that has finished. Removing it outright would make it disappear rather than
   * leave, and the stack below it would snap up to fill the space.
   */
  const dismiss = useCallback((id: number) => {
    // A success auto-dismissing at the moment someone clicks its × must not
    // start leaving twice, or the second timer fires against a toast that has
    // already gone. Tracked in a ref rather than read off state: a state
    // updater has not run by the time the next line needs the answer.
    if (leaving.current.has(id)) return;
    leaving.current.add(id);

    const linger = timers.current.get(id);
    if (linger) {
      clearTimeout(linger);
      timers.current.delete(id);
    }

    setToasts((current) =>
      current.map((t) => (t.id === id ? { ...t, leaving: true } : t)),
    );

    timers.current.set(
      id,
      setTimeout(() => {
        timers.current.delete(id);
        leaving.current.delete(id);
        setToasts((current) => current.filter((t) => t.id !== id));
      }, EXIT),
    );
  }, []);

  const push = useCallback(
    (tone: ToastTone, text: string) => {
      const id = nextId.current++;
      // Capped, because a stack taller than the screen is not feedback. Oldest
      // goes, since the newest is the one describing what just happened.
      setToasts((current) => [...current, { id, tone, text }].slice(-4));
      if (tone === "ok") {
        timers.current.set(id, setTimeout(() => dismiss(id), LINGER));
      }
      return id;
    },
    [dismiss],
  );

  // Leaving a timer running against an unmounted component is a warning in the
  // console and a wasted callback; navigating away mid-toast does exactly that.
  useEffect(() => {
    const pending = timers.current;
    const going = leaving.current;
    return () => {
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
      going.clear();
    };
  }, []);

  return { toasts, push, dismiss };
}

export function Toasts({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: number) => void;
}) {
  if (!toasts.length) return null;

  return (
    // polite rather than assertive: this reports what happened, it does not
    // interrupt. Failures are read on their own terms, since they stay put.
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`toast toast-${toast.tone}${toast.leaving ? " is-leaving" : ""}`}
        >
          <span>{toast.text}</span>
          <button
            type="button"
            className="toast-x"
            aria-label="Dismiss"
            onClick={() => onDismiss(toast.id)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
