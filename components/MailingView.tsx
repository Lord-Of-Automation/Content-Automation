"use client";

import { useCallback, useEffect, useState } from "react";

import { useAsk } from "@/components/Ask";
import CampaignHistory from "@/components/CampaignHistory";
import OutreachCampaign from "@/components/OutreachCampaign";
import { useToasts } from "@/components/Toasts";
import type { MailStatus, Thread } from "@/lib/mail";

/**
 * Writing to link prospects, and reading what comes back.
 *
 * Two halves and they are deliberately unequal. Sending is a form you fill in
 * once and press; the conversations are what you come back to.
 *
 * The list on the right is not an inbox and cannot become one. The engine
 * writes down the conversation every message it sends lands in, and that list
 * of conversations is the only thing it will ever read. A message from anybody
 * this platform has not written to is not filtered out of this page — it is
 * never fetched, so it cannot reach the browser at all. Worth saying plainly,
 * because "connect your Gmail" is a big thing to ask and the answer to "what
 * can it see" should not be "trust us".
 */

function when(value: string | null | undefined): string {
  if (!value) return "never";
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return "never";
  return at.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function MailingView() {
  const ask = useAsk();
  const { push } = useToasts();

  const [status, setStatus] = useState<MailStatus | null>(null);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  /** Which half of the page. The inbox first: it is what you come back to. */
  const [view, setView] = useState<"inbox" | "campaign" | "history">("inbox");
  /** Show only the replies that name a way to be paid, which is the answer. */
  const [paidOnly, setPaidOnly] = useState(false);


  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /*
   * A word from the connection flow, which comes back as a query string.
   *
   * Google redirects a browser, so there is nowhere else for the outcome to
   * live. Read once and then taken out of the address, or a refresh an hour
   * later says "Connected as…" again about nothing.
   */
  useEffect(() => {
    const asked = new URLSearchParams(window.location.search);
    const said = asked.get("mail");
    if (!said) return;
    push(asked.get("ok") ? "ok" : "bad", said);
    window.history.replaceState({}, "", window.location.pathname);
  }, [push]);

  const loadStatus = useCallback(async () => {
    const response = await fetch("/api/mail/status", { cache: "no-store" });
    if (response.status === 401) {
      window.location.href = "/login";
      return null;
    }
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? "The mailbox could not be checked.");
    setStatus(payload);
    return payload as MailStatus;
  }, []);

  const loadThreads = useCallback(async () => {
    const response = await fetch("/api/mail/threads", { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? "The conversations could not be read.");
    setThreads(payload.threads ?? []);
  }, []);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        const found = await loadStatus();
        if (found?.connected) await loadThreads();
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "The Mailing page could not load.");
      } finally {
        setLoading(false);
      }
    })();
  }, [loadStatus, loadThreads]);

  /**
   * Disconnect and connect again, in one press.
   *
   * The two-step version is what the error message tells somebody to do, and
   * it is two presses in two places with a Google screen in between. This is
   * the same thing without the first half being somebody's job.
   */
  async function reconnect(address = "") {
    setBusy(true);
    try {
      if (address) {
        await fetch(`/api/mail/connect?address=${encodeURIComponent(address)}`, {
          method: "DELETE",
        });
      }
    } catch {
      // Not worth stopping for. The consent that follows replaces whatever is
      // stored anyway, and this only tidies up first.
    }
    window.location.href = "/api/mail/connect";
  }

  async function disconnect(address: string) {
    const sure = await ask.confirm({
      title: `Disconnect ${address || "this mailbox"}?`,
      body: (
        <>
          Nothing more goes out as that address and its conversations stop
          being read. Anything already sent stays where it is, in the mailbox
          it was sent from, and other connected mailboxes are untouched.
        </>
      ),
      confirmLabel: "Disconnect",
      tone: "danger",
    });
    if (!sure) return;

    setBusy(true);
    try {
      const response = await fetch(
        `/api/mail/connect?address=${encodeURIComponent(address)}`,
        { method: "DELETE" },
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "It could not be disconnected.");
      const left = await loadStatus();
      if (left?.connected) await loadThreads().catch(() => {});
      else setThreads([]);
      push("ok", "Disconnected.");
    } catch (e) {
      push("bad", e instanceof Error ? e.message : "It could not be disconnected.");
    } finally {
      setBusy(false);
    }
  }

  /**
   * Says an invoice has been settled, or takes it back.
   *
   * Nothing here can work this out on its own: the money moves in PayPal and
   * the only person who sees that is the one who moved it. So it is a button,
   * and it is reversible, because it sits beside one that deletes things.
   *
   * Only marking asks first. Unmarking is how a mistake is undone, and putting
   * a question in front of the undo makes the mistake harder to fix than it was
   * to make.
   */
  async function pay(thread: Thread, paid: boolean) {
    if (paid) {
      const sure = await ask.confirm({
        title: `Mark ${thread.email} as paid?`,
        body: (
          <>
            It moves out of the inbox and into Paid, so it stops competing for
            attention with the ones still being chased. Nothing is sent, the
            publisher is told nothing, and the conversation itself is untouched.
            You can put it back.
          </>
        ),
        confirmLabel: "Yes, it is paid",
      });
      if (!sure) return;
    }

    setBusy(true);
    try {
      const response = await fetch("/api/mail/threads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: thread.email, paid }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "That did not work.");

      await loadThreads();
      push("ok", paid ? `${thread.email} marked paid.` : `${thread.email} is owed again.`);
    } catch (e) {
      push("bad", e instanceof Error ? e.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  async function forget(email: string) {
    const sure = await ask.confirm({
      title: `Forget the conversation with ${email}?`,
      body: (
        <>
          It disappears from this page and this platform stops reading it. The
          messages stay in the mailbox. Because this list is the only thing that
          makes a conversation readable at all, forgetting one is also how you
          stop it being looked at.
        </>
      ),
      confirmLabel: "Forget it",
      tone: "danger",
    });
    if (!sure) return;

    setBusy(true);
    try {
      const response = await fetch(`/api/mail/threads?email=${encodeURIComponent(email)}`, {
        method: "DELETE",
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "It could not be forgotten.");
      await loadThreads();
      push("ok", "Forgotten.");
    } catch (e) {
      push("bad", e instanceof Error ? e.message : "It could not be forgotten.");
    } finally {
      setBusy(false);
    }
  }

  /*
   * Paid ones leave the inbox.
   *
   * Which is the point of marking them: a conversation that has ended in money
   * is done, and leaving it among the ones still being chased means reading
   * past it every time. It is not hidden, it is below.
   */
  const owed = threads.filter((one) => !one.paidAt);
  const paid = threads.filter((one) => one.paidAt);

  const showing = paidOnly ? owed.filter((one) => one.paypal) : owed;

  if (loading) return <div className="empty">Reading the mailbox…</div>;

  const boxes = status?.mailboxes ?? [];
  const connected = !!status?.connected;
  const ready = !!status?.configured && !!status?.consoleConfigured;

  /*
   * The conversations, in one section per address they went out as.
   *
   * Which is the whole point of sending as several: a reply says which of your
   * identities a publisher answered before you read a word of it. Ordered by
   * the most recent conversation in each, so whoever has just heard something
   * is at the top.
   */
  const grouped = (() => {
    const by = new Map<string, Thread[]>();
    for (const one of showing) {
      const key = one.from || one.mailbox || "";
      by.set(key, [...(by.get(key) ?? []), one]);
    }
    return [...by.entries()].sort((a, b) => {
      const newest = (rows: Thread[]) =>
        rows.reduce((at, one) => (one.lastAt ?? one.sentAt) > at ? (one.lastAt ?? one.sentAt) : at, "");
      return newest(b[1]).localeCompare(newest(a[1]));
    });
  })();

  return (
    <div className="stack">
      {error ? <div className="notice bad">{error}</div> : null}

      <div className="card">
        <div className="card-head has-mid">
          <div>
            <h2>Mailing</h2>
            <p className="quiet">
              {!connected
                ? "No mailbox is connected yet"
                : boxes.length === 1
                  ? `Sending as ${boxes[0]!.address}`
                  : `${boxes.length} mailboxes connected`}
            </p>
          </div>
          {/* Its own part of the head, between the title and the buttons,
              so it sits in the middle of the card rather than wherever the
              two of them happen to leave room. */}
          <div className="card-head-mid">
            <div className="seg seg-sm">
              <button
                type="button"
                className={view === "inbox" ? "seg-btn is-on" : "seg-btn"}
                onClick={() => setView("inbox")}
              >
                Inbox
                {threads.filter((one) => one.paypal).length ? (
                  <span className="seg-count is-paid">
                    {threads.filter((one) => one.paypal).length}
                  </span>
                ) : null}
              </button>
              <button
                type="button"
                className={view === "campaign" ? "seg-btn is-on" : "seg-btn"}
                onClick={() => setView("campaign")}
              >
                Campaign
              </button>
              <button
                type="button"
                className={view === "history" ? "seg-btn is-on" : "seg-btn"}
                onClick={() => setView("history")}
              >
                History
              </button>
            </div>
          </div>

          <div className="app-head-actions">
            {connected ? (
              <button
                type="button"
                className="btn btn-ghost bar-btn"
                disabled={busy}
                onClick={() => void loadThreads().catch((e) => push("bad", String(e.message)))}
              >
                Refresh
              </button>
            ) : null}
            {ready ? (
              <a className="btn btn-primary bar-btn" href="/api/mail/connect">
                {boxes.length ? "Connect another" : "Connect Gmail"}
              </a>
            ) : null}
          </div>
        </div>

        <div className="card-body tight">
          {!ready ? (
            <div className="notice warn mail-notice">
              <strong>There is no Google OAuth client to connect through.</strong>{" "}
              This page uses the same one Search Console does, so the quickest
              fix is to add it under Accounts, Search Console — an OAuth client
              ID and secret from Google Cloud, type Web application.
              {status?.redirectUri ? (
                <>
                  {" "}
                  Whichever client it is, it needs the <strong>Gmail API</strong>{" "}
                  enabled on its project and this exact address among its
                  authorised redirect addresses, alongside whatever is already
                  there:
                  {/* Shown rather than described. It must match character for
                      character, and Google's mismatch error names neither the
                      address it got nor the one it wanted. */}
                  <code className="mail-redirect">{status.redirectUri}</code>
                </>
              ) : null}
            </div>
          ) : !connected ? (
            <div className="notice mail-notice">
              <strong>What connecting allows.</strong> Two things, and Google will
              list both: sending mail as you, and reading mail. There is no
              narrower read permission than the whole mailbox, so the narrowing
              is done here instead — the engine writes down the conversation
              every message it sends lands in, and those are the only
              conversations it ever reads. Nothing else is fetched, so nothing
              else can appear below.
            </div>
          ) : null}

          {view === "history" ? (
            <div className="mail-only">
              <CampaignHistory />
            </div>
          ) : view === "campaign" ? (
            <OutreachCampaign
              connected={connected}
              senders={status?.senders ?? []}
              onStarted={() => {
                // Straight to the history, which is where the campaign just
                // started can be watched. The replies take longer than the
                // sending does, so the inbox is the wrong place to be told to
                // look first.
                setView("history");
              }}
            />
          ) : connected ? (
            <div className="mail-only">
                <div className="editor-body-head">
                <span className="field-label">
                  Inbox{owed.length ? ` (${showing.length})` : ""}
                </span>
                {/* The one filter worth having on an outreach inbox. A
                    publisher quoting a price and saying where to send it has
                    agreed; everything else is still a conversation. */}
                {owed.some((one) => one.paypal) ? (
                  <label className="check" htmlFor="mail-paid">
                    <input
                      id="mail-paid"
                      type="checkbox"
                      checked={paidOnly}
                      onChange={(e) => setPaidOnly(e.target.checked)}
                    />
                    With a PayPal link
                  </label>
                ) : null}
                </div>

                {!showing.length ? (
                <p className="provider-hint">
                  {paidOnly
                    ? "No reply has named a way to be paid yet."
                    : "Nothing sent yet. A conversation appears here once this platform has written to somebody, and only then."}
                </p>
                ) : (
                grouped.map(([sender, rows]) => (
                  <section className="mail-group" key={sender || "unknown"}>
                    {/* The address the publisher knows you by. Named even when
                        there is only one, because a page that starts labelling
                        things once there are two reads differently on the day
                        you add one. */}
                    <h3 className="mail-group-head">
                      <span>{sender || "an address no longer connected"}</span>
                      <span className="mail-group-count">
                        {rows.length} conversation{rows.length === 1 ? "" : "s"}
                        {rows.filter((one) => one.replies).length
                          ? `, ${rows.filter((one) => one.replies).length} replied`
                          : ""}
                      </span>
                    </h3>
                    <ul className="mail-threads">
                      {rows.map((thread) => {
                        const isOpen = open === thread.email;
                        return (
                          <li
                            key={thread.email}
                            className={thread.replies ? "mail-thread has-reply" : "mail-thread"}
                          >
                            {/* The row and the one action on it, side by side.
                                Marking an invoice paid is the commonest thing
                                to do to a conversation and it should not need
                                the conversation opened first — and a button
                                inside a button is not a thing, so the row is a
                                row with a button in it rather than one itself. */}
                            <div className="mail-thread-row">
                              <button
                                type="button"
                                className="mail-thread-head"
                                onClick={() => setOpen(isOpen ? null : thread.email)}
                              >
                                <span className="mail-who">{thread.email}</span>
                                <span className="mail-subject">{thread.subject}</span>
                                <span className="mail-count">
                                  {thread.replies
                                    ? `${thread.replies} repl${thread.replies === 1 ? "y" : "ies"}`
                                    : "no reply yet"}
                                </span>
                                <span className="mail-at">
                                  {when(thread.lastAt ?? thread.sentAt)}
                                </span>
                              </button>
                              <button
                                type="button"
                                className="btn btn-paid btn-sm mail-thread-paid"
                                disabled={busy}
                                title={`Mark ${thread.email} as paid`}
                                onClick={() => void pay(thread, true)}
                              >
                                Paid
                              </button>
                            </div>

                            {thread.note ? (
                              <p className="notice warn mail-note">{thread.note}</p>
                            ) : null}

                            {isOpen ? (
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
                                    {/* As text, never as markup. What is in here
                                        was written by somebody outside this
                                        platform, and a page that renders their
                                        HTML renders whatever they felt like
                                        sending. */}
                                    <pre>{message.text.trim() || "(no words in it)"}</pre>
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
                                    className={
                                      thread.paidAt ? "btn btn-ghost btn-sm" : "btn btn-paid btn-sm"
                                    }
                                    disabled={busy}
                                    onClick={() => void pay(thread, !thread.paidAt)}
                                  >
                                    {thread.paidAt ? "Not paid after all" : "Paid"}
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-danger btn-sm"
                                    disabled={busy}
                                    onClick={() => void forget(thread.email)}
                                  >
                                    Forget
                                  </button>
                                </div>
                              </div>
                            ) : null}
                          </li>
                        );
                      })}
                      </ul>
                    </section>
                  ))
                )}

                {/* Below the inbox, not hidden from it.

                    A conversation that ended in money is finished as far as
                    the work goes, so it stops competing for attention with the
                    ones still being chased. It is still the record of a link
                    that was bought, and that is worth being able to find. */}
                {paid.length ? (
                  <section className="mail-group mail-paid">
                    <h3 className="mail-group-head">
                      <span>Paid</span>
                      <span className="mail-group-count">
                        {paid.length} conversation{paid.length === 1 ? "" : "s"}
                      </span>
                    </h3>
                    <ul className="mail-threads">
                      {paid.map((thread) => (
                        <li className="mail-thread is-paid" key={thread.email}>
                          <div className="mail-thread-row">
                            <button
                              type="button"
                              className="mail-thread-head"
                              onClick={() => setOpen(open === thread.email ? null : thread.email)}
                            >
                              <span className="mail-who">{thread.email}</span>
                              <span className="mail-subject">{thread.subject}</span>
                              <span className="mail-count">paid {when(thread.paidAt)}</span>
                              <span className="mail-at">{thread.from || ""}</span>
                            </button>
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm mail-thread-paid"
                              disabled={busy}
                              title="Put it back among the ones still owed"
                              onClick={() => void pay(thread, false)}
                            >
                              Not paid
                            </button>
                          </div>

                          {open === thread.email ? (
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
                                  <pre>{message.text.trim() || "(no words in it)"}</pre>
                                </article>
                              ))}
                              <div className="ve-actions">
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
                                  onClick={() => void forget(thread.email)}
                                >
                                  Forget
                                </button>
                              </div>
                            </div>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
