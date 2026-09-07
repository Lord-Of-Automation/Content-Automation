"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The application login, in one of two shapes.
 *
 * Hidden until asked for either way, which is not ceremony. The table runs to
 * hundreds of rows, and a page that paints hundreds of passwords is one screen
 * share or one scrolled screenshot away from leaking every site at once.
 * Revealing one at a time keeps the blast radius to the row somebody needed.
 *
 * Copy never reveals. Most of the time the password is wanted in a login box
 * rather than on screen, and the clipboard gets it there without it appearing.
 *
 * The boxed shape is for the Access tab, where there is room to label each
 * value and set it in a field of its own. It looks like a form and is not one:
 * these are values to read and copy, and an input would invite editing that
 * goes nowhere. The compact shape is for the table, where two lines and a few
 * words of control is all the width there is.
 */
export default function AppCredential({
  user,
  password,
  boxed = false,
}: {
  user: string;
  password: string;
  /** The roomy, labelled form. Otherwise the two-line one for a table cell. */
  boxed?: boolean;
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

  if (boxed) {
    return (
      <div className="cred-boxed">
        <div className="cred-field">
          <span className="cred-label">Username</span>
          <div className="cred-row">
            <div className="cred-box">
              {user || <span className="quiet">none recorded</span>}
            </div>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => void copy("user", user)}
              disabled={!user}
            >
              {copied === "user" ? "Copied" : "Copy"}
            </button>
          </div>
        </div>

        <div className="cred-field">
          <span className="cred-label">Password</span>
          <div className="cred-row">
            <div className="cred-box cred-box-secret">
              {password ? (
                shown ? (
                  password
                ) : (
                  "•".repeat(12)
                )
              ) : (
                <span className="quiet">none recorded</span>
              )}
            </div>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setShown((v) => !v)}
              disabled={!password}
            >
              {shown ? "Hide" : "Show"}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => void copy("password", password)}
              disabled={!password}
            >
              {copied === "password" ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      </div>
    );
  }

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
