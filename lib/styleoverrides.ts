/**
 * Style changes made to a site's header and footer.
 *
 * Everything else the visual editor touches lives in the page it was typed on,
 * and is saved by saving that page's markup. The header and footer are not
 * markup: they are a template with placeholders in it, rendered fresh every
 * time. An inline style written onto a rendered header survives until the next
 * render and not one moment longer.
 *
 * So a change there is recorded as a rule instead, in the site's own
 * stylesheet, against a selector for the thing that was changed. Which also
 * makes it work for a site with no designed shell at all, where there is no
 * markup to write a style onto in the first place.
 *
 * The rules live in a block of their own at the end of the sheet, so that what
 * the build wrote and what a person changed stay legible as two different
 * things — and so that changing the same thing twice replaces the rule rather
 * than piling another one on top of it.
 */

const OPEN = "/* --- changed in the editor --- */";

/** `fontSize` is what the panel calls it; `font-size` is what CSS calls it. */
export function cssProperty(name: string): string {
  return name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

type Rules = Map<string, Map<string, string>>;

/** The managed block, read back into something that can be changed. */
function read(block: string): Rules {
  const rules: Rules = new Map();
  for (const chunk of block.split("}")) {
    const at = chunk.indexOf("{");
    if (at < 0) continue;
    const selector = chunk.slice(0, at).trim();
    if (!selector) continue;

    const declarations = new Map<string, string>();
    for (const one of chunk.slice(at + 1).split(";")) {
      const colon = one.indexOf(":");
      if (colon < 0) continue;
      const property = one.slice(0, colon).trim();
      const value = one.slice(colon + 1).trim();
      if (property && value) declarations.set(property, value);
    }
    if (declarations.size) rules.set(selector, declarations);
  }
  return rules;
}

function write(rules: Rules): string {
  const out: string[] = [];
  for (const [selector, declarations] of rules) {
    if (!declarations.size) continue;
    const body = [...declarations].map(([p, v]) => `${p}: ${v}`).join("; ");
    out.push(`${selector} { ${body} }`);
  }
  return out.length ? `${OPEN}\n${out.join("\n")}\n` : "";
}

/**
 * Set one property on one selector, and hand back the whole stylesheet.
 *
 * An empty value removes the property rather than writing an empty one, which
 * is what "back to whatever the page says" has to mean: a declaration set to
 * nothing is not the same as no declaration, and only the second lets the
 * design's own rule show through again.
 */
export function applyOverride(
  css: string,
  selector: string,
  property: string,
  value: string,
): string {
  const clean = selector.trim();
  if (!clean) return css;

  const at = css.indexOf(OPEN);
  const before = at < 0 ? css : css.slice(0, at);
  const rules = read(at < 0 ? "" : css.slice(at + OPEN.length));

  const name = cssProperty(property);
  const declarations = rules.get(clean) ?? new Map<string, string>();

  if (value.trim()) declarations.set(name, value.trim());
  else declarations.delete(name);

  if (declarations.size) rules.set(clean, declarations);
  else rules.delete(clean);

  const block = write(rules);
  const head = before.replace(/\s+$/, "");
  if (!block) return head;
  return head ? `${head}\n\n${block}` : block;
}

/** What is already set for a selector, so the panel can show it. */
export function overridesFor(css: string, selector: string): Record<string, string> {
  const at = css.indexOf(OPEN);
  if (at < 0) return {};
  const found = read(css.slice(at + OPEN.length)).get(selector.trim());
  return found ? Object.fromEntries(found) : {};
}
