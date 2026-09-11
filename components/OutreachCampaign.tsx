"use client";

import { useMemo, useState } from "react";

import { useAsk } from "@/components/Ask";
import { Select } from "@/components/Select";
import { useToasts } from "@/components/Toasts";
import { MARKETS } from "@/lib/markets";
import type { Opportunity, SheetHas } from "@/lib/mail";

/**
 * Choosing publishers and setting a campaign going.
 *
 * The order down the page is the order the decisions happen in: which sheet,
 * narrow it down, pick the ones worth paying for, say what the link is, say
 * what the article is about, say what the email says, send.
 *
 * The filtering happens here rather than on the engine. The rows arrive once
 * and then somebody moves the numbers twenty times, and a round trip for each
 * adjustment would make a filter over a spreadsheet feel like one.
 *
 * Every publisher chosen gets its own article, written for its own site. That
 * is the expensive part and the whole point: one article sent to five
 * publishers is the thing that gets outreach deleted.
 */

const BLANK_SUBJECT = "Guest article for {domain}";

const BLANK_BODY = `Hi,

I write about this area and put together a piece I think would suit {domain}.
It is finished and ready to publish, and you are welcome to edit it:

{draft}

If it is not right for you, no problem at all. And if you take guest posts on
different terms, tell me what they are.

Best,
`;

function number(value: string): number | null {
  const at = value.trim();
  if (!at) return null;
  const n = Number(at.replace(/[, ]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function short(value: number | null): string {
  if (value === null) return "—";
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(Math.round(value));
}

export default function OutreachCampaign({
  connected,
  senders,
  onStarted,
}: {
  connected: boolean;
  /** Every address anything connected can send as, to check the sheet against. */
  senders: string[];
  onStarted: () => void;
}) {
  const ask = useAsk();
  const { push } = useToasts();

  const [sheet, setSheet] = useState("");
  const [tab, setTab] = useState("");
  const [rows, setRows] = useState<Opportunity[]>([]);
  const [has, setHas] = useState<SheetHas | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  // The filter. Blank means "do not filter on this", which is why every one of
  // these is a string rather than a number with a default.
  const [drMin, setDrMin] = useState("");
  const [drMax, setDrMax] = useState("");
  const [trafficMin, setTrafficMin] = useState("");
  const [trafficMax, setTrafficMax] = useState("");
  const [priceMin, setPriceMin] = useState("");
  const [priceMax, setPriceMax] = useState("");
  const [geo, setGeo] = useState("");
  const [language, setLanguage] = useState("");
  const [unwritten, setUnwritten] = useState(true);

  const [chosen, setChosen] = useState<Set<string>>(new Set());

  const [anchor, setAnchor] = useState("");
  const [anchorUrl, setAnchorUrl] = useState("");
  const [brief, setBrief] = useState("");
  const [subject, setSubject] = useState(BLANK_SUBJECT);
  const [body, setBody] = useState(BLANK_BODY);

  async function load() {
    setLoading(true);
    try {
      const asked = new URLSearchParams();
      if (sheet) asked.set("sheet", sheet);
      if (tab) asked.set("tab", tab);
      const response = await fetch(`/api/mail/opportunities?${asked}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "The sheet could not be read.");

      setRows(payload.opportunities ?? []);
      setHas(payload.has ?? null);
      setChosen(new Set());
      push("ok", `${payload.opportunities?.length ?? 0} row(s) read.`);
    } catch (e) {
      push("bad", e instanceof Error ? e.message : "The sheet could not be read.");
    } finally {
      setLoading(false);
    }
  }

  /*
   * What survives the filter.
   *
   * A row missing the value a filter asks about drops out rather than passing.
   * A publisher with no price recorded is not a publisher within budget, it is
   * one nobody has priced, and letting it through would put it in a campaign on
   * the strength of a blank cell.
   */
  const showing = useMemo(() => {
    const limits = {
      drMin: number(drMin),
      drMax: number(drMax),
      trafficMin: number(trafficMin),
      trafficMax: number(trafficMax),
      priceMin: number(priceMin),
      priceMax: number(priceMax),
    };
    const wantedGeo = geo.trim().toLowerCase();
    const wantedLanguage = language.trim().toLowerCase();

    return rows.filter((one) => {
      if (limits.drMin !== null && (one.rating === null || one.rating < limits.drMin)) return false;
      if (limits.drMax !== null && (one.rating === null || one.rating > limits.drMax)) return false;

      if (limits.trafficMin !== null && (one.traffic === null || one.traffic < limits.trafficMin)) {
        return false;
      }
      if (limits.trafficMax !== null && (one.traffic === null || one.traffic > limits.trafficMax)) {
        return false;
      }

      if (limits.priceMin !== null && (one.price === null || one.price < limits.priceMin)) return false;
      if (limits.priceMax !== null && (one.price === null || one.price > limits.priceMax)) return false;

      if (wantedGeo) {
        /*
         * The sheet's own word, and the countries the checker worked out.
         *
         * Both, because a sheet often has no GEO column and the Top Countries
         * one already says where the traffic is. Matched on whole words rather
         * than anywhere in the string: "in" for India is two letters that
         * appear inside half the English language, and "(US, 19.5K)" would
         * have matched a search for Austria.
         *
         * The country's name counts as well as its code, since a column filled
         * in by hand says UK on one row and United Kingdom on the next.
         */
        const said = `${one.geo} ${one.countries} ${one.notes}`.toLowerCase();
        const words = new Set(said.split(/[^a-z]+/).filter(Boolean));
        const country = MARKETS.find((m) => m.code === wantedGeo);
        const named = country ? country.label.toLowerCase().split(/[^a-z]+/).filter(Boolean) : [];

        const matched =
          words.has(wantedGeo) || (named.length > 0 && named.every((word) => words.has(word)));
        if (!matched) return false;
      }

      if (wantedLanguage && !one.language.toLowerCase().includes(wantedLanguage)) return false;

      if (unwritten && one.sent > 0) return false;

      return true;
    });
  }, [
    rows, drMin, drMax, trafficMin, trafficMax, priceMin, priceMax,
    geo, language, unwritten,
  ]);

  const picked = showing.filter((one) => chosen.has(one.domain));

  /*
   * Who each chosen publisher would hear from, worked out here so the page can
   * refuse before a campaign spends anything.
   *
   * A sheet naming an address nothing can send as is the one failure this
   * feature exists to prevent, and it is silent on Gmail's side: an unverified
   * From is not rejected, it is rewritten to the account's own address and
   * sent. So a row like that is not sent at all, and says so up front.
   */
  const allowed = new Set(senders.map((one) => one.toLowerCase()));
  const sendable = (one: Opportunity): boolean =>
    !one.sender || allowed.has(one.sender.toLowerCase());

  const withAddress = picked.filter((one) => one.email && sendable(one));
  const unsendable = picked.filter((one) => one.email && !sendable(one));

  function toggle(domain: string) {
    setChosen((was) => {
      const next = new Set(was);
      if (next.has(domain)) next.delete(domain);
      else next.add(domain);
      return next;
    });
  }

  async function start() {
    if (!withAddress.length) return push("bad", "None of the chosen publishers has an address.");

    const missing = picked.length - withAddress.length;
    const sure = await ask.confirm({
      title: `Write to ${withAddress.length} publisher${withAddress.length === 1 ? "" : "s"}?`,
      body: (
        <>
          {withAddress.length} article{withAddress.length === 1 ? "" : "s"} will be
          written, one for each site, put in a Google Doc and emailed with the
          link. That is {withAddress.length} model call
          {withAddress.length === 1 ? "" : "s"} and cannot be taken back once the
          first email goes.
          {missing ? (
            <>
              {" "}
              {missing} of the chosen have no address in the sheet and will be
              skipped.
            </>
          ) : null}
          {unsendable.length ? (
            <>
              {" "}
              {unsendable.length} name a Send from address nothing connected here
              can send as, and are skipped rather than written to by somebody the
              publisher does not know.
            </>
          ) : null}
        </>
      ),
      confirmLabel: "Start the campaign",
    });
    if (!sure) return;

    setBusy(true);
    try {
      const response = await fetch("/api/mail/campaign", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          targets: withAddress.map((one) => ({
            domain: one.domain,
            email: one.email,
            from: one.sender,
            price: one.price,
          })),
          anchor_text: anchor,
          anchor_url: anchorUrl,
          article_brief: brief,
          mail_subject: subject,
          mail_body: body,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "The campaign could not be started.");

      push("ok", "Started. Watch it on the Runs page.");
      setChosen(new Set());
      onStarted();
    } catch (e) {
      push("bad", e instanceof Error ? e.message : "The campaign could not be started.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="campaign">
      {!connected ? (
        <div className="notice warn">
          <strong>No mailbox is connected.</strong> A campaign ends in email, so
          connect one on the Inbox tab before starting one.
        </div>
      ) : null}

      {/* ------------------------------------------------------ the sheet */}
      <section className="sheet-section">
        <h3>The sheet</h3>
        <div className="site-row">
          <div>
            <label className="field-label" htmlFor="c-sheet">Sheet ID</label>
            <input
              id="c-sheet"
              type="text"
              className="mono"
              value={sheet}
              placeholder="Blank uses the engine's own"
              onChange={(e) => setSheet(e.target.value.trim())}
            />
          </div>
          <div>
            <label className="field-label" htmlFor="c-tab">Tab</label>
            <input
              id="c-tab"
              type="text"
              className="mono"
              value={tab}
              placeholder="First tab"
              onChange={(e) => setTab(e.target.value.trim())}
            />
          </div>
        </div>
        <button type="button" className="btn btn-primary" disabled={loading} onClick={() => void load()}>
          {loading ? "Reading…" : "Read the sheet"}
        </button>
      </section>

      {rows.length ? (
        <>
          {/* --------------------------------------------------- the filter */}
          <section className="sheet-section">
            <h3>
              Narrow it down
              <span className="quiet campaign-count">
                {showing.length} of {rows.length}
              </span>
            </h3>

            <div className="campaign-filter">
              <div className="field">
                <label className="field-label">Domain Rating</label>
                <div className="campaign-range">
                  <input type="number" placeholder="min" value={drMin} onChange={(e) => setDrMin(e.target.value)} />
                  <span>to</span>
                  <input type="number" placeholder="max" value={drMax} onChange={(e) => setDrMax(e.target.value)} />
                </div>
              </div>

              <div className="field">
                <label className="field-label">Organic traffic</label>
                <div className="campaign-range">
                  <input type="number" placeholder="min" value={trafficMin} onChange={(e) => setTrafficMin(e.target.value)} />
                  <span>to</span>
                  <input type="number" placeholder="max" value={trafficMax} onChange={(e) => setTrafficMax(e.target.value)} />
                </div>
              </div>

              <div className="field">
                <label className="field-label">
                  Price{has && !has.price ? <span className="quiet"> — no column</span> : null}
                </label>
                <div className="campaign-range">
                  <input type="number" placeholder="min" value={priceMin} disabled={!!has && !has.price} onChange={(e) => setPriceMin(e.target.value)} />
                  <span>to</span>
                  <input type="number" placeholder="max" value={priceMax} disabled={!!has && !has.price} onChange={(e) => setPriceMax(e.target.value)} />
                </div>
              </div>

              <div className="field">
                <label className="field-label" id="c-geo-label">Target GEO</label>
                <Select
                  id="c-geo"
                  labelledBy="c-geo-label"
                  value={geo}
                  onChange={setGeo}
                  options={[
                    { value: "", label: "Anywhere" },
                    ...MARKETS.map((m) => ({ value: m.code, label: m.label, hint: m.code })),
                  ]}
                />
              </div>

              <div className="field">
                <label className="field-label" htmlFor="c-lang">
                  Language{has && !has.language ? <span className="quiet"> — no column</span> : null}
                </label>
                <input
                  id="c-lang"
                  type="text"
                  value={language}
                  placeholder="Any"
                  disabled={!!has && !has.language}
                  onChange={(e) => setLanguage(e.target.value)}
                />
              </div>

              <div className="field">
                <label className="check" htmlFor="c-unwritten">
                  <input
                    id="c-unwritten"
                    type="checkbox"
                    checked={unwritten}
                    onChange={(e) => setUnwritten(e.target.checked)}
                  />
                  Not written to yet
                </label>
              </div>
            </div>
          </section>

          {/* ------------------------------------------------- the choosing */}
          <section className="sheet-section">
            <h3>
              Choose the ones worth it
              <span className="quiet campaign-count">{picked.length} chosen</span>
            </h3>

            {!showing.length ? (
              <p className="provider-hint">Nothing in the sheet matches that filter.</p>
            ) : (
              <>
                <div className="campaign-bulk">
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setChosen(new Set(showing.map((one) => one.domain)))}
                  >
                    Choose all {showing.length}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={!picked.length}
                    onClick={() => setChosen(new Set())}
                  >
                    Clear
                  </button>
                </div>

                <div className="table-wrap">
                  <table className="campaign-table">
                    <thead>
                      <tr>
                        <th />
                        <th>Domain</th>
                        <th>DR</th>
                        <th>Traffic</th>
                        <th>Price</th>
                        <th>GEO</th>
                        <th>Language</th>
                        <th>Send from</th>
                        <th>Email</th>
                        <th>Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {showing.map((one) => (
                        <tr
                          key={one.domain}
                          className={chosen.has(one.domain) ? "is-chosen" : undefined}
                          onClick={() => toggle(one.domain)}
                        >
                          <td>
                            <input
                              type="checkbox"
                              checked={chosen.has(one.domain)}
                              onChange={() => toggle(one.domain)}
                              onClick={(e) => e.stopPropagation()}
                              aria-label={`Choose ${one.domain}`}
                            />
                          </td>
                          <td className="mono">{one.domain}</td>
                          <td>{one.rating ?? "—"}</td>
                          <td>{short(one.traffic)}</td>
                          <td>{one.price === null ? "—" : one.price}</td>
                          <td>{one.geo || "—"}</td>
                          <td>{one.language || "—"}</td>
                          {/* Marked where it names something nothing can send
                              as, because that row will be skipped and the
                              reason is not visible anywhere else. */}
                          <td
                            className={
                              sendable(one) ? "mono" : "mono campaign-nosender"
                            }
                            title={
                              sendable(one)
                                ? undefined
                                : "Nothing connected on the Mailing page can send as this"
                            }
                          >
                            {one.sender || "—"}
                          </td>
                          {/* A publisher worth a link and missing an address is
                              a thing to go and find an address for, so it is
                              listed and marked rather than hidden. */}
                          <td className={one.email ? "mono" : "campaign-noaddress"}>
                            {one.email || "none in the sheet"}
                          </td>
                          <td className="campaign-notes" title={one.notes}>
                            {one.notes || "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>

          {/* ---------------------------------------------------- the link */}
          <section className="sheet-section">
            <h3>The link</h3>
            <div className="site-row">
              <div>
                <label className="field-label" htmlFor="c-anchor">Anchor text</label>
                <input
                  id="c-anchor"
                  type="text"
                  value={anchor}
                  placeholder="best payout casinos"
                  onChange={(e) => setAnchor(e.target.value)}
                />
              </div>
              <div className="site-row-wide">
                <label className="field-label" htmlFor="c-anchor-url">Links to</label>
                <input
                  id="c-anchor-url"
                  type="url"
                  className="mono"
                  value={anchorUrl}
                  placeholder="https://oursite.com/best-payout-casinos/"
                  onChange={(e) => setAnchorUrl(e.target.value.trim())}
                />
              </div>
            </div>
            <p className="provider-hint">
              One link per article, placed inside a paragraph already about that
              subject rather than in a closing line written to hold it. An
              article that comes back without it is not sent, because an article
              that reads well and carries no link bought nothing.
            </p>

            <label className="field-label" htmlFor="c-brief">What the article should be about</label>
            <textarea
              id="c-brief"
              className="editor-body"
              rows={4}
              value={brief}
              placeholder="Optional. Left blank, each article is written from what that publisher already publishes."
              onChange={(e) => setBrief(e.target.value)}
            />
          </section>

          {/* --------------------------------------------------- the email */}
          <section className="sheet-section">
            <h3>The email</h3>
            <label className="field-label" htmlFor="c-subject">Subject</label>
            <input id="c-subject" type="text" value={subject} onChange={(e) => setSubject(e.target.value)} />

            <label className="field-label" htmlFor="c-body">Message</label>
            <textarea
              id="c-body"
              className="editor-body"
              rows={10}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
            <p className="provider-hint">
              {"{draft}"} becomes the link to that publisher&apos;s own article,
              {" {domain}"} their site, {"{title}"} the article&apos;s title and{" "}
              {"{price}"} whatever the sheet said they charge. Each publisher gets
              their own, so the link is never the same twice.
            </p>

            <div className="ve-actions">
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || !connected || !withAddress.length || !anchor.trim() || !anchorUrl.trim()}
                onClick={() => void start()}
              >
                {busy
                  ? "Starting…"
                  : `Write and send to ${withAddress.length || "…"} publisher${withAddress.length === 1 ? "" : "s"}`}
              </button>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
