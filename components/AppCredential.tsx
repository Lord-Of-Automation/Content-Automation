"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The application login for one row.
 *
 * Hidden until asked for, which is not ceremony. This table runs to hundreds of
 * rows, and a page that paints hundreds of passwords is one screen share or one
 * scrolled screenshot away from leaking every site at once. Revealing one at a
 * time keeps the blast radius to the row somebody actually needed.
 *
 * Copy does not reveal. Most of the time the password is wanted in a login box
 * rather than on screen, and the clipboard gets it there without it ever being
 * displayed.
 */
export default function AppCredential({
  user,
  password,
}: {
  user: string;
  password: string;
}) {
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState<"user" | "password" | null>(null);
  const clearing = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (clearing.current) clearTimeout(clearing.current);
  }, []);

  async function copy(what: "user" | "password", value: string) {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(what);
      if (clearing.current) clearTimeout(clearing.current);
      clearing.current = setTimeout(() => setCopied(null), 1400);
    } catch {
      // Refused clipboard access, which browsers do outside a secure context.
      // Nothing to recover from: Show puts the value on screen instead.
    }
  }

  if (!user && !password) return <span className="quiet">&mdash;</span>;

  return (
    <div className="cred">
      <div className="cred-line">
        <span className="cred-value" title={user}>
          {user || <span className="quiet">no user</span>}
        </span>
        {user ? (
          <button type="button" className="cred-btn" onClick={() => void copy("user", user)}>
            {copied === "user" ? "copied" : "copy"}
          </button>
        ) : null}
      </div>

      <div className="cred-line">
        <span className="cred-value cred-secret">
          {password ? (shown ? password : "•".repeat(10)) : <span className="quiet">none</span>}
        </span>
        {password ? (
          <>
            <button type="button" className="cred-btn" onClick={() => setShown((v) => !v)}>
              {shown ? "hide" : "show"}
            </button>
            <button
              type="button"
              className="cred-btn"
              onClick={() => void copy("password", password)}
            >
              {copied === "password" ? "copied" : "copy"}
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}
