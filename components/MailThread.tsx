"use client";

import type { Thread } from "@/lib/mail";

/**
 * One conversation, open or closed.
 *
 * Written once and used by both halves of the inbox. It was two near-identical
 * blocks of markup, one for the conversations still owed and one for the ones
 * already paid, which differed in two strings and a button — and the second
 * copy had already fallen a change behind the first.
 *
 * What it shows either way: who the publisher is, what was written to them,
 * whether they have replied, and when. Opened, the messages themselves, as
 * text and never as markup, because they were written by somebody outside this
 * platform and a page that renders their HTML renders whatever they felt like
 * sending.
 */

function when(value: string | null | undefined): string {
  if (!value) return "";
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return "";
  return at.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * The angle brackets a mail client puts down the side of a quoted reply.
 *
 * They are a convention from terminal mail readers, where a message was
 * unstyled text and the only way to show which half of it somebody else had
 * written was to mark every line of it. Every graphical client since has drawn
 * a bar or a fold instead, and only keeps the brackets in the plain-text copy
 * of the message — which is the copy this reads, so they arrive here as
 * literal characters in the middle of the words.
 *
 * Stripped rather than styled, because what is under them is usually the
 * message directly above it in this same thread. A reply two people have gone
 * back and forth on carries every previous round, nested a bracket deeper each
 * time, and the newest sentence ends up at the top of a wall of things you
 * have already read.
 *
 * Only the markers go. The lines they were marking stay, because a quote is
 * sometimes trimmed to the one paragraph being answered, and that paragraph is
 * the reply.
 */
const QUOTE = /^[ \t]*(?:>[ \t]?)+/;

function unquote(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(QUOTE, ""))
    .join("\n")
    // Removing the markers can leave a run of blank lines where the quoted
    // paragraphs were spaced apart. Three or more become one gap.
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export default function MailThread({
  thread,
  open,
  busy,
  onToggle,
  onPay,
  onForget,
}: {
  thread: Thread;
  open: boolean;
  busy: boolean;
  onToggle: () => void;
  /** Marking it settled, or putting it back among the ones still owed. */
  onPay: (paid: boolean) => void;
  onForget: () => void;
}) {
  const paid = !!thread.paidAt;

  return (
    <li
      className={
        paid
          ? "mail-thread is-paid"
          : thread.replies
            ? "mail-thread has-reply"
            : "mail-thread"
      }
    >
      {/* The row and the one action on it, side by side. Marking an invoice
          paid is the commonest thing to do to a conversation and it should not
          need the conversation opened first — and a button inside a button is
          not a thing, so the row is a row with a button in it rather than one
          itself. */}
      <div className="mail-thread-row">
        <button type="button" className="mail-thread-head" onClick={onToggle}>
          <span className="mail-who">{thread.email}</span>
          <span className="mail-subject">{thread.subject}</span>
          <span className="mail-count">
            {paid
              ? `paid ${when(thread.paidAt)}`
              : thread.replies
                ? `${thread.replies} repl${thread.replies === 1 ? "y" : "ies"}`
                : "no reply yet"}
          </span>
          <span className="mail-at">{when(thread.lastAt ?? thread.sentAt)}</span>
        </button>
        <button
          type="button"
          className={
            paid ? "btn btn-ghost btn-sm mail-thread-paid" : "btn btn-paid btn-sm mail-thread-paid"
          }
          disabled={busy}
          title={
            paid
              ? "Put it back among the ones still owed"
              : `Mark ${thread.email} as paid`
          }
          onClick={() => onPay(!paid)}
        >
          {paid ? "Not paid" : "Paid"}
        </button>
      </div>

      {thread.note ? <p className="notice warn mail-note">{thread.note}</p> : null}

      {open ? (
        <div className="mail-messages">
          {thread.messages.map((message) => (
            <article
              key={message.id}
              className={message.mine ? "mail-message is-mine" : "mail-message"}
            >
              <header>
                <strong>{message.mine ? "You" : message.from}</strong>
                <span>{when(message.at)}</span>
              </header>
              <pre>{unquote(message.text) || "(no words in it)"}</pre>
            </article>
          ))}
          <div className="ve-actions">
            {/* Answering happens in the mailbox. A reply to a publisher is a
                conversation, and a one-line box on a dashboard is the wrong
                place to hold one. */}
            <a
              className="btn btn-ghost btn-sm"
              href={`https://mail.google.com/mail/u/0/#all/${thread.threadId}`}
              target="_blank"
              rel="noreferrer"
            >
              Open in Gmail
            </a>
            <button
              type="button"
              className="btn btn-danger btn-sm"
              disabled={busy}
              onClick={onForget}
            >
              Forget
            </button>
          </div>
        </div>
      ) : null}
    </li>
  );
}
