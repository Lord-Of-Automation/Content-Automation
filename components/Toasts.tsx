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
}

/** How long a success stays. Long enough to read twice, short enough to ignore. */
const LINGER = 4000;

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((current) => current.filter((t) => t.id !== id));
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
    return () => {
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
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
        <div key={toast.id} className={`toast toast-${toast.tone}`}>
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
