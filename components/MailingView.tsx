"use client";

import { useCallback, useEffect, useState } from "react";

import { useAsk } from "@/components/Ask";
import CampaignHistory from "@/components/CampaignHistory";
import MailingRuns from "@/components/MailingRuns";
import MailThread from "@/components/MailThread";
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

/**
 * The conversations, in one section per address they went out as.
 *
 * Which is the whole point of sending as several: a reply says which of your
 * identities a publisher answered before you read a word of it. Ordered by the
 * most recent conversation in each, so whoever has just heard something is at
 * the top.
 *
 * Shared by the inbox and by the paid list below it. Which of your identities
 * was paid is as much a fact about a conversation as that it was.
 */
function groupBySender(rows: Thread[]): Array<[string, Thread[]]> {
  const by = new Map<string, Thread[]>();
  for (const one of rows) {
    const key = one.from || one.mailbox || "";
    by.set(key, [...(by.get(key) ?? []), one]);
  }

  const newest = (group: Thread[]) =>
    group.reduce((at, one) => ((one.lastAt ?? one.sentAt) > at ? one.lastAt ?? one.sentAt : at), "");

  return [...by.entries()].sort((a, b) => newest(b[1]).localeCompare(newest(a[1])));
}

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
  const [view, setView] = useState<"inbox" | "campaign" | "runs" | "history">("inbox");
  /** Show only the replies that name a way to be paid, which is the answer. */
  const [paidOnly, setPaidOnly] = useState(false);
  /** Words to look for. Searched over the messages too, not only the headings. */
  const [find, setFind] = useState("");


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
    /*
     * Both directions ask first.
     *
     * Marking one paid is the careful one and was the only one that asked, on
     * the reasoning that putting it back is easy. But the two buttons sit in
     * the same place on the row and read almost the same at a glance, and what
     * the second one actually does is throw away the date an invoice was
     * settled on — which is not somewhere the record can be put back from.
     */
    const sure = paid
      ? await ask.confirm({
          title: `Mark ${thread.email} as paid?`,
          body: (
            <>
              It moves out of the inbox and into Paid, so it stops competing for
              attention with the ones still being chased. Nothing is sent, the
              publisher is told nothing, and the conversation itself is
              untouched. You can put it back.
            </>
          ),
          confirmLabel: "Yes, it is paid",
        })
      : await ask.confirm({
          title: `Put ${thread.email} back among the unpaid?`,
          body: (
            <>
              It returns to the inbox and starts being chased again, and the
              date it was marked paid on is forgotten rather than kept. Nothing
              is sent and the publisher is told nothing.
            </>
          ),
          confirmLabel: "Yes, it is not paid",
        });
    if (!sure) return;

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
  /*
   * What a search looks at.
   *
   * The words of the messages as well as the addresses and subjects, because
   * the thing somebody is usually hunting for is something a publisher said —
   * a price, a name, a condition — and searching only the headings would find
   * none of it. Every conversation on this page is already loaded with its
   * messages, so this costs nothing and needs no round trip.
   *
   * Every word has to appear somewhere, in any order and any field. Two words
   * typed together nearly always means "the one that is both", and requiring
   * them adjacent would make a search for "turbogeek paypal" find nothing.
   */
  const found = (one: Thread): boolean => {
    const wanted = find.trim().toLowerCase();
    if (!wanted) return true;

    const haystack = [
      one.email,
      one.domain,
      one.subject,
      one.from ?? "",
      ...one.messages.map((message) => `${message.from} ${message.text}`),
    ]
      .join(" ")
      .toLowerCase();

    return wanted.split(/\s+/).every((word) => haystack.includes(word));
  };

  const owed = threads.filter((one) => !one.paidAt && found(one));
  const paid = threads.filter((one) => one.paidAt && found(one));

  const showing = paidOnly ? owed.filter((one) => one.paypal) : owed;

  if (loading) return <div className="empty">Reading the mailbox…</div>;

  const boxes = status?.mailboxes ?? [];
  const connected = !!status?.connected;
  const ready = !!status?.configured && !!status?.consoleConfigured;

  const grouped = groupBySender(showing);

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
                className={view === "runs" ? "seg-btn is-on" : "seg-btn"}
                onClick={() => setView("runs")}
              >
                Runs
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

          {view === "runs" ? (
            <div className="mail-only mail-panel" key="runs">
              <MailingRuns />
            </div>
          ) : view === "history" ? (
            <div className="mail-only mail-panel" key="history">
              <CampaignHistory />
            </div>
          ) : view === "campaign" ? (
            <OutreachCampaign
              key="campaign"
              connected={connected}
              senders={status?.senders ?? []}
              onStarted={() => {
                // Straight to the run, which is the thing that has just begun.
                // The sending takes minutes and the replies take days, so
                // neither the inbox nor the history is where to look first.
                setView("runs");
              }}
            />
          ) : connected ? (
            <div className="mail-only mail-panel" key="inbox">
                <div className="editor-body-head">
                  <span className="field-label">
                    Inbox{owed.length ? ` (${showing.length})` : ""}
                  </span>

                  <div className="mail-find">
                    <input
                      type="search"
                      value={find}
                      placeholder="Search these conversations"
                      aria-label="Search the conversations"
                      onChange={(e) => setFind(e.target.value)}
                    />
                    {/* The one filter worth having on an outreach inbox. A
                        publisher quoting a price and saying where to send it
                        has agreed; everything else is still a conversation. */}
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
                </div>

                {!showing.length ? (
                  <p className="provider-hint">
                    {find.trim()
                      ? `Nothing here matches "${find.trim()}". It searches the messages as well as the addresses and subjects.`
                      : paidOnly
                        ? "No reply has named a way to be paid yet."
                        : "Nothing sent yet. A conversation appears here once this platform has written to somebody, and only then."}
                  </p>
                ) : (
                  grouped.map(([sender, rows]) => (
                    <section className="mail-group" key={sender || "unknown"}>
                      {/* The address the publisher knows you by. Named even
                          when there is only one, because a page that starts
                          labelling things once there are two reads differently
                          on the day you add one. */}
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
                        {rows.map((thread) => (
                          <MailThread
                            key={thread.email}
                            thread={thread}
                            open={open === thread.email}
                            busy={busy}
                            onToggle={() => setOpen(open === thread.email ? null : thread.email)}
                            onPay={(paidNow) => void pay(thread, paidNow)}
                            onForget={() => void forget(thread.email)}
                          />
                        ))}
                      </ul>
                    </section>
                  ))
                )}

                {/* Below the inbox, and shown whether or not anything is left
                    in it: a search that matches only settled conversations
                    should find them rather than answer with nothing.

                    A conversation that ended in money is finished as far as the
                    work goes, so it stops competing for attention with the ones
                    still being chased. It is still the record of a link that was
                    bought, and that is worth finding.

                    Grouped by sender like the inbox, for the same reason: which
                    of your identities was paid is as much a fact about it as
                    that it was. */}
                {paid.length ? (
                  <div className="mail-paid">
                    <h3 className="mail-group-head mail-paid-head">
                      <span>Paid</span>
                      <span className="mail-group-count">
                        {paid.length} conversation{paid.length === 1 ? "" : "s"}
                      </span>
                    </h3>

                    {groupBySender(paid).map(([sender, rows]) => (
                      <section className="mail-group" key={sender || "unknown"}>
                        <h3 className="mail-group-head">
                          <span>{sender || "an address no longer connected"}</span>
                          <span className="mail-group-count">
                            {rows.length} conversation{rows.length === 1 ? "" : "s"}
                          </span>
                        </h3>
                        <ul className="mail-threads">
                          {rows.map((thread) => (
                            <MailThread
                              key={thread.email}
                              thread={thread}
                              open={open === thread.email}
                              busy={busy}
                              onToggle={() => setOpen(open === thread.email ? null : thread.email)}
                              onPay={(paidNow) => void pay(thread, paidNow)}
                              onForget={() => void forget(thread.email)}
                            />
                          ))}
                        </ul>
                      </section>
                    ))}
                  </div>
                ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
