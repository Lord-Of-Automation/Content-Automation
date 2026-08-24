"use client";

import { useState } from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { login, type LoginState } from "@/app/actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary" disabled={pending}>
      {pending ? "Signing in…" : "Sign in"}
    </button>
  );
}

function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M10.6 6.2A9.9 9.9 0 0 1 12 6c6.4 0 10 7 10 7a17.7 17.7 0 0 1-3.1 4.1M6.6 6.6A17.7 17.7 0 0 0 2 13s3.6 7 10 7c2 0 3.7-.7 5.1-1.6" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
      <path d="M3 3l18 18" />
    </svg>
  );
}

export default function LoginForm() {
  const [state, formAction] = useActionState<LoginState, FormData>(login, {
    error: null,
  });
  const [showPassword, setShowPassword] = useState(false);

  return (
    <form action={formAction}>
      {state.error ? (
        <div className="alert alert-bad" role="alert">
          {state.error}
        </div>
      ) : null}

      <div className="field">
        <label htmlFor="username">Username</label>
        <input
          id="username"
          name="username"
          type="text"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          autoFocus
        />
      </div>

      <div className="field">
        <label htmlFor="password">Password</label>
        <div className="input-with-button">
          <input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            required
          />
          {/* type="button" matters: inside a form a bare button submits it. */}
          <button
            type="button"
            className="input-button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? "Hide password" : "Show password"}
            aria-pressed={showPassword}
            title={showPassword ? "Hide password" : "Show password"}
            tabIndex={-1}
          >
            {showPassword ? <EyeOffIcon /> : <EyeIcon />}
          </button>
        </div>
      </div>

      <div style={{ marginTop: 18 }}>
        <SubmitButton />
      </div>
    </form>
  );
}
