/**
 * The colours this console is drawn in, as something somebody can change.
 *
 * Every colour on the platform already comes from one of about two dozen
 * custom properties on :root — nothing anywhere sets a hex value of its own.
 * That was done for the dark theme, and it means a palette editor does not
 * need to touch a single component: overriding the properties overrides the
 * console.
 *
 * Two palettes, not one. Light and dark are not the same colours at different
 * brightnesses — dark needs a lifted accent to survive on a near-black ground
 * and a much darker soft tint behind it — so a change to one says nothing
 * about the other, and they are edited and stored apart.
 *
 * Only the differences are stored. A token left alone is absent from the file
 * rather than written out at its default, so the defaults below stay the
 * source of truth and a palette saved a year ago inherits anything added to
 * them since.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { kvConfigured, kvGetJSON, kvSetJSON } from "./kv";

const KEY = "content-automation:palette";
const DIR = path.join(process.cwd(), ".data");
const FILE = path.join(DIR, "palette.json");

export type Mode = "light" | "dark";

export interface Token {
  /** The custom property, without the leading dashes. */
  name: string;
  label: string;
  group: string;
  /** What it actually paints, in the terms somebody choosing a colour thinks in. */
  note: string;
  light: string;
  dark: string;
}

/**
 * What each colour is for.
 *
 * The notes are the whole point of the page. "--ink-3" means nothing to
 * somebody who wants the quiet grey under a heading to be a little darker, and
 * a grid of labelled swatches with no explanation is a puzzle rather than a
 * control panel.
 */
export const TOKENS: Token[] = [
  // --- the one colour that is the product's -----------------------------
  {
    name: "accent",
    label: "Primary",
    group: "Brand",
    note: "Buttons, links, the bar on a running job, the current page in the top bar.",
    light: "#2f6df6",
    dark: "#5b8dff",
  },
  {
    name: "accent-ink",
    label: "Text on primary",
    group: "Brand",
    note: "The lettering inside a primary button. Keep it far from the primary itself.",
    light: "#ffffff",
    dark: "#0b0e13",
  },
  {
    name: "accent-soft",
    label: "Primary wash",
    group: "Brand",
    note: "The pale ground behind a selected row or a quiet primary button.",
    light: "#e8f0ff",
    dark: "#17233c",
  },

  // --- what the console is made of --------------------------------------
  {
    name: "bg",
    label: "Page",
    group: "Surfaces",
    note: "Behind everything. The cards sit on it.",
    light: "#f2f4f7",
    dark: "#0e1116",
  },
  {
    name: "panel",
    label: "Card",
    group: "Surfaces",
    note: "Every card, dialog, menu and table on the page.",
    light: "#ffffff",
    dark: "#161b22",
  },
  {
    name: "panel-2",
    label: "Inset",
    group: "Surfaces",
    note: "A panel inside a panel: table headings, a loop box, a code block.",
    light: "#fbfcfd",
    dark: "#1b212a",
  },
  {
    name: "line",
    label: "Border",
    group: "Surfaces",
    note: "Every rule and edge. Most of the console's structure is this colour.",
    light: "#e3e7ed",
    dark: "#262d38",
  },
  {
    name: "line-2",
    label: "Strong border",
    group: "Surfaces",
    note: "The edge of a field, and anything meant to read as an edge rather than a seam.",
    light: "#d3d9e2",
    dark: "#333c4a",
  },

  // --- the words --------------------------------------------------------
  {
    name: "ink",
    label: "Text",
    group: "Text",
    note: "Headings and body. The contrast of this against the card is what makes the console readable.",
    light: "#10141a",
    dark: "#e9edf3",
  },
  {
    name: "ink-2",
    label: "Secondary text",
    group: "Text",
    note: "Labels, table headings, the sentence under a heading.",
    light: "#4a5567",
    dark: "#a9b4c4",
  },
  {
    name: "ink-3",
    label: "Quiet text",
    group: "Text",
    note: "Timestamps, hints, placeholders. The quietest text that still has to be read.",
    light: "#7b8798",
    dark: "#79859a",
  },

  // --- how a thing reports on itself -------------------------------------
  {
    name: "ok",
    label: "Success",
    group: "Status",
    note: "A finished run, a reachable host, a saved change.",
    light: "#12855a",
    dark: "#4ad295",
  },
  {
    name: "ok-soft",
    label: "Success wash",
    group: "Status",
    note: "Behind a success badge or notice.",
    light: "#e2f5ec",
    dark: "#12271f",
  },
  {
    name: "warn",
    label: "Warning",
    group: "Status",
    note: "Something worked but is worth reading: a skipped publisher, an expiring domain.",
    light: "#9a6400",
    dark: "#e0a94a",
  },
  {
    name: "warn-soft",
    label: "Warning wash",
    group: "Status",
    note: "Behind a warning badge or notice.",
    light: "#fdf1dc",
    dark: "#2a2113",
  },
  {
    name: "bad",
    label: "Failure",
    group: "Status",
    note: "A failed run, a broken link, a refused credential.",
    light: "#c0392f",
    dark: "#ff7a6e",
  },
  {
    name: "bad-soft",
    label: "Failure wash",
    group: "Status",
    note: "Behind a failure badge or notice.",
    light: "#fdeceb",
    dark: "#2d1715",
  },
  {
    name: "run",
    label: "Running",
    group: "Status",
    note: "A job still going. The same blue as the primary by default, and worth keeping that way.",
    light: "#2f6df6",
    dark: "#5b8dff",
  },
  {
    name: "run-soft",
    label: "Running wash",
    group: "Status",
    note: "Behind a running badge, and the track the progress bar fills.",
    light: "#e8f0ff",
    dark: "#17233c",
  },

  // --- the two that are neither ------------------------------------------
  {
    name: "pin",
    label: "Pinned",
    group: "Pinned and danger",
    note: "A pinned step. Purple because a pinned step is neither success nor failure — it is a step that did not run.",
    light: "#6b3fd4",
    dark: "#b79bff",
  },
  {
    name: "pin-soft",
    label: "Pinned wash",
    group: "Pinned and danger",
    note: "Behind a pinned step.",
    light: "#f1ebfe",
    dark: "#241a3d",
  },
  {
    name: "pin-line",
    label: "Pinned border",
    group: "Pinned and danger",
    note: "The edge around a pinned step.",
    light: "#d9c9f7",
    dark: "#3d2f63",
  },
  {
    name: "danger-bg",
    label: "Destructive button",
    group: "Pinned and danger",
    note: "Delete, Forget, Cancel run. Filled rather than outlined, so it is a ground and not a text colour.",
    light: "#c0392f",
    dark: "#d0453a",
  },
  {
    name: "danger-bg-hover",
    label: "Destructive, hovered",
    group: "Pinned and danger",
    note: "The same button under the pointer.",
    light: "#a52f26",
    dark: "#e05a4e",
  },
];

/** Only what differs from the defaults, per mode. */
export interface Palette {
  light: Record<string, string>;
  dark: Record<string, string>;
  updatedAt: string;
  updatedBy: string;
}

export const EMPTY: Palette = { light: {}, dark: {}, updatedAt: "", updatedBy: "" };

const BY_NAME = new Map(TOKENS.map((one) => [one.name, one]));

/** #abc and #aabbcc, and nothing else. */
export function isColour(value: unknown): value is string {
  return typeof value === "string" && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value.trim());
}

/**
 * A submitted palette, reduced to what this console will actually accept.
 *
 * Unknown names are dropped rather than rejected — a token removed from the
 * list above should not make an old saved palette unsaveable — and a value
 * equal to the default is dropped too, which is what keeps "only the
 * differences" true no matter what the page sends.
 */
export function clean(input: unknown): {
  light: Record<string, string>;
  dark: Record<string, string>;
} {
  const out = {
    light: {} as Record<string, string>,
    dark: {} as Record<string, string>,
  };
  if (!input || typeof input !== "object") return out;

  for (const mode of ["light", "dark"] as const) {
    const given = (input as Record<string, unknown>)[mode];
    if (!given || typeof given !== "object") continue;
    for (const [name, value] of Object.entries(given as Record<string, unknown>)) {
      const token = BY_NAME.get(name);
      if (!token || !isColour(value)) continue;
      const hex = value.trim().toLowerCase();
      if (hex === token[mode].toLowerCase()) continue;
      out[mode][name] = hex;
    }
  }
  return out;
}

/** Every token's value for a mode, defaults filled in. */
export function resolve(palette: Palette, mode: Mode): Record<string, string> {
  const out: Record<string, string> = {};
  for (const token of TOKENS) out[token.name] = palette[mode][token.name] ?? token[mode];
  return out;
}

/**
 * The palette as a stylesheet, in the three cases the console's own theming
 * already deals with: light, dark because the machine asked for it, and dark
 * because somebody chose it.
 *
 * ":root:root" rather than ":root" on purpose. This is one selector heavier
 * than the rule it is overriding, so it wins wherever the browser decides to
 * put it — which, for a stylesheet the framework emits, is not something worth
 * depending on. The two dark blocks are in the order the base stylesheet uses
 * them, so an explicit choice still beats the machine's preference.
 *
 * Empty when nothing has been changed, so an untouched installation ships no
 * extra bytes and no extra rules.
 */
export function paletteCss(palette: Palette): string {
  const light = Object.entries(palette.light).filter(([name]) => BY_NAME.has(name));
  const dark = Object.entries(palette.dark).filter(([name]) => BY_NAME.has(name));
  if (!light.length && !dark.length) return "";

  const body = (rows: [string, string][]) =>
    rows.map(([name, value]) => `--${name}:${value}`).join(";");

  const parts: string[] = [];
  if (light.length) parts.push(`:root:root{${body(light)}}`);
  if (dark.length) {
    parts.push(
      `@media (prefers-color-scheme:dark){:root:root:not([data-theme="light"]){${body(dark)}}}`,
    );
    parts.push(`:root:root[data-theme="dark"]{${body(dark)}}`);
  }
  return parts.join("");
}

// ----------------------------------------------------------------- storage

async function read(): Promise<Palette> {
  if (kvConfigured()) {
    const saved = await kvGetJSON<Palette>(KEY);
    if (saved && typeof saved === "object") return { ...EMPTY, ...saved };
  }
  try {
    if (existsSync(FILE)) {
      const parsed = JSON.parse(readFileSync(FILE, "utf8")) as Palette;
      if (parsed && typeof parsed === "object") return { ...EMPTY, ...parsed };
    }
  } catch {
    // A corrupt file is the default palette, not a console that will not load.
  }
  return EMPTY;
}

export async function getPalette(): Promise<Palette> {
  const saved = await read();
  const only = clean(saved);
  return { ...saved, light: only.light, dark: only.dark };
}

export async function savePalette(input: unknown, actor: string): Promise<Palette> {
  const only = clean(input);
  const palette: Palette = {
    ...only,
    updatedAt: new Date().toISOString(),
    updatedBy: actor,
  };

  if (kvConfigured()) {
    if (await kvSetJSON(KEY, palette)) return palette;
    throw new Error("The store did not accept the write, so nothing was saved.");
  }
  mkdirSync(DIR, { recursive: true });
  writeFileSync(FILE, JSON.stringify(palette, null, 2), "utf8");
  return palette;
}
