/**
 * Confining a stylesheet to one part of a page.
 *
 * A generated site carries its own design. Publishing its pages into an
 * existing WordPress site means that design arrives in a page that already has
 * one, and a rule for `h2` or `.card` written for a standalone site will
 * happily restyle the target's header, its sidebar and every other page's
 * furniture. The generated design has to apply to the generated content and
 * stop there.
 *
 * So every selector is prefixed with a wrapper class the published content sits
 * inside. `h2` becomes `.wrapper h2`. `.card, .cta` becomes `.wrapper .card,
 * .wrapper .cta`. A rule already anchored at `:root`, `html` or `body` is
 * rewritten to the wrapper itself, since those mean "the whole document" and
 * the whole document is no longer ours to speak for — and dropping them instead
 * would lose the custom properties the rest of the sheet is built on.
 *
 * This is a text transform, not a parser. It handles the CSS a generated site
 * actually contains: rules, at-rules that wrap rules, custom properties,
 * comments and strings. It is not a general CSS engine and does not pretend to
 * be one; what it will not do is silently mangle something, because anything it
 * does not recognise is left alone.
 */

/** At-rules whose body is declarations rather than rules, so it is left alone. */
const FLAT_AT_RULES = /^@(font-face|page|viewport|counter-style|property|keyframes|-\w+-keyframes)/i;

/** At-rules that wrap ordinary rules, whose insides do need prefixing. */
const NESTED_AT_RULES = /^@(media|supports|layer|container|scope)/i;

/**
 * Split a selector list on the commas that separate selectors, ignoring the
 * ones inside :is(), :not(), [attr=","] and quoted strings.
 */
function splitSelectors(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = "";
  let at = 0;

  for (let i = 0; i < list.length; i += 1) {
    const ch = list[i]!;
    if (quote) {
      if (ch === "\\") i += 1;
      else if (ch === quote) quote = "";
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "(" || ch === "[") depth += 1;
    else if (ch === ")" || ch === "]") depth -= 1;
    else if (ch === "," && depth === 0) {
      out.push(list.slice(at, i));
      at = i + 1;
    }
  }
  out.push(list.slice(at));
  return out.map((s) => s.trim()).filter(Boolean);
}

/** One selector, confined. */
function confine(selector: string, wrapper: string): string {
  const trimmed = selector.trim();
  if (!trimmed) return trimmed;

  // Already ours.
  if (trimmed === wrapper || trimmed.startsWith(`${wrapper} `) || trimmed.startsWith(`${wrapper}.`)) {
    return trimmed;
  }

  /*
   * The whole document, which is no longer ours to speak for.
   *
   * These carry the custom properties everything else is built on, so they
   * become the wrapper rather than being dropped. `:root` in particular is
   * where a generated design keeps its palette, and a sheet that lost it would
   * render every colour as the browser's default.
   */
  const root = trimmed.replace(
    /^(:root|html|body)(?=$|[\s>+~,:.[])/i,
    wrapper,
  );
  if (root !== trimmed) return root.trim() || wrapper;

  // A selector that begins with a combinator is relative to its parent already.
  if (/^[>+~]/.test(trimmed)) return `${wrapper} ${trimmed}`;

  return `${wrapper} ${trimmed}`;
}

/**
 * Prefix every selector in `css` with `wrapper`.
 *
 * Returns the stylesheet unchanged if it cannot be read confidently — an
 * unbalanced brace means something was misunderstood, and a mangled stylesheet
 * is worse than an unscoped one is dangerous.
 */
export function scopeCss(css: string, wrapper: string): string {
  if (!css.trim()) return "";

  let out = "";
  let buffer = "";
  let depth = 0;
  let quote = "";
  // The at-rules we are currently inside, innermost last, so a rule inside a
  // media query knows it is still a rule and not part of a font-face.
  const inside: boolean[] = [];

  for (let i = 0; i < css.length; i += 1) {
    const ch = css[i]!;

    if (quote) {
      buffer += ch;
      if (ch === "\\" && i + 1 < css.length) {
        buffer += css[i + 1];
        i += 1;
      } else if (ch === quote) {
        quote = "";
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      buffer += ch;
      continue;
    }

    // Comments pass through whole, so a brace inside one cannot be miscounted.
    if (ch === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      const stop = end === -1 ? css.length : end + 2;
      buffer += css.slice(i, stop);
      i = stop - 1;
      continue;
    }

    /*
     * A statement rather than a block: @import, @charset, @namespace.
     *
     * These end at the semicolon and never open a brace, so without this the
     * buffer keeps growing and swallows the selector of whatever follows —
     * which then looks like part of an at-rule and escapes scoping entirely.
     */
    if (ch === ";" && depth === 0) {
      out += buffer + ";";
      buffer = "";
      continue;
    }

    if (ch === "{") {
      /*
       * Comments and blank lines ahead of a selector belong to the sheet, not
       * to the selector. Left in place they would end up inside it, which is
       * legal but reads as though the comment were part of the match.
       */
      const lead = buffer.match(/^(?:\s|\/\*[\s\S]*?\*\/)*/)?.[0] ?? "";
      const prelude = buffer.slice(lead.length).trim();
      out += lead;
      buffer = "";

      if (prelude.startsWith("@")) {
        const nested = NESTED_AT_RULES.test(prelude) && !FLAT_AT_RULES.test(prelude);
        inside.push(nested);
        out += `${prelude} {`;
      } else if (depth === 0 || inside[inside.length - 1] === true) {
        // A rule, at the top or inside something that wraps rules.
        inside.push(false);
        out += `${splitSelectors(prelude).map((s) => confine(s, wrapper)).join(", ")} {`;
      } else {
        // Inside a font-face or keyframes: a percentage or a name, not a
        // selector.
        inside.push(false);
        out += `${prelude} {`;
      }

      depth += 1;
      continue;
    }

    if (ch === "}") {
      out += buffer + "}";
      buffer = "";
      inside.pop();
      depth -= 1;
      if (depth < 0) return css; // Misread. Hand back what came in.
      continue;
    }

    buffer += ch;
  }

  if (depth !== 0) return css;
  return out + buffer;
}
