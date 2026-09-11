"use client";

import { useCallback, useEffect, useState } from "react";

import { useAsk } from "@/components/Ask";
import { FoldBody, FoldToggle, useFold } from "@/components/Fold";
import { Toasts, useToasts } from "@/components/Toasts";
import type { SitePrompt } from "@/lib/siteprompts";

/**
 * An instruction attached to one site.
 *
 * Some sites need something said every time they are written for, and it is
 * never the same thing twice: a market with rules about how bonuses may be
 * described, a house style for headings, a competitor never to be named.
 * Putting any of that in the shared prompt applies it everywhere, and putting
 * it in a brief document means remembering to attach the right document to the
 * right run — which a loop firing overnight has nobody to do for it.
 *
 * So it is attached to the domain, once. Every run that writes for that site
 * picks it up, and a loop picks up whatever is saved at the moment it fires
 * rather than whatever was there when the loop was made.
 *
 * One per site, deliberately. A run cannot be told to follow two sets of
 * instructions, so saving the same domain twice is an edit rather than a
 * second entry.
 */

function when(value: string): string {
  if (!value) return "";
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return "";
  return at.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function PromptsView() {
  const ask = useAsk();
  const { toasts, push, dismiss } = useToasts();
  const fold = useFold();

  const [prompts, setPrompts] = useState<SitePrompt[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** The one being written, new or opened from the list. */
  const [domain, setDomain] = useState("");
  const [text, setText] = useState("");
  const [editing, setEditing] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/prompts", { cache: "no-store" });
      if (response.status === 401) {
        window.location.href = "/login";
        return;
      }
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "The instructions could not be read.");
      setPrompts(payload.prompts ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The instructions could not be read.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    const site = domain.trim();
    const words = text.trim();
    if (!site || !words || busy) return;

    setBusy(true);
    try {
      const response = await fetch("/api/prompts", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ domain: site, prompt: words }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "It could not be saved.");

      setPrompts(payload.prompts ?? []);
      setDomain("");
      setText("");
      setEditing(null);
      push("ok", `Saved. Every run for ${site} follows it from now on.`);
    } catch (e) {
      push("bad", e instanceof Error ? e.message : "It could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(one: SitePrompt) {
    const sure = await ask.confirm({
      title: `Remove the instructions for ${one.domain}?`,
      body: (
        <>
          Runs for that site go back to the house brief alone. Nothing already
          written changes, and this can be written again.
        </>
      ),
      confirmLabel: "Remove them",
      tone: "danger",
    });
    if (!sure) return;

    setBusy(true);
    try {
      const response = await fetch(`/api/prompts?domain=${encodeURIComponent(one.domain)}`, {
        method: "DELETE",
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "It could not be removed.");
      setPrompts(payload.prompts ?? []);
      if (editing === one.domain) {
        setEditing(null);
        setDomain("");
        setText("");
      }
      push("ok", "Removed.");
    } catch (e) {
      push("bad", e instanceof Error ? e.message : "It could not be removed.");
    } finally {
      setBusy(false);
    }
  }

  function open(one: SitePrompt) {
    setEditing(one.domain);
    setDomain(one.domain);
    setText(one.prompt);
  }

  return (
    <div className="stack">
      <section className={fold.className}>
        <div className="card-head">
          <div>
            <h2>{editing ? `Instructions for ${editing}` : "New instructions"}</h2>
            <p>
              Written for one site and followed by every run that touches it, a
              loop included. They sit under the house brief and win where the
              two disagree.
            </p>
          </div>
          <div className="spacer" />
          {editing ? (
            <button
              type="button"
              className="btn btn-ghost head-do"
              disabled={busy}
              onClick={() => {
                setEditing(null);
                setDomain("");
                setText("");
              }}
            >
              New instead
            </button>
          ) : null}
          <FoldToggle open={fold.open} what="the editor" onToggle={fold.toggle} />
        </div>

        <FoldBody>
          <div className="card-body">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void save();
              }}
            >
              <div className="field">
                <label className="field-label" htmlFor="prompt-domain">
                  Site
                </label>
                <input
                  id="prompt-domain"
                  type="text"
                  value={domain}
                  spellCheck={false}
                  placeholder="example.com"
                  // Left editable while editing, because changing it is how a
                  // set of instructions is moved to another site.
                  onChange={(e) => setDomain(e.target.value)}
                />
                <p className="provider-hint">
                  The address a run is started with finds this, however it is
                  typed. A scheme, a path and www all come off, so
                  https://www.example.com/blog is example.com. A subdomain that
                  is not www is a different site.
                </p>
              </div>

              <div className="field">
                <label className="field-label" htmlFor="prompt-text">
                  What to tell the model about this site
                </label>
                <textarea
                  id="prompt-text"
                  className="editor-body"
                  rows={10}
                  value={text}
                  placeholder={
                    "Never name a competitor.\n" +
                    "Bonus terms must say the wagering requirement in the same sentence as the figure.\n" +
                    "Headings are sentence case."
                  }
                  onChange={(e) => setText(e.target.value)}
                />
                <p className="provider-hint">
                  Plain instructions, one per line. This is added to the prompt
                  that writes each page, so it reads the way a brief does rather
                  than the way a form does.
                </p>
              </div>

              <div className="loop-actions">
                <button type="submit" className="btn" disabled={busy || !domain.trim() || !text.trim()}>
                  {busy ? "Saving…" : editing ? "Save changes" : "Save instructions"}
                </button>
              </div>
            </form>
          </div>
        </FoldBody>
      </section>

      <section className="card">
        <div className="card-head">
          <div>
            <h2>Sites with their own instructions</h2>
            <p>
              {prompts.length
                ? `${prompts.length} site${prompts.length === 1 ? "" : "s"}. Every other site is written from the house brief alone.`
                : "Every site is written from the house brief alone."}
            </p>
          </div>
        </div>

        <div className="card-body">
          {loading ? (
            <p className="provider-hint history-empty">Reading them…</p>
          ) : error ? (
            <div className="notice bad">{error}</div>
          ) : !prompts.length ? (
            <p className="provider-hint history-empty">
              Nothing saved yet. A site with instructions here is written to
              them; a site without is written from the house brief, which is
              what every site does today.
            </p>
          ) : (
            <ul className="prompt-list">
              {prompts.map((one) => (
                <li className={editing === one.domain ? "prompt is-open" : "prompt"} key={one.domain}>
                  <div className="prompt-head">
                    <strong className="mono">{one.domain}</strong>
                    <span className="prompt-when">
                      {one.updatedBy ? `${one.updatedBy}, ` : ""}
                      {when(one.updatedAt)}
                    </span>
                    <div className="spacer" />
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={busy}
                      onClick={() => open(one)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm prompt-drop"
                      disabled={busy}
                      onClick={() => void remove(one)}
                    >
                      Remove
                    </button>
                  </div>
                  {/* The whole thing, not a first line. It is the reason the
                      page exists and it is usually three sentences. */}
                  <pre className="prompt-words">{one.prompt}</pre>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <Toasts toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
