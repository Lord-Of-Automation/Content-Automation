/**
 * The FAQ card, for pages built here.
 *
 * A copy of the engine's src/steps/faqcard.ts (SEO-Automation-Backend), less the
 * prompt text, so a built site's questions carry the same card as every page the
 * engine publishes: the styles written on each element, whatever the stored
 * page holds. The engine writes built pages through its own copy already; this
 * one covers pages stored before that, pages edited here, and the two routes
 * that leave the console (the WordPress publisher and the static export).
 *
 * Change the engine's copy and this one together. The WordPress plugin carries a
 * third, held to the engine's by the engine's test/faqparity.test.mjs.
 */

/** The class the plugin's stylesheet keys the marker and the animation on. */
export const FAQ_CARD_CLASS = "cb-faq";

/*
 * The styles, one set per element.
 *
 * Every declaration carries !important. An inline !important is the one thing
 * a theme's stylesheet cannot override, even with an !important of its own,
 * and a theme that styles details, summary, h3 or p (plenty do) otherwise
 * reshapes the card from the inside: a browser check with such a theme showed
 * the box holding while the question inside it grew to three times its size
 * and the dropdown gained a border of its own.
 *
 * The box is on a div rather than on the <details> itself because plugins up
 * to 4.10 let <details> keep no style at all. The <details> now carries a
 * reset, so a theme's own dropdown styling cannot add a second box inside the
 * first; where an older plugin drops it, nothing else changes.
 *
 * border-box keeps the card the width of the text column. Without it a theme
 * that sizes content to the column adds the padding and border on top, and
 * the cards stuck out past the paragraphs on either side.
 *
 * Every colour is translucent grey, so the card suits a light page and a dark
 * one alike.
 */
export const FAQ_BOX_CSS =
  "box-sizing:border-box !important;" +
  "border:1px solid #8080803d !important;border-radius:10px !important;" +
  "background-color:#8080800f !important;padding:16px 20px !important;" +
  "margin-top:0 !important;margin-bottom: 20px !important";
export const FAQ_DETAILS_CSS =
  "margin:0 !important;padding:0 !important;border:0 !important;background:none !important";
export const FAQ_SUMMARY_CSS =
  "cursor:pointer !important;line-height:45px !important;font-size:1rem !important";
export const FAQ_QUESTION_CSS =
  "margin:0 !important;display:inline !important;font-size:1.05rem !important;line-height:1.4 !important";
export const FAQ_ANSWER_CSS = "margin-top:15px !important;margin-bottom:0 !important";
export const FAQ_LIST_CSS = "margin:12px 0 0 !important;padding-left:20px !important";

/** The card's opening tag, exactly as it has to reach the page. */
export const FAQ_CARD_OPEN =
  '<div class="' + FAQ_CARD_CLASS + '" style="' + FAQ_BOX_CSS + '">';

/** One question, built exactly as it has to reach the page. */
function card(question: string, answer: string, open = false): string {
  return (
    FAQ_CARD_OPEN +
    "<details" + (open ? " open" : "") + ' style="' + FAQ_DETAILS_CSS + '">' +
    '<summary style="' + FAQ_SUMMARY_CSS + '">' +
    '<h3 style="' + FAQ_QUESTION_CSS + '">' + question + "</h3></summary>\n" +
    answer +
    "\n</details></div>"
  );
}

/** The whole card, as the prompts show it and as the tests check it. */
export const FAQ_CARD_EXAMPLE =
  card("The question", '<p style="' + FAQ_ANSWER_CSS + '">The answer.</p>') + "\n";

/**
 * A heading that starts an FAQ, in the languages this network publishes in.
 *
 * One list for every place that needs to know: the structured data (faq.ts),
 * styleFaq below, and the plugin, which carries the same pattern.
 */
export const FAQ_HEADING =
  /(faq|frequently\s+asked|questions|preguntas|domande|perguntas|h[aä]ufig|foire\s+aux|sıkça\s+sorulan|よくある|質問|자주\s*묻는|часто\s+задава|vanliga\s+fr[aå]gor|usein\s+kysytyt|nej[cč]ast[ěe]j[sš][ií]|veelgestelde|vragen|pytania|ofte\s+stil|sp[øo]rsm[åa]l|întreb|intreb|gyakran|kérdés|ερωτήσεις|คำถามที่พบบ่อย|أسئلة)/iu;

/*
 * The shapes a question can arrive in.
 *
 * A question is matched whole -- its card, if it has one, its <details>, and
 * whatever sits between the </details> and the card's </div> -- and nothing
 * in the match may cross into another <details> or another div. The first
 * version unwrapped cards with a lazy match that ran on past a card whose
 * </details> was not directly followed by its </div> and stopped at the next
 * card's, which left a stray </div> behind and one card inside another; the
 * rest of the article then rendered inside an FAQ box, or outside the theme's
 * content column.
 *
 * INNER stops at any <details, so only the innermost of nested dropdowns is a
 * question; an outer one is left as it was, around the cards.
 */
const WS = "[ \\t\\n\\r\\f\\v]";
const CARD_OPEN_SRC = `<div\\b[^>]*\\bclass=["'](?:[^"']*\\s)?cb-faq(?:\\s[^"']*)?["'][^>]*>`;
const INNER_SRC = `(?:(?!<details\\b|<\\/details>)[\\s\\S])*`;
const TRAIL_SRC = `(?:(?!<\\/?div\\b|<\\/?details\\b)[\\s\\S])*?`;
const UNIT = new RegExp(
  `(${CARD_OPEN_SRC})\\s*<details\\b([^>]*)>(${INNER_SRC})<\\/details>(${TRAIL_SRC})\\s*<\\/div>` +
    `|<details\\b([^>]*)>(${INNER_SRC})<\\/details>`,
  "gi",
);

/** A Gutenberg details block around a question, its delimiters held to themselves. */
const GUTENBERG_UNIT = new RegExp(
  `<!--\\s*wp:details\\b(?:(?!-->)[\\s\\S])*-->\\s*(<details\\b[^>]*>${INNER_SRC}<\\/details>)\\s*<!--\\s*\\/wp:details\\s*-->`,
  "gi",
);

const BLOCK_COMMENT = /<!--\s*\/?wp:[\s\S]*?-->/g;

/** Where an answer's leading run of inline text ends. */
const ANSWER_BLOCK = /<(?:p|ul|ol|div|table|blockquote|h[1-6]|figure|pre|details|hr|dl|section)\b/i;

/** Trimmed of ASCII whitespace only, as PHP's trim is, so the two agree. */
const trimAscii = (s: string): string => s.replace(new RegExp(`^${WS}+|${WS}+$`, "g"), "");

/** The stretches of a page that belong to an FAQ: each FAQ heading to the next <h2>. */
function faqSections(s: string): Array<[number, number]> {
  const h2s = [...s.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi)];
  const out: Array<[number, number]> = [];
  h2s.forEach((m, i) => {
    if (!FAQ_HEADING.test(m[1]!.replace(/<[^>]+>/g, ""))) return;
    const next = h2s[i + 1];
    out.push([m.index! + m[0].length, next ? next.index! : s.length]);
  });
  return out;
}

/**
 * One question, rebuilt; or null when this dropdown is not a question.
 *
 * A dropdown is a question when it already sits in a card, or when nothing
 * marks it as something else and either its summary holds a heading (the form
 * the prompts ask for) or it sits under an FAQ heading. Built sites use
 * dropdowns for other things too -- a "what is included" toggle with the
 * model's own classes -- and those are left exactly as written.
 */
function rebuild(
  attrs: string,
  inner: string,
  trail: string,
  carded: boolean,
  inFaq: boolean,
): string | null {
  // A game demo can be a dropdown, and it is not a question: its class, or an
  // embedded frame in a dropdown nobody put in a card.
  if (/game-demo-toggle/i.test(attrs)) return null;
  if (!carded && /<iframe\b/i.test(inner)) return null;

  const summary = /<summary\b[^>]*>([\s\S]*?)<\/summary>/i.exec(inner);
  if (!summary) return null;

  if (!carded) {
    const bareAttrs = attrs.replace(/"[^"]*"|'[^']*'/g, '""');
    const cls = (/\bclass=["']([^"']*)["']/i.exec(attrs) ?? [])[1] ?? "";
    const foreign =
      /(?:^|\s)id\s*=/i.test(bareAttrs) ||
      cls.split(/\s+/).filter(Boolean).some((c) => c !== "wp-block-details" && !/faq/i.test(c));
    const headed = /<h[2-4]\b/i.test(summary[1]!);
    if (foreign || !(headed || inFaq)) return null;
  }

  const question = trimAscii(
    summary[1]!
      .replace(BLOCK_COMMENT, "")
      .replace(/<\/?(?:h[1-6]|p|div|span)\b[^>]*>/gi, "")
      .replace(new RegExp(`${WS}+`, "g"), " "),
  );
  if (!question) return null;

  const open = /(?:^|\s)open(?:[\s=]|$)/i.test(attrs.replace(/"[^"]*"|'[^']*'/g, '""'));

  const answer = trimAscii(
    (inner.slice(summary.index + summary[0].length) + (trimAscii(trail) ? "\n" + trimAscii(trail) : ""))
      .replace(BLOCK_COMMENT, "")
      .replace(/<p\b[^>]*>/gi, '<p style="' + FAQ_ANSWER_CSS + '">')
      .replace(/<(ul|ol)\b[^>]*>/gi, '<$1 style="' + FAQ_LIST_CSS + '">')
      // Blank lines become paragraphs under wpautop, unstyled ones, so they
      // are closed up -- except inside <pre>, where they are the content.
      .replace(/(<pre\b[\s\S]*?<\/pre>)|\n{2,}/gi, (_m: string, pre?: string) => pre ?? "\n"),
  );

  // Text before the answer's first block gets its own paragraph, so it has
  // the same spacing below the question as every other answer. Only that
  // run: wrapping a list or a paragraph that follows would nest a block
  // inside a <p>.
  let body = answer;
  if (answer) {
    const at = answer.search(ANSWER_BLOCK);
    const lead = trimAscii(at < 0 ? answer : answer.slice(0, at));
    const rest = at < 0 ? "" : answer.slice(at);
    if (lead) body = '<p style="' + FAQ_ANSWER_CSS + '">' + lead + "</p>" + (rest ? "\n" + rest : "");
  }

  return card(question, body, open);
}

/**
 * Every FAQ question on a page, rebuilt with its styles written on.
 *
 * The styles used to depend on the model copying a long string of inline CSS
 * letter for letter, on every question, in every run -- and on each step after
 * it leaving that markup alone. Any one of those failing published bare
 * dropdowns with nothing to say why, and on pages taken for Elementor ones the
 * prompt did not even ask for the styles. So they are no longer the model's
 * job. Whatever shape a question arrives in (bare, already carded, botched,
 * wrapped in block comments, a heading or plain text in its summary), it
 * leaves here as the one card this engine specifies.
 *
 * Run on the way out of every route that publishes, so no step after it can
 * undo it. Running it twice changes nothing.
 */
export function styleFaq(html: string): { html: string; cards: number } {
  let s = String(html ?? "");
  if (!/<details\b/i.test(s)) return { html: s, cards: 0 };

  // Block delimiters around a question would mark the rebuilt markup as a
  // broken block, which the editor shows as an empty "Details" dropdown.
  s = s.replace(GUTENBERG_UNIT, "$1");

  const sections = faqSections(s);
  const inFaq = (at: number): boolean => sections.some(([from, to]) => at >= from && at < to);

  let out = "";
  let last = 0;
  let cards = 0;
  for (const m of s.matchAll(UNIT)) {
    const carded = m[1] !== undefined;
    const rebuilt = carded
      ? rebuild(m[2]!, m[3]!, m[4]!, true, inFaq(m.index!))
      : rebuild(m[5]!, m[6]!, "", false, inFaq(m.index!));
    if (rebuilt === null) continue;
    out += s.slice(last, m.index!) + rebuilt;
    last = m.index! + m[0].length;
    cards += 1;
  }
  out += s.slice(last);

  return { html: out, cards };
}
