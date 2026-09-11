"use client";

import { useRef, useState, type ReactNode } from "react";

import { readPicture, weight, PICTURE_TYPES, type Picture } from "@/lib/picture";

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

/**
 * A web address, an address missing its scheme, or an email address.
 *
 * Deliberately greedy about what belongs to a URL. A PayPal invoice link is
 *
 *   https://www.paypal.com/invoice/p/#49BMMNCTTYTC35AF
 *
 * and a pattern that stops at punctuation, or at the fragment, hands back half
 * of it — which is worse than not linking it at all, because a half link looks
 * like a whole one. So it runs to whitespace and the trailing punctuation is
 * taken off afterwards, where the question can actually be answered.
 */
const LINKS = /(https?:\/\/[^\s<>]+|www\.[^\s<>]+|[^\s<>@]+@[^\s<>@]+\.[a-z]{2,})/gi;

/**
 * The punctuation at the end of a link that belongs to the sentence instead.
 *
 * "Pay at https://x.com/pay." ends in a full stop that is not part of the
 * address, and "(see https://x.com/pay)" ends in a bracket that is not either
 * — but "https://en.wikipedia.org/wiki/Dune_(novel)" ends in one that is. So a
 * closing bracket is only given back to the sentence when nothing in the link
 * opened it.
 */
function trimTail(url: string): string {
  let out = url;
  for (;;) {
    const last = out.slice(-1);
    if (".,;:!?'\"".includes(last)) {
      out = out.slice(0, -1);
      continue;
    }
    const opener = { ")": "(", "]": "[", "}": "{" }[last];
    if (opener) {
      const opens = out.split(opener).length - 1;
      const closes = out.split(last).length - 1;
      if (closes > opens) {
        out = out.slice(0, -1);
        continue;
      }
    }
    return out;
  }
}

/**
 * Where a link found in a message actually goes.
 *
 * Only three schemes are ever produced, and the scheme is written here rather
 * than taken from the text. The message was typed by somebody outside this
 * platform, and "javascript:" is a URL as far as a pattern is concerned.
 */
function hrefFor(found: string): string | null {
  if (/^https?:\/\//i.test(found)) return found;
  if (/^www\./i.test(found)) return `https://${found}`;
  if (found.includes("@") && !found.includes("/")) return `mailto:${found}`;
  return null;
}

/** A run of plain words, or one address and where it goes. */
export type Piece = string | { text: string; href: string };

/**
 * A message broken into the words and the addresses in them.
 *
 * Separate from the rendering, and exported, so what counts as a link can be
 * tested against the shapes that actually turn up in a publisher's reply
 * without standing a React tree up to ask.
 */
export function splitLinks(text: string): Piece[] {
  const out: Piece[] = [];
  let cursor = 0;

  for (const match of text.matchAll(LINKS)) {
    const at = match.index ?? 0;
    const url = trimTail(match[0]);
    const href = hrefFor(url);
    if (!href) continue;

    if (at > cursor) out.push(text.slice(cursor, at));
    out.push({ text: url, href });
    // Whatever trimTail gave back to the sentence is still the sentence's.
    cursor = at + url.length;
  }

  if (cursor < text.length) out.push(text.slice(cursor));
  return out;
}

/**
 * A message's words, with the addresses in them made clickable.
 *
 * Built as React elements rather than as a string of HTML. The text came from
 * a publisher's mail client, and putting it through dangerouslySetInnerHTML
 * would render whatever they felt like sending; this way every character they
 * wrote is escaped, and the only markup on the page is the anchor tags this
 * function puts there itself.
 */
function linkify(text: string): ReactNode[] {
  return splitLinks(text).map((piece, at) =>
    typeof piece === "string" ? (
      piece
    ) : (
      <a key={at} href={piece.href} target="_blank" rel="noreferrer noopener">
        {piece.text}
      </a>
    ),
  );
}

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

/** Where this console serves one picture out of one conversation. */
function pictureAt(thread: string, message: string, id: string): string {
  return (
    "/api/mail/image" +
    `?thread=${encodeURIComponent(thread)}` +
    `&message=${encodeURIComponent(message)}` +
    `&id=${encodeURIComponent(id)}`
  );
}

export default function MailThread({
  thread,
  open,
  busy,
  onToggle,
  onPay,
  onForget,
  onReply,
  onTrouble,
}: {
  thread: Thread;
  open: boolean;
  busy: boolean;
  onToggle: () => void;
  /** Marking it settled, or putting it back among the ones still owed. */
  onPay: (paid: boolean) => void;
  onForget: () => void;
  /** Answers the publisher in this conversation. Resolves false if it failed. */
  onReply: (body: string, images: Picture[]) => Promise<boolean>;
  /** Says why a picture was refused, in the page's own voice. */
  onTrouble: (why: string) => void;
}) {
  const paid = !!thread.paidAt;

  /*
   * What is being written back, kept per conversation.
   *
   * Here rather than on the page above, because a half-written reply belongs
   * to the conversation it answers: opening a second one and coming back
   * should find the draft where it was left, and closing this one should not
   * put your words in somebody else's box.
   */
  const [reply, setReply] = useState("");
  const [pictures, setPictures] = useState<Picture[]>([]);
  const [sending, setSending] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  async function send() {
    const words = reply.trim();
    // A picture on its own is a reply. Somebody sending a screenshot of a paid
    // invoice has said what they meant to.
    if ((!words && !pictures.length) || sending) return;
    setSending(true);
    // Cleared only when it actually went. A refused send that emptied the box
    // would lose what somebody had just written, and the pictures with it.
    if (await onReply(words, pictures)) {
      setReply("");
      setPictures([]);
    }
    setSending(false);
  }

  /**
   * Files, from wherever they came.
   *
   * The same path for the picker, a paste and a drop, because they are the
   * same act. Paste is the one that matters: a screenshot goes to the
   * clipboard and nowhere else, and saving it to a folder first so it can be
   * picked from that folder is the step worth removing.
   */
  async function take(files: FileList | File[] | null) {
    const chosen = [...(files ?? [])];
    if (!chosen.length) return;

    if (pictures.length + chosen.length > 6) {
      onTrouble("A reply carries at most six pictures.");
      return;
    }

    for (const file of chosen) {
      try {
        const picture = await readPicture(file);
        setPictures((was) => [...was, picture]);
      } catch (e) {
        onTrouble(e instanceof Error ? e.message : "That picture could not be read.");
      }
    }
  }

  function drop(id: string) {
    setPictures((was) => was.filter((one) => one.id !== id));
  }

  return (
    <li
      /* Named so it can be followed when it changes sides. The thread,
         because one publisher can have several and the address would name all
         of them at once. */
      data-glide={thread.threadId}
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
              <pre>
                {/* An invoice arrives as a link and is the reason anybody
                    opens one of these, so it is a link here too. */}
                {unquote(message.text)
                  ? linkify(unquote(message.text))
                  : message.images?.length
                    ? "(a picture, and no words)"
                    : "(no words in it)"}
              </pre>

              {/*
                The pictures in it, under the words, where they were written.

                Fetched one at a time through this console rather than carried
                with the conversation: a dozen threads are read to build the
                list and most are never opened, so the bytes wait until
                somebody looks. Left to the browser to load lazily, decode off
                the main thread and keep, which is the whole reason this is an
                img rather than a string of base64.
              */}
              {message.images?.length ? (
                <div className="mail-seen">
                  {message.images.map((picture) => (
                    <a
                      key={picture.id}
                      className="mail-seen-one"
                      href={pictureAt(thread.threadId, message.id, picture.id)}
                      target="_blank"
                      rel="noreferrer noopener"
                      title={`${picture.name} — open it full size`}
                    >
                      <img
                        src={pictureAt(thread.threadId, message.id, picture.id)}
                        alt={picture.name}
                        loading="lazy"
                      />
                    </a>
                  ))}
                </div>
              ) : null}
            </article>
          ))}
          {/*
            Answering here rather than in Gmail.
            
            These go out from several addresses, so answering in the mailbox
            means being signed into the right one of them and then finding the
            thread. This page already knows both, and the engine sends it as
            whoever the publisher knows — the box below cannot choose.
          */}
          <form
            className="mail-reply"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
            onPaste={(e) => {
              // Only when there is actually a file on the clipboard. Pasting
              // words must go on pasting words.
              const files = [...e.clipboardData.files];
              if (!files.length) return;
              e.preventDefault();
              void take(files);
            }}
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes("Files")) e.preventDefault();
            }}
            onDrop={(e) => {
              if (!e.dataTransfer.files.length) return;
              e.preventDefault();
              void take(e.dataTransfer.files);
            }}
          >
            {/* Addressed to the publisher, not to us. A conversation's "from"
                is the identity it went out as — the address this box sends
                from, not the one it reaches — and naming that here read as
                writing to yourself. */}
            <textarea
              className="mail-reply-box"
              value={reply}
              rows={3}
              disabled={busy || sending}
              placeholder={`Reply to ${thread.email}…`}
              aria-label={`Reply to ${thread.email}`}
              onChange={(e) => setReply(e.target.value)}
              onKeyDown={(e) => {
                // The shortcut every mail client has. Enter alone stays a
                // newline, because this is a message and not a search box.
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            {pictures.length ? (
              <ul className="mail-shots">
                {pictures.map((one) => (
                  <li className="mail-shot" key={one.id}>
                    {/* The picture itself, because a filename is not a way to
                        tell one screenshot from another. */}
                    <img src={one.preview} alt={one.name} />
                    <span className="mail-shot-size">{weight(one.bytes)}</span>
                    <button
                      type="button"
                      className="mail-shot-drop"
                      aria-label={`Take ${one.name} off this reply`}
                      title={`Take ${one.name} off this reply`}
                      disabled={sending}
                      onClick={() => drop(one.id)}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}

            <div className="mail-reply-foot">
              {/* Hidden, because a file input is drawn differently by every
                  browser and none of them match anything else on this page. */}
              <input
                ref={picker}
                type="file"
                accept={PICTURE_TYPES.join(",")}
                multiple
                hidden
                onChange={(e) => {
                  void take(e.target.files);
                  // Cleared, or picking the same file twice in a row does
                  // nothing the second time.
                  e.target.value = "";
                }}
              />
              <button
                type="button"
                className="btn btn-ghost btn-sm mail-shot-add"
                disabled={busy || sending || pictures.length >= 6}
                title="Put a picture in this reply. You can also paste or drop one."
                onClick={() => picker.current?.click()}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                  <rect x="3" y="4" width="18" height="16" rx="2" />
                  <circle cx="8.5" cy="9.5" r="1.5" />
                  <path d="m4 17 4.5-4.5 3 3L15 12l5 5" />
                </svg>
                Picture
              </button>
              <span className="mail-reply-hint">
                {thread.from ? `Goes out as ${thread.from}.` : ""} Ctrl+Enter sends.
              </span>
              <button
                type="submit"
                className="btn btn-sm"
                disabled={busy || sending || (!reply.trim() && !pictures.length)}
              >
                {sending ? "Sending…" : "Send reply"}
              </button>
            </div>
          </form>

          <div className="ve-actions">
            {/* Still offered, for the things a box on a dashboard is the wrong
                place for: an attachment, or a message worth composing slowly. */}
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
