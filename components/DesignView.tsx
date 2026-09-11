"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Toasts, useToasts } from "@/components/Toasts";
import type { Mode, Palette, Token } from "@/lib/palette";

/**
 * The console's colours, as a page.
 *
 * Every colour on the platform comes from a custom property on :root, so this
 * edits those and nothing else. No component knows this page exists.
 *
 * Three things make it usable rather than merely complete. It says what each
 * colour paints, because "--ink-3" is not a question anybody can answer. It
 * applies the change as it is made, on the console you are already looking at,
 * so the swatch grid is not the preview — the page around it is. And it works
 * out the contrast of the pairs that decide whether the console is readable,
 * because the failure this page invites is a palette somebody likes in the
 * swatches and cannot read a table in.
 *
 * Light and dark are edited apart. They are not one palette at two
 * brightnesses, and a control that changed both would be wrong for one of them
 * every time.
 */

// --------------------------------------------------------------- contrast

/** One channel of a hex colour, 0-255. */
function channels(hex: string): [number, number, number] {
  let value = hex.trim().replace("#", "");
  if (value.length === 3) value = value.split("").map((c) => c + c).join("");
  const n = parseInt(value, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** WCAG relative luminance. */
function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The WCAG ratio between two colours, 1 to 21. */
function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/**
 * The pairs that decide whether this console can be read.
 *
 * Not every combination — most of them never meet. These are the ones that sit
 * on top of each other on every page, and each is the reason somebody would
 * notice a palette had gone wrong.
 */
const PAIRS: { front: string; back: string; what: string; need: number }[] = [
  { front: "ink", back: "panel", what: "Text on a card", need: 4.5 },
  { front: "ink", back: "bg", what: "Text on the page", need: 4.5 },
  { front: "ink-2", back: "panel", what: "Secondary text on a card", need: 4.5 },
  { front: "ink-3", back: "panel", what: "Quiet text on a card", need: 4.5 },
  { front: "accent-ink", back: "accent", what: "A primary button", need: 4.5 },
  { front: "accent", back: "panel", what: "A link on a card", need: 3 },
  { front: "ok", back: "ok-soft", what: "A success badge", need: 3 },
  { front: "warn", back: "warn-soft", what: "A warning badge", need: 3 },
  { front: "bad", back: "bad-soft", what: "A failure badge", need: 3 },
  { front: "pin", back: "pin-soft", what: "A pinned step", need: 3 },
];

// ------------------------------------------------------------------- page

export default function DesignView() {
  const { toasts, push, dismiss } = useToasts();

  const [tokens, setTokens] = useState<Token[]>([]);
  const [values, setValues] = useState<{ light: Record<string, string>; dark: Record<string, string> }>({
    light: {},
    dark: {},
  });
  const [saved, setSaved] = useState<{ light: Record<string, string>; dark: Record<string, string> }>({
    light: {},
    dark: {},
  });
  const [mode, setMode] = useState<Mode>("light");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [at, setAt] = useState<string>("");

  /*
   * Which theme the console is actually showing.
   *
   * The preview only means anything for the mode you are looking at — painting
   * dark values onto a light console would show colours nobody will ever see
   * in that combination. So editing the other one previews nothing, and the
   * page says so rather than appearing to do nothing.
   */
  const [showing, setShowing] = useState<Mode>("light");

  useEffect(() => {
    const root = document.documentElement;
    const read = (): Mode => {
      const chosen = root.getAttribute("data-theme");
      if (chosen === "dark" || chosen === "light") return chosen;
      return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    };
    const now = read();
    setShowing(now);
    setMode(now);

    // The theme can change under this page — the switch is in the profile menu,
    // which is on every page including this one.
    const watch = new MutationObserver(() => setShowing(read()));
    watch.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onMedia = () => setShowing(read());
    media.addEventListener("change", onMedia);
    return () => {
      watch.disconnect();
      media.removeEventListener("change", onMedia);
    };
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/design", { cache: "no-store" });
        if (response.status === 401) {
          window.location.href = "/login";
          return;
        }
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "The palette could not be read.");
        const palette: Palette = payload.palette;
        setTokens(payload.tokens ?? []);
        setValues({ light: { ...palette.light }, dark: { ...palette.dark } });
        setSaved({ light: { ...palette.light }, dark: { ...palette.dark } });
        setAt(palette.updatedAt ?? "");
      } catch (e) {
        setError(e instanceof Error ? e.message : "The palette could not be read.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  /** Every token's current value for a mode, defaults filled in. */
  const full = useCallback(
    (which: Mode): Record<string, string> => {
      const out: Record<string, string> = {};
      for (const token of tokens) out[token.name] = values[which][token.name] ?? token[which];
      return out;
    },
    [tokens, values],
  );

  /*
   * The preview, painted straight onto the document.
   *
   * Inline properties on <html> beat every stylesheet, including the saved
   * palette in the head, so this shows exactly what saving would produce
   * without saving anything. Cleared when the page is left, which puts the
   * console back to whatever is actually stored.
   */
  const painted = useRef<string[]>([]);
  useEffect(() => {
    if (!tokens.length) return;
    const root = document.documentElement;
    for (const name of painted.current) root.style.removeProperty(`--${name}`);
    painted.current = [];

    if (mode !== showing) return;
    for (const [name, value] of Object.entries(values[mode])) {
      root.style.setProperty(`--${name}`, value);
      painted.current.push(name);
    }
  }, [values, mode, showing, tokens.length]);

  useEffect(
    () => () => {
      const root = document.documentElement;
      for (const name of painted.current) root.style.removeProperty(`--${name}`);
      painted.current = [];
    },
    [],
  );

  const groups = useMemo(() => {
    const order: string[] = [];
    const by = new Map<string, Token[]>();
    for (const token of tokens) {
      if (!by.has(token.group)) {
        by.set(token.group, []);
        order.push(token.group);
      }
      by.get(token.group)!.push(token);
    }
    return order.map((name) => ({ name, tokens: by.get(name)! }));
  }, [tokens]);

  const changed = useMemo(
    () => JSON.stringify(values) !== JSON.stringify(saved),
    [values, saved],
  );

  const changedHere = Object.keys(values[mode]).length;

  function set(name: string, value: string) {
    setValues((current) => ({ ...current, [mode]: { ...current[mode], [name]: value } }));
  }

  /** Back to the built-in value, which means forgetting it rather than storing it. */
  function clear(name: string) {
    setValues((current) => {
      const next = { ...current[mode] };
      delete next[name];
      return { ...current, [mode]: next };
    });
  }

  function clearMode() {
    setValues((current) => ({ ...current, [mode]: {} }));
  }

  async function save() {
    setBusy(true);
    try {
      const response = await fetch("/api/design", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(values),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "It could not be saved.");
      const palette: Palette = payload.palette;
      setValues({ light: { ...palette.light }, dark: { ...palette.dark } });
      setSaved({ light: { ...palette.light }, dark: { ...palette.dark } });
      setAt(palette.updatedAt ?? "");
      writeLiveStyle(palette);
      push("ok", "Saved. Every page uses these colours now.");
    } catch (e) {
      push("bad", e instanceof Error ? e.message : "It could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="empty">Reading the palette…</div>;
  if (error) return <div className="notice bad">{error}</div>;

  const here = full(mode);

  return (
    <div className="stack">
      <div className="card">
        <div className="card-head">
          <div>
            <h2>Colours</h2>
            <p>
              Everything on this console is drawn from the colours below, so a
              change here reaches every page at once. Light and dark are kept
              apart, because the same colour rarely works in both.
            </p>
          </div>
          <div className="spacer" />
          <div className="app-head-actions">
            <button
              type="button"
              className="btn btn-ghost head-do"
              disabled={busy || !changedHere}
              onClick={clearMode}
              title={`Put every ${mode} colour back to the one it started as`}
            >
              Reset {mode}
            </button>
            <button
              type="button"
              className="btn head-do is-new"
              disabled={busy || !changed}
              onClick={save}
            >
              {busy ? "Saving…" : "Save colours"}
            </button>
          </div>
        </div>

        <div className="card-body">
          <div className="seg seg-sm design-modes">
            <button
              type="button"
              className={mode === "light" ? "seg-btn is-on" : "seg-btn"}
              onClick={() => setMode("light")}
            >
              Light
              {Object.keys(values.light).length ? (
                <span className="seg-count">{Object.keys(values.light).length}</span>
              ) : null}
            </button>
            <button
              type="button"
              className={mode === "dark" ? "seg-btn is-on" : "seg-btn"}
              onClick={() => setMode("dark")}
            >
              Dark
              {Object.keys(values.dark).length ? (
                <span className="seg-count">{Object.keys(values.dark).length}</span>
              ) : null}
            </button>
          </div>

          {mode === showing ? (
            <p className="provider-hint design-hint">
              The console around you is showing these colours as you pick them.
              Nothing is stored until you save.
            </p>
          ) : (
            <p className="notice warn design-hint">
              You are editing the {mode} palette while the console is in{" "}
              {showing}. The changes are kept, but you will not see them until
              you switch to {mode} in the profile menu.
            </p>
          )}

          {at ? (
            <p className="provider-hint design-when">
              Last changed {new Date(at).toLocaleString()}.
            </p>
          ) : null}
        </div>
      </div>

      {groups.map((group) => (
        <div className="card" key={group.name}>
          <div className="card-head">
            <div>
              <h2>{group.name}</h2>
            </div>
          </div>
          <div className="card-body">
            <div className="swatches">
              {group.tokens.map((token) => {
                const value = here[token.name];
                const moved = values[mode][token.name] !== undefined;
                return (
                  <div className={moved ? "swatch is-changed" : "swatch"} key={token.name}>
                    <label className="swatch-chip" title={`Pick a colour for ${token.label}`}>
                      <input
                        type="color"
                        value={value}
                        onChange={(e) => set(token.name, e.target.value)}
                        aria-label={token.label}
                      />
                      <span className="swatch-fill" style={{ background: value }} />
                    </label>

                    <div className="swatch-what">
                      <strong>{token.label}</strong>
                      <span className="swatch-note">{token.note}</span>
                      <code className="swatch-var">--{token.name}</code>
                    </div>

                    <div className="swatch-value">
                      <input
                        type="text"
                        className="swatch-hex mono"
                        value={value}
                        spellCheck={false}
                        onChange={(e) => {
                          const typed = e.target.value.trim();
                          // Typed a character at a time, so it is only taken
                          // when it is a whole colour. Anything else would set
                          // the console to "#2f6" halfway through "#2f6df6".
                          if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(typed)) {
                            set(token.name, typed.toLowerCase());
                          }
                        }}
                        aria-label={`${token.label} as a hex value`}
                      />
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm swatch-reset"
                        disabled={!moved}
                        onClick={() => clear(token.name)}
                        title={`Back to ${token[mode]}`}
                      >
                        Reset
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ))}

      <div className="card">
        <div className="card-head">
          <div>
            <h2>Readability</h2>
            <p>
              How far each colour stands out from the one behind it, against
              what the accessibility guidelines ask for. A palette can look
              right in the swatches above and still leave a table unreadable.
            </p>
          </div>
        </div>
        <div className="card-body tight">
          <table className="logs logs-middle table-in">
            <thead>
              <tr>
                <th>Where</th>
                <th className="mid">Sample</th>
                <th className="mid">Contrast</th>
                <th className="mid">Wanted</th>
                <th className="mid">Verdict</th>
              </tr>
            </thead>
            <tbody>
              {PAIRS.map((pair) => {
                const front = here[pair.front];
                const back = here[pair.back];
                if (!front || !back) return null;
                const ratio = contrast(front, back);
                const ok = ratio >= pair.need;
                return (
                  <tr key={`${pair.front}-${pair.back}`}>
                    <td>{pair.what}</td>
                    <td className="mid">
                      <span className="contrast-sample" style={{ background: back, color: front }}>
                        Sample text
                      </span>
                    </td>
                    <td className="mid mono">{ratio.toFixed(2)}</td>
                    <td className="mid mono">{pair.need.toFixed(1)}</td>
                    <td className="mid">
                      <span className={ok ? "badge badge-success" : "badge badge-canceled"}>
                        {ok ? "Readable" : "Too close"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <Toasts toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}

/**
 * Keeps the rest of the console right after a save.
 *
 * The saved palette is written into the document by the root layout, and the
 * root layout does not run again when you click through to another page — so
 * without this, saving and then leaving would show the old colours until
 * something forced a full load. This replaces the same element the server
 * writes, by the same id, so the two never both apply.
 */
function writeLiveStyle(palette: Palette) {
  const rows = (values: Record<string, string>) =>
    Object.entries(values)
      .map(([name, value]) => `--${name}:${value}`)
      .join(";");

  const parts: string[] = [];
  if (Object.keys(palette.light).length) parts.push(`:root:root{${rows(palette.light)}}`);
  if (Object.keys(palette.dark).length) {
    parts.push(
      `@media (prefers-color-scheme:dark){:root:root:not([data-theme="light"]){${rows(palette.dark)}}}`,
    );
    parts.push(`:root:root[data-theme="dark"]{${rows(palette.dark)}}`);
  }

  const existing = document.getElementById("ca-palette");
  if (!parts.length) {
    existing?.remove();
    return;
  }
  const tag = existing ?? document.head.appendChild(document.createElement("style"));
  tag.id = "ca-palette";
  tag.textContent = parts.join("");
}
