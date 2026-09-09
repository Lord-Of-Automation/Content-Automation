"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

/**
 * Asking a question, in this console's own words.
 *
 * Four places still used window.confirm and window.prompt. They work, and they
 * are the one part of this product drawn entirely by the browser: a box at the
 * top of the screen in the operating system's font, saying the site's hostname
 * above the question, with buttons the app cannot label. On a page that has had
 * this much attention paid to it they read as something going wrong.
 *
 * The awkward part is not the drawing, it is the shape. window.confirm stops
 * the world and hands back an answer, so every call site is a single line in
 * the middle of an async function. A dialog component is state and callbacks,
 * which means restructuring each of those functions around it, and four
 * restructurings is four chances to change what the code does while changing
 * how it looks.
 *
 * So this keeps the shape and replaces the drawing. `await ask.confirm(...)`
 * reads like the line it replaces and resolves when somebody answers.
 *
 * Built on <dialog> and showModal, like the confirmation this sits beside:
 * focus trapping, an inert backdrop and Escape handling are the browser's to
 * get right, and a hand-rolled overlay reimplements all three and usually gets
 * one of them wrong.
 */

interface ConfirmOptions {
  title: string;
  body?: React.ReactNode;
  /** The button that does the thing. */
  confirmLabel?: string;
  cancelLabel?: string;
  /** Whether the action destroys something. Decides the button's colour. */
  tone?: "danger" | "normal";
}

interface PromptOptions extends ConfirmOptions {
  label: string;
  placeholder?: string;
  initial?: string;
  /** Rejected with this note until it looks right. */
  validate?: (value: string) => string | null;
}

interface Asking {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  /** Resolves with what was typed, or null if it was dismissed. */
  prompt: (options: PromptOptions) => Promise<string | null>;
}

const Context = createContext<Asking | null>(null);

/**
 * The way to ask.
 *
 * Throws rather than degrading when the provider is missing, because the
 * degraded version is window.confirm, and silently falling back to the thing
 * this exists to replace is how it comes back.
 */
export function useAsk(): Asking {
  const asking = useContext(Context);
  if (!asking) {
    throw new Error("useAsk needs <Ask> above it, which the layout provides.");
  }
  return asking;
}

type Question =
  | ({ kind: "confirm"; settle: (answer: boolean) => void } & ConfirmOptions)
  | ({ kind: "prompt"; settle: (answer: string | null) => void } & PromptOptions);

export default function Ask({ children }: { children: React.ReactNode }) {
  const [question, setQuestion] = useState<Question | null>(null);
  const [value, setValue] = useState("");
  const [note, setNote] = useState<string | null>(null);

  const dialog = useRef<HTMLDialogElement>(null);
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;

    if (question && !el.open) {
      el.showModal();
      // After the browser has it open, or the field is not there to focus yet.
      if (question.kind === "prompt") field.current?.select();
    } else if (!question && el.open) {
      el.close();
    }
  }, [question]);

  /*
   * Answering, once, whatever route the answer came by.
   *
   * A dialog can be dismissed three ways — the cancel button, Escape and a
   * click on the backdrop — and a promise settled twice is a bug that only
   * shows up in whichever of the three somebody used second.
   */
  const answer = useCallback(
    (given: boolean | string | null) => {
      setQuestion((current) => {
        if (!current) return null;
        if (current.kind === "confirm") current.settle(given === true);
        else current.settle(typeof given === "string" ? given : null);
        return null;
      });
      setValue("");
      setNote(null);
    },
    [],
  );

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;

    // Escape closes a <dialog> natively, which would leave the promise hanging
    // and this component thinking it is still open.
    const onCancel = (event: Event) => {
      event.preventDefault();
      answer(null);
    };
    el.addEventListener("cancel", onCancel);
    return () => el.removeEventListener("cancel", onCancel);
  }, [answer]);

  const asking = useMemo<Asking>(
    () => ({
      confirm: (options) =>
        new Promise<boolean>((settle) => {
          setNote(null);
          setValue("");
          setQuestion({ kind: "confirm", settle, ...options });
        }),
      prompt: (options) =>
        new Promise<string | null>((settle) => {
          setNote(null);
          setValue(options.initial ?? "");
          setQuestion({ kind: "prompt", settle, ...options });
        }),
    }),
    [],
  );

  function submit() {
    if (!question) return;
    if (question.kind === "confirm") return answer(true);

    const typed = value.trim();
    const wrong = question.validate?.(typed) ?? (typed ? null : "This cannot be empty.");
    if (wrong) {
      setNote(wrong);
      field.current?.focus();
      return;
    }
    answer(typed);
  }

  const danger = question?.tone === "danger";

  return (
    <Context.Provider value={asking}>
      {children}

      <dialog
        ref={dialog}
        className="confirm ask-dialog"
        aria-labelledby="ask-title"
        onClick={(event) => {
          // A click on the dialog element itself is the backdrop: the card
          // inside covers everything visible.
          if (event.target === dialog.current) answer(null);
        }}
      >
        {question ? (
          <form
            className="confirm-card"
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <h3 id="ask-title" className="confirm-title">
              {question.title}
            </h3>

            {question.body ? <div className="confirm-body">{question.body}</div> : null}

            {question.kind === "prompt" ? (
              <div className="field ask-field">
                <label htmlFor="ask-input">{question.label}</label>
                <input
                  id="ask-input"
                  ref={field}
                  type="text"
                  value={value}
                  placeholder={question.placeholder}
                  autoFocus
                  onChange={(event) => {
                    setValue(event.target.value);
                    if (note) setNote(null);
                  }}
                />
                {note ? <div className="ask-note">{note}</div> : null}
              </div>
            ) : null}

            <div className="confirm-actions">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => answer(null)}
                /* The safe option takes focus on a confirmation, so Enter
                   dismisses rather than destroys. On a prompt the field wants
                   it, and Enter there means "what I typed". */
                autoFocus={question.kind === "confirm"}
              >
                {question.cancelLabel ?? "Cancel"}
              </button>
              <button type="submit" className={danger ? "btn btn-danger" : "btn btn-primary"}>
                {question.confirmLabel ?? (danger ? "Delete" : "OK")}
              </button>
            </div>
          </form>
        ) : null}
      </dialog>
    </Context.Provider>
  );
}
