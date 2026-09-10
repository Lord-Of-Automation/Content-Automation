"use client";

import { useCallback, useEffect, useState } from "react";

import { useAsk } from "@/components/Ask";
import OutreachCampaign from "@/components/OutreachCampaign";
import { useToasts } from "@/components/Toasts";
import type { Contact, MailStatus, Thread } from "@/lib/mail";

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

/** What a first email says, until somebody writes a better one. */
const OPENER = {
  subject: "Quick question about {domain}",
  body: `Hi,

I came across {domain} and had a quick question about it.

Best,
`,
};

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
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  /** Which half of the page. Conversations first: it is what you come back to. */
  const [view, setView] = useState<"conversations" | "campaign">("conversations");
  /** Show only the replies that name a way to be paid, which is the answer. */
  const [paidOnly, setPaidOnly] = useState(false);

  const [sheet, setSheet] = useState("");
  const [tab, setTab] = useState("");
  const [to, setTo] = useState("");
  const [domain, setDomain] = useState("");
  const [subject, setSubject] = useState(OPENER.subject);
  const [body, setBody] = useState(OPENER.body);

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

  const loadContacts = useCallback(async () => {
    const asked = new URLSearchParams();
    if (sheet) asked.set("sheet", sheet);
    if (tab) asked.set("tab", tab);
    const response = await fetch(`/api/mail/contacts?${asked}`, { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? "The prospects could not be read.");
    setContacts(payload.contacts ?? []);
  }, [sheet, tab]);

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
  async function reconnect() {
    setBusy(true);
    try {
      await fetch("/api/mail/connect", { method: "DELETE" });
    } catch {
      // Not worth stopping for. The consent that follows replaces whatever is
      // stored anyway, and this only tidies up first.
    }
    window.location.href = "/api/mail/connect";
  }

  async function disconnect() {
    const sure = await ask.confirm({
      title: "Disconnect this mailbox?",
      body: (
        <>
          Nothing more will be sent and no conversation will be read until an
          account is connected again. The messages already sent stay where they
          are, in the mailbox they were sent from.
        </>
      ),
      confirmLabel: "Disconnect",
      tone: "danger",
    });
    if (!sure) return;

    setBusy(true);
    try {
      const response = await fetch("/api/mail/connect", { method: "DELETE" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "It could not be disconnected.");
      setThreads([]);
      await loadStatus();
      push("ok", "Disconnected.");
    } catch (e) {
      push("bad", e instanceof Error ? e.message : "It could not be disconnected.");
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    const address = to.trim().toLowerCase();
    if (!address) return push("bad", "Nobody to write to.");

    const already = contacts.find((c) => c.email === address && c.sent > 0);
    const sure = await ask.confirm({
      title: already ? `Write to ${address} again?` : `Send to ${address}?`,
      body: (
        <>
          {already ? (
            <>
              This address has already had {already.sent} message
              {already.sent === 1 ? "" : "s"}, the first on {when(already.sentAt)}. A
              second goes into the same conversation.{" "}
            </>
          ) : null}
          It goes from the connected mailbox and cannot be taken back.
        </>
      ),
      confirmLabel: "Send it",
    });
    if (!sure) return;

    setBusy(true);
    try {
      const response = await fetch("/api/mail/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          to: address,
          domain: domain.trim(),
          // Filled in here rather than on the server, so what is sent is
          // exactly what was on screen when the button was pressed.
          subject: subject.replaceAll("{domain}", domain.trim() || address),
          body: body.replaceAll("{domain}", domain.trim() || address),
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "It could not be sent.");

      push("ok", `Sent to ${address}.`);
      await loadThreads();
      if (contacts.length) await loadContacts().catch(() => {});
    } catch (e) {
      push("bad", e instanceof Error ? e.message : "It could not be sent.");
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

  const showing = paidOnly ? threads.filter((one) => one.paypal) : threads;

  if (loading) return <div className="empty">Reading the mailbox…</div>;

  const connected = !!status?.connected;
  const ready = !!status?.configured && !!status?.consoleConfigured;

  return (
    <div className="stack">
      {error ? <div className="notice bad">{error}</div> : null}

      <div className="card">
        <div className="card-head">
          <div>
            <h2>Mailing</h2>
            <p className="quiet">
              {connected
                ? `Sending as ${status?.address}`
                : "No mailbox is connected yet"}
            </p>
          </div>
          <div className="app-head-actions">
            <div className="seg seg-sm">
              <button
                type="button"
                className={view === "conversations" ? "seg-btn is-on" : "seg-btn"}
                onClick={() => setView("conversations")}
              >
                Conversations
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
            </div>
            {connected ? (
              <>
                <button
                  type="button"
                  className="btn btn-ghost bar-btn"
                  disabled={busy}
                  onClick={() => void loadThreads().catch((e) => push("bad", String(e.message)))}
                >
                  Refresh
                </button>
                <button
                  type="button"
                  className="btn btn-danger bar-btn"
                  disabled={busy}
                  onClick={() => void disconnect()}
                >
                  Disconnect
                </button>
              </>
            ) : ready ? (
              <a className="btn btn-primary bar-btn" href="/api/mail/connect">
                Connect Gmail
              </a>
            ) : null}
          </div>
        </div>

        <div className="card-body tight">
          {/* Connected, and not permitted to do the thing a campaign needs.
              Said here rather than discovered at the end of a run, after every
              article has been written and paid for. */}
          {connected && status?.canDraft === false ? (
            <div className="notice warn">
              <strong>This connection cannot create drafts.</strong> It was
              granted before campaigns existed, so it can send and read mail but
              not put an article in a document. Campaigns will write every
              article and then fail at the last step.
              <div className="sa-notice-do">
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={busy}
                  onClick={() => void reconnect()}
                >
                  Reconnect and grant it
                </button>
              </div>
            </div>
          ) : null}

          {!ready ? (
            <div className="notice warn">
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
            <div className="notice">
              <strong>What connecting allows.</strong> Two things, and Google will
              list both: sending mail as you, and reading mail. There is no
              narrower read permission than the whole mailbox, so the narrowing
              is done here instead — the engine writes down the conversation
              every message it sends lands in, and those are the only
              conversations it ever reads. Nothing else is fetched, so nothing
              else can appear below.
            </div>
          ) : null}

          {view === "campaign" ? (
            <OutreachCampaign
              connected={connected}
              onStarted={() => {
                // The first email lands within a minute or two, so the list is
                // worth another look shortly. Switching tabs is the cue.
                setView("conversations");
                void loadThreads().catch(() => {});
              }}
            />
          ) : connected ? (
            <div className="editor-split has-preview">
              {/* ------------------------------------------------ writing */}
              <div className="editor-panel">
                <h3>Write to a prospect</h3>

                <label className="field-label" htmlFor="mail-to">
                  To
                </label>
                <input
                  id="mail-to"
                  type="email"
                  className="mono"
                  value={to}
                  placeholder="someone@example.com"
                  onChange={(e) => setTo(e.target.value)}
                />

                <label className="field-label" htmlFor="mail-domain">
                  Their domain
                </label>
                <input
                  id="mail-domain"
                  type="text"
                  className="mono"
                  value={domain}
                  placeholder="example.com"
                  onChange={(e) => setDomain(e.target.value)}
                />

                <label className="field-label" htmlFor="mail-subject">
                  Subject
                </label>
                <input
                  id="mail-subject"
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                />

                <label className="field-label" htmlFor="mail-body">
                  Message
                </label>
                <textarea
                  id="mail-body"
                  className="editor-body"
                  rows={10}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                />
                <p className="provider-hint">
                  Plain text, deliberately: an outreach email that arrives as
                  styled HTML from an address nobody knows reads as a mailshot.
                  Write {"{domain}"} anywhere and it becomes their domain.
                </p>

                <div className="ve-actions">
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy || !to.trim()}
                    onClick={() => void send()}
                  >
                    {busy ? "Sending…" : "Send"}
                  </button>
                </div>

                <section className="sheet-section">
                  <h3>From the prospects sheet</h3>
                  <div className="site-row">
                    <div>
                      <label className="field-label" htmlFor="mail-sheet">
                        Sheet ID
                      </label>
                      <input
                        id="mail-sheet"
                        type="text"
                        className="mono"
                        value={sheet}
                        placeholder="Blank uses the engine's own"
                        onChange={(e) => setSheet(e.target.value.trim())}
                      />
                    </div>
                    <div>
                      <label className="field-label" htmlFor="mail-tab">
                        Tab
                      </label>
                      <input
                        id="mail-tab"
                        type="text"
                        className="mono"
                        value={tab}
                        placeholder="First tab"
                        onChange={(e) => setTab(e.target.value.trim())}
                      />
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={busy}
                    onClick={() =>
                      void loadContacts().catch((e) => push("bad", String(e.message)))
                    }
                  >
                    Load the addresses
                  </button>

                  {contacts.length ? (
                    <ul className="findings" style={{ marginTop: 12 }}>
                      {contacts.map((one) => (
                        <li className="finding" key={`${one.row}-${one.email}`}>
                          <button
                            type="button"
                            className="finding-where"
                            title="Put this address in the form"
                            onClick={() => {
                              setTo(one.email);
                              setDomain(one.domain);
                            }}
                          >
                            {one.email}
                          </button>
                          <span className="finding-kind">{one.domain || "—"}</span>
                          <span className="finding-what">
                            {one.sent
                              ? `written to ${one.sent} time${one.sent === 1 ? "" : "s"}, first on ${when(one.sentAt)}`
                              : "not written to"}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </section>
              </div>

              {/* ----------------------------------------- conversations */}
              <aside className="editor-preview">
                <div className="editor-body-head">
                  <span className="field-label">
                    Conversations{threads.length ? ` (${showing.length})` : ""}
                  </span>
                  {/* The one filter worth having on an outreach inbox. A
                      publisher quoting a price and saying where to send it has
                      agreed; everything else is still a conversation. */}
                  {threads.some((one) => one.paypal) ? (
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
                      : "Nothing sent yet. Conversations appear here once this platform has written to somebody, and only those."}
                  </p>
                ) : (
                  <ul className="mail-threads">
                    {showing.map((thread) => {
                      const showing = open === thread.email;
                      return (
                        <li
                          key={thread.email}
                          className={thread.replies ? "mail-thread has-reply" : "mail-thread"}
                        >
                          <button
                            type="button"
                            className="mail-thread-head"
                            onClick={() => setOpen(showing ? null : thread.email)}
                          >
                            <span className="mail-who">{thread.email}</span>
                            <span className="mail-subject">{thread.subject}</span>
                            <span className="mail-count">
                              {thread.replies
                                ? `${thread.replies} repl${thread.replies === 1 ? "y" : "ies"}`
                                : "no reply yet"}
                            </span>
                            <span className="mail-at">{when(thread.lastAt ?? thread.sentAt)}</span>
                          </button>

                          {thread.note ? (
                            <p className="notice warn mail-note">{thread.note}</p>
                          ) : null}

                          {showing ? (
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
                                <button
                                  type="button"
                                  className="btn btn-ghost btn-sm"
                                  onClick={() => {
                                    setTo(thread.email);
                                    setDomain(thread.domain);
                                  }}
                                >
                                  Reply to this
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
                )}
              </aside>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
