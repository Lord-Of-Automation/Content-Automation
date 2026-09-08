"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Claude, on the side of every page.
 *
 * A question asked while looking at the thing it is about is a different
 * question from one asked in another tab. The point of it being here rather
 * than a bookmark is that it costs nothing to ask.
 *
 * It answers as it thinks. A question worth asking often takes twenty seconds,
 * and twenty seconds of a spinner is indistinguishable from something broken;
 * words appearing is the difference between waiting and wondering.
 *
 * The key never comes here. It sits in the console's credential store and is
 * read on the way past by the route this talks to, which is why there is a
 * route at all rather than a request straight from this file.
 */

interface Turn {
  role: "user" | "assistant";
  content: string;
}

/**
 * Two ways to ask.
 *
 * Anything is the general one: it knows what any model knows and a paragraph
 * about this console. About Platform puts the platform's own reference in front
 * of it — the pages, the two programs, the vocabulary, and the handful of
 * things that are true here and surprising anywhere else — and tells it to
 * answer from that and to say when the reference does not cover something.
 *
 * A toggle rather than a guess at which was meant. The two give different
 * answers to the same words, and which one somebody wanted is not something to
 * infer from the question.
 */
const OPENERS: Record<"any" | "about", string[]> = {
  any: [
    "Write me a meta description for a Mystake review",
    "What is a canonical tag for?",
    "Rewrite this heading to be less generic",
  ],
  about: [
    "Why would a run finish with no pages written?",
    "What is the difference between Optimize and Loop?",
    "How do I get a generated website onto one of my Cloudways sites?",
  ],
};

/**
 * Claude's mark, as angles and lengths.
 *
 * Eleven blades, unevenly spaced and of unequal reach. The unevenness is the
 * whole point: spaced evenly at one length it becomes a generic asterisk.
 */
const BLADES: [number, number][] = [
  [0, 9], [33, 7.4], [66, 8.6], [98, 7.1], [131, 8.9], [164, 7.6],
  [196, 8.8], [229, 7.2], [262, 8.5], [295, 7.5], [328, 9],
];

export default function AskClaude() {
  const [open, setOpen] = useState(false);
  const [about, setAbout] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const thread = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const running = useRef<AbortController | null>(null);

  /*
   * The conversation, kept for the session only.
   *
   * Local to the browser, so it survives moving between pages — which is most
   * of the point of a panel that follows you around — and does not survive
   * being closed, because a chat kept forever is a chat somebody has to
   * remember to clear.
   */
  useEffect(() => {
    try {
      const kept = sessionStorage.getItem("ca:ask");
      if (kept) setTurns(JSON.parse(kept) as Turn[]);
    } catch {
      // A browser that refuses storage still gets a working panel.
    }
  }, []);

  useEffect(() => {
    try {
      sessionStorage.setItem("ca:ask", JSON.stringify(turns.slice(-24)));
    } catch {
      // As above.
    }
  }, [turns]);

  // Following the answer as it arrives, which is the only reason to stream it.
  useEffect(() => {
    const el = thread.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, busy]);

  useEffect(() => {
    if (open) box.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const ask = useCallback(
    async (question: string) => {
      const text = question.trim();
      if (!text || busy) return;

      setDraft("");
      setError(null);
      setBusy(true);

      const history = [...turns, { role: "user" as const, content: text }];
      // The empty assistant turn is what the answer is written into, so the
      // words appear where they will end up rather than jumping there at the end.
      setTurns([...history, { role: "assistant", content: "" }]);

      const stop = new AbortController();
      running.current = stop;

      try {
        const response = await fetch("/api/assistant", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ messages: history, about }),
          signal: stop.signal,
        });

        if (response.status === 401 && !response.headers.get("content-type")?.includes("text/plain")) {
          window.location.href = "/login";
          return;
        }

        if (!response.ok || !response.body) {
          const said = await response.json().catch(() => null);
          throw new Error(said?.error ?? `The assistant returned ${response.status}.`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let answer = "";

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          answer += decoder.decode(value, { stream: true });
          setTurns([...history, { role: "assistant", content: answer }]);
        }

        if (!answer.trim()) {
          setTurns([
            ...history,
            { role: "assistant", content: "Nothing came back. Ask again?" },
          ]);
        }
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") {
          // Stopped on purpose. Whatever arrived stays where it is.
          setTurns((rows) => rows.filter((r) => r.content.trim()));
          return;
        }
        setError(e instanceof Error ? e.message : "The assistant could not be reached.");
        setTurns(history);
      } finally {
        running.current = null;
        setBusy(false);
      }
    },
    [about, busy, turns],
  );

  return (
    <>
{/* The tab is the way in, and only that. Left on screen while the panel
          is open it sits on top of the thing it opened. */}
      {!open ? (
        <button
          type="button"
          className="ask-tab"
          aria-expanded={false}
          aria-controls="ask-claude"
          title="Ask Claude"
          onClick={() => setOpen(true)}
        >
          {/* Claude's mark, drawn rather than loaded: it takes the button's
              own colour and costs no request. Blades taper outward from a
              shared centre, at uneven lengths, which is what makes the shape
              read as the mark rather than as an asterisk. */}
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <g transform="translate(12 12)">
              {BLADES.map(([turn, reach], i) => (
                <path
                  key={i}
                  d={`M0 0 L-1.35 ${-reach} Q0 ${-reach - 1.35} 1.35 ${-reach} Z`}
                  transform={`rotate(${turn})`}
                />
              ))}
            </g>
          </svg>
          <span className="ask-tab-word">Ask Claude</span>
        </button>
      ) : null}

      {open ? (
        <aside className="ask-panel" id="ask-claude" aria-label="Ask Claude">
          <div className="ask-head">
            <strong>Ask Claude</strong>
            <div className="ask-head-do">
              {turns.length ? (
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
                title="Close (Escape)"
                aria-label="Close"
                onClick={() => setOpen(false)}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
          </div>

          <div className="seg seg-sm ask-modes">
            <button
              type="button"
              className={about ? "seg-btn" : "seg-btn is-on"}
              onClick={() => setAbout(false)}
            >
              Anything
            </button>
            <button
              type="button"
              className={about ? "seg-btn is-on" : "seg-btn"}
              onClick={() => setAbout(true)}
            >
              About Platform
            </button>
          </div>

          <div className="ask-thread" ref={thread}>
            {!turns.length ? (
              <div className="ask-empty">
                <p>
                  {about
                    ? "Questions about this platform, answered from its own reference: the pages, what runs do, how publishing works. It will say when the reference does not cover something."
                    : "Anything at all. Writing, a second opinion, a question about how something works. It knows roughly what this console is; switch above for answers from its reference."}
                </p>
                <div className="ask-openers">
                  {OPENERS[about ? "about" : "any"].map((line) => (
                    <button
                      key={line}
                      type="button"
                      className="ask-opener"
                      onClick={() => void ask(line)}
                    >
                      {line}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              turns.map((turn, i) => (
                <div
                  key={i}
                  className={turn.role === "user" ? "ask-turn is-mine" : "ask-turn"}
                >
                  {turn.content ? (
                    turn.content.split(/\n{2,}/).map((para, n) => <p key={n}>{para}</p>)
                  ) : (
                    <p className="ask-thinking">
                      <span />
                      <span />
                      <span />
                    </p>
                  )}
                </div>
              ))
            )}
          </div>

          {error ? <p className="notice bad ask-error">{error}</p> : null}

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
              placeholder={about ? "Ask about the platform" : "Ask something"}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                // Enter sends, because this is a chat. A new line is still
                // reachable, which matters for pasting an error in.
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
              >
                Stop
              </button>
            ) : (
              <button
                type="submit"
                className="btn btn-primary btn-sm"
                disabled={!draft.trim()}
              >
                Send
              </button>
            )}
          </form>
        </aside>
      ) : null}
    </>
  );
}
