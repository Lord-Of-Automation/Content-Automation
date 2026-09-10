"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { Website } from "@/lib/websites";

/**
 * Editing a website by describing the change.
 *
 * The visual editor is quicker for anything you can point at. This is for what
 * you cannot point at: the same disclaimer on nine pages, a tone made less
 * breathless throughout, a section added wherever it belongs. You say what you
 * want and watch it work through the pages.
 *
 * It shows its work while it happens. An edit that reads four pages and
 * rewrites three takes minutes, and a spinner for minutes is indistinguishable
 * from a broken page, so each page it opens and each page it changes is said
 * out loud as it goes.
 *
 * Nothing is saved until the whole edit finishes, and the version it replaced
 * is kept. So the way out of an edit that went wrong is the Versions tab, one
 * click, and the site is back.
 */

interface Turn {
  role: "user" | "assistant";
  content: string;
  /** What was changed during this answer, in the order it happened. */
  did?: string[];
}

const OPENERS = [
  "Make the homepage shorter and less breathless",
  "Add a short FAQ to every page that does not have one",
  "Change the accent colour to a deep green",
];

/** What to try when something in the page is selected, which is a different job. */
const ABOUT_THIS = [
  "Rewrite this so it is shorter",
  "Make this less breathless",
  "Expand this with a concrete example",
];

/** What is selected in the page, as the editor describes it. */
export interface Pointed {
  label: string;
  path: string[];
  where: "page" | "chrome";
  text: string;
  html: string;
  page: string;
  pageTitle: string;
}

export default function SiteAssistant({
  id,
  siteName,
  dirty,
  selection,
  onSave,
  onEdited,
  onClose,
}: {
  id: string;
  siteName: string;
  /** Whether the editor is holding changes that are not written down yet. */
  dirty: boolean;
  /**
   * What is being pointed at in the page, when anything is.
   *
   * The visual editor is where you say "this one" and this is where you say
   * what to do with it, and the two used to have no way of meaning the same
   * thing. Sent with the question rather than pasted into it, so the words a
   * person types stay the words they typed.
   */
  selection: Pointed | null;
  onSave: () => Promise<void> | void;
  /** The site as it stands after an edit, so the editor can show it. */
  onEdited: (site: Website) => void;
  onClose: () => void;
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [doing, setDoing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /**
   * Whether the question is about what is selected.
   *
   * On whenever something is, and turned off by hand. A request that quietly
   * carried a selection somebody had forgotten they made would answer a
   * question nobody asked, so it is always visible and always dismissable.
   */
  const [about, setAbout] = useState(true);

  const thread = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const running = useRef<AbortController | null>(null);

  useEffect(() => {
    box.current?.focus();
  }, []);

  /** One string, so a changed selection is one dependency rather than four. */
  const pointing = selection
    ? `${selection.page}|${selection.label}|${selection.text}`
    : "";

  // A new selection is a new thing to talk about, so it comes back switched on
  // however the last one was dismissed.
  useEffect(() => {
    if (pointing) setAbout(true);
  }, [pointing]);

  useEffect(() => {
    const el = thread.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, doing, busy]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Not while it is working. Escape during an edit would look like a way to
      // stop it, and the panel closing is not that.
      if (e.key === "Escape" && !busy) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const ask = useCallback(
    async (question: string) => {
      const text = question.trim();
      if (!text || busy || dirty) return;

      setDraft("");
      setError(null);
      setBusy(true);
      setDoing(null);

      const history = [...turns, { role: "user" as const, content: text }];
      setTurns([...history, { role: "assistant", content: "", did: [] }]);

      const stop = new AbortController();
      running.current = stop;

      let answer = "";
      const did: string[] = [];
      const show = () =>
        setTurns([...history, { role: "assistant" as const, content: answer, did: [...did] }]);

      try {
        const response = await fetch(`/api/websites/${id}/assist`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          /*
           * The selection travels beside the question rather than inside it.
           *
           * Folded into the text it would become part of the conversation for
           * good, so a follow-up three turns later would still be about a
           * paragraph nobody is pointing at any more. Sent separately, it
           * describes the moment the question was asked and nothing else.
           */
          body: JSON.stringify({
            messages: history,
            selection: about && selection ? selection : null,
          }),
          signal: stop.signal,
        });

        if (response.status === 401) {
          window.location.href = "/login";
          return;
        }
        if (!response.ok || !response.body) {
          const said = await response.json().catch(() => null);
          throw new Error(said?.error ?? `The editor returned ${response.status}.`);
        }

        /*
         * One JSON object per line, read as it arrives.
         *
         * Line delimited because the stream carries two different things at
         * once: the words of the answer, and what is being done to the site
         * while it is written. Plain text could carry only the first.
         */
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let rest = "";

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;

          rest += decoder.decode(value, { stream: true });
          const lines = rest.split("\n");
          // The last piece is whatever arrived without its newline yet.
          rest = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.trim()) continue;
            let event: Record<string, unknown>;
            try {
              event = JSON.parse(line);
            } catch {
              continue;
            }

            if (event.t === "text") {
              answer += String(event.v);
              show();
            } else if (event.t === "doing") {
              setDoing(String(event.v));
            } else if (event.t === "did") {
              did.push(String(event.v));
              show();
            } else if (event.t === "done") {
              setDoing(null);
              if (event.saved && event.website) onEdited(event.website as Website);
            } else if (event.t === "error") {
              throw new Error(String(event.v));
            }
          }
        }

        if (!answer.trim() && !did.length) {
          answer = "Nothing came back. Ask again?";
          show();
        }
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") {
          // Withdrawn on purpose. The server saves only at the end, so the site
          // is untouched and there is nothing to put back.
          setTurns(history);
          return;
        }
        setError(e instanceof Error ? e.message : "The edit could not be made.");
        setTurns(history);
      } finally {
        running.current = null;
        setDoing(null);
        setBusy(false);
      }
    },
    [about, busy, dirty, id, onEdited, selection, turns],
  );

  return (
    <aside className="sa-panel" aria-label={`Edit ${siteName} with Claude`}>
      <div className="sa-head">
        <div>
          <strong>Edit with Claude</strong>
          <span className="sa-sub">{siteName}</span>
        </div>
        <div className="sa-head-do">
          {turns.length && !busy ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setTurns([]);
                setError(null);
              }}
            >
              Clear
            </button>
          ) : null}
          <button
            type="button"
            className="ask-close"
            title="Close"
            aria-label="Close"
            onClick={onClose}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
      </div>

      {/* Unsaved work in the editor and an edit here would each overwrite the
          other, and the one that lost would be the one nobody was watching.
          Saying so is not enough on its own, so the box is closed until it is
          resolved, one way or the other. */}
      {dirty ? (
        <div className="notice warn sa-notice">
          <strong>You have changes that are not saved.</strong> Claude edits the
          saved site, so anything unsaved here would be written over. Save them
          first, or undo them.
          <div className="sa-notice-do">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => void onSave()}
            >
              Save changes
            </button>
          </div>
        </div>
      ) : null}

      <div className="sa-thread" ref={thread}>
        {!turns.length ? (
          <div className="ask-empty">
            <p>
              Describe the change and it works through the pages itself. It reads
              a page before it rewrites it, saves once at the end, and keeps the
              version it replaced, so anything here undoes on the Versions tab.
            </p>
            <div className="ask-openers">
              {(selection && about ? ABOUT_THIS : OPENERS).map((line) => (
                <button
                  key={line}
                  type="button"
                  className="ask-opener"
                  disabled={busy || dirty}
                  onClick={() => void ask(line)}
                >
                  {line}
                </button>
              ))}
            </div>
          </div>
        ) : (
          turns.map((turn, i) => (
            <div key={i} className={turn.role === "user" ? "ask-turn is-mine" : "ask-turn"}>
              {/* What it changed, above what it said about it. The list is the
                  part somebody checks; the prose is the part they read once. */}
              {turn.did?.length ? (
                <ul className="sa-did">
                  {turn.did.map((line, n) => (
                    <li key={n}>{line}</li>
                  ))}
                </ul>
              ) : null}

              {turn.content ? (
                turn.content.split(/\n{2,}/).map((para, n) => <p key={n}>{para}</p>)
              ) : turn.did?.length ? null : (
                <p className="ask-thinking">
                  <span />
                  <span />
                  <span />
                </p>
              )}
            </div>
          ))
        )}

        {doing ? (
          <p className="sa-doing">
            <span className="sa-spin" aria-hidden />
            {doing}
          </p>
        ) : null}
      </div>

      {error ? <p className="notice bad ask-error">{error}</p> : null}

      {/*
        * What the question is about, when it is about something in particular.
        *
        * Sits directly above the box rather than at the top of the panel,
        * because it is part of the question being composed and not part of the
        * conversation that has already happened.
        */}
      {selection && about ? (
        <div className="sa-about">
          <div className="sa-about-what">
            <span className="sa-about-tag">{selection.label}</span>
            <span className="sa-about-text">
              {selection.text
                ? selection.text.slice(0, 120)
                : selection.where === "chrome"
                  ? "in the header or footer"
                  : "no words in it"}
            </span>
          </div>
          <button
            type="button"
            className="ask-close sa-about-drop"
            title="Ask about the whole site instead"
            aria-label="Ask about the whole site instead"
            onClick={() => setAbout(false)}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
      ) : null}

      <form
        className="ask-compose"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(draft);
        }}
      >
        <textarea
          ref={box}
          rows={2}
          value={draft}
          disabled={dirty}
          placeholder={
            dirty
              ? "Save your changes first"
              : selection && about
                ? `What should happen to this ${selection.label}?`
                : "Describe the change"
          }
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void ask(draft);
            }
          }}
        />
        {busy ? (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => running.current?.abort()}
            title="Stop. Nothing has been saved yet, so the site is untouched."
          >
            Stop
          </button>
        ) : (
          <button
            type="submit"
            className="btn btn-primary btn-sm"
            disabled={!draft.trim() || dirty}
          >
            Send
          </button>
        )}
      </form>
    </aside>
  );
}
