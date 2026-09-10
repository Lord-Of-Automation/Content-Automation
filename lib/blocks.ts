/**
 * The things a page can be made of, ready to drop in.
 *
 * Everything else in the visual editor changes what is already on the page:
 * restyle it, move it, copy it, throw it away. Adding anything meant typing, or
 * placing a picture, so a page could be pruned and rearranged but never grown.
 * A builder that cannot add a section is a formatter.
 *
 * Every one of these is written in the class vocabulary the site's own
 * stylesheet defines — .hero, .grid, .card, .btn, .cta — and nothing else. That
 * is the whole point of them: a block arrives already wearing the site's
 * colours, typeface and spacing, because it is made of the same parts the
 * generated pages are made of. No block carries a colour, a size or a font of
 * its own, so a site whose accent changes tomorrow changes these with it.
 *
 * The words are placeholders and are meant to be typed over. They are written
 * as real sentences rather than as "Lorem ipsum" or "Heading here", because a
 * block full of filler reads as broken and a block full of plausible copy reads
 * as a draft, and the second is the one people edit rather than delete.
 *
 * No imports: this is read in the browser to draw the picker and the markup
 * goes into a page that is rendered on both sides.
 */

export interface Block {
  key: string;
  name: string;
  /** What it is for, in the picker, under the name. */
  hint: string;
  group: string;
  html: string;
}

/**
 * The groups, in the order they are offered.
 *
 * Roughly the order a page is built in: something to open with, the parts that
 * carry the argument, the shapes that hold facts, and something to ask with at
 * the end.
 */
export const BLOCK_GROUPS = ["Openers", "Text", "Layout", "Facts", "Asks"] as const;

export const BLOCKS: Block[] = [
  // ------------------------------------------------------------- openers
  {
    key: "hero",
    name: "Hero",
    hint: "A heading, a line of promise and two buttons",
    group: "Openers",
    html: `<section class="hero">
  <h2>A short line about what this page is for</h2>
  <p>One or two sentences that say who it is for and why they should keep reading. Written to be replaced.</p>
  <p><a class="btn" href="#">The main thing to do</a> <a class="btn btn-quiet" href="#">Or this instead</a></p>
</section>`,
  },
  {
    key: "lead",
    name: "Opening paragraph",
    hint: "A larger first paragraph, set apart from the rest",
    group: "Openers",
    html: `<p class="lead">The paragraph that decides whether the rest gets read. Say the thing itself rather than what the page is about to say.</p>`,
  },

  // ---------------------------------------------------------------- text
  {
    key: "section",
    name: "Section",
    hint: "A heading and two paragraphs",
    group: "Text",
    html: `<h2>A heading for this section</h2>
<p>The first paragraph, which says the thing the heading promised.</p>
<p>The second, which gives the reason, the number or the example that makes the first believable.</p>`,
  },
  {
    key: "quote",
    name: "Quote",
    hint: "Something somebody said, set off from the page",
    group: "Text",
    html: `<blockquote>
  <p>A sentence worth setting apart, either because somebody said it or because it is the one line to remember.</p>
  <p><small>Who said it, and what they do</small></p>
</blockquote>`,
  },
  {
    key: "list",
    name: "Bulleted list",
    hint: "Points that are parallel rather than sequential",
    group: "Text",
    html: `<ul>
  <li>The first point, in a sentence rather than a fragment.</li>
  <li>The second, the same length and the same shape as the first.</li>
  <li>The third, which is the one people remember.</li>
</ul>`,
  },
  {
    key: "steps",
    name: "Numbered steps",
    hint: "Things done in order",
    group: "Text",
    html: `<h3>How it works</h3>
<ol>
  <li>What happens first, described from the reader's side rather than the system's.</li>
  <li>What happens next, and what it depends on.</li>
  <li>What they end up with.</li>
</ol>`,
  },

  // -------------------------------------------------------------- layout
  {
    key: "cards",
    name: "Card grid",
    hint: "Three boxes that reflow to one column on a phone",
    group: "Layout",
    html: `<ul class="grid">
  <li class="card">
    <h3>The first one</h3>
    <p>A couple of lines about it. The cards size themselves to the longest, so keep them close in length.</p>
  </li>
  <li class="card">
    <h3>The second</h3>
    <p>Same shape, same register. Three reads better than two and much better than five.</p>
  </li>
  <li class="card">
    <h3>The third</h3>
    <p>The one to end on, because it is the one that stays in view longest.</p>
  </li>
</ul>`,
  },
  {
    key: "columns",
    name: "Two columns",
    hint: "Text beside a picture, stacking on a phone",
    group: "Layout",
    html: `<div class="grid">
  <div>
    <h3>A heading for the left</h3>
    <p>The words. On a narrow screen this sits above the picture rather than beside it, which is what you want and is why this is a grid rather than a table.</p>
  </div>
  <figure>
    <img src="" alt="Describe the picture for somebody who cannot see it">
    <figcaption>What the picture shows</figcaption>
  </figure>
</div>`,
  },
  {
    key: "figure",
    name: "Picture with caption",
    hint: "One image and a line underneath",
    group: "Layout",
    html: `<figure>
  <img src="" alt="Describe the picture for somebody who cannot see it">
  <figcaption>What the picture shows, and why it is here</figcaption>
</figure>`,
  },
  {
    key: "rule",
    name: "Divider",
    hint: "A line where the subject changes",
    group: "Layout",
    html: `<hr>`,
  },

  // --------------------------------------------------------------- facts
  {
    key: "table",
    name: "Comparison table",
    hint: "Rows to compare, with a header row",
    group: "Facts",
    html: `<table>
  <thead>
    <tr><th>What</th><th>One</th><th>The other</th></tr>
  </thead>
  <tbody>
    <tr><td>The first thing being compared</td><td>Its answer</td><td>Its answer</td></tr>
    <tr><td>The second</td><td>Its answer</td><td>Its answer</td></tr>
    <tr><td>The third</td><td>Its answer</td><td>Its answer</td></tr>
  </tbody>
</table>`,
  },
  {
    key: "stats",
    name: "Numbers",
    hint: "Three figures worth putting in large type",
    group: "Facts",
    html: `<ul class="grid">
  <li class="card"><h3>1,200</h3><p>What the number counts</p></li>
  <li class="card"><h3>98%</h3><p>What the share is of</p></li>
  <li class="card"><h3>24h</h3><p>What takes that long</p></li>
</ul>`,
  },
  {
    key: "faq",
    name: "Questions and answers",
    hint: "Three questions that open when clicked",
    group: "Facts",
    html: `<h2>Common questions</h2>
<details>
  <summary>The question people actually ask, in their words</summary>
  <p>The answer, in one or two sentences, with the answer itself in the first one.</p>
</details>
<details>
  <summary>The second question</summary>
  <p>The answer.</p>
</details>
<details>
  <summary>The third question</summary>
  <p>The answer.</p>
</details>`,
  },

  // ---------------------------------------------------------------- asks
  {
    key: "cta",
    name: "Call to action",
    hint: "A tinted box at the end that asks for one thing",
    group: "Asks",
    html: `<section class="cta">
  <h2>The one thing to do next</h2>
  <p>A sentence saying what happens after they do it, so it reads as an offer rather than an instruction.</p>
  <p><a class="btn" href="#">Do the thing</a></p>
</section>`,
  },
  {
    key: "buttons",
    name: "Buttons",
    hint: "A strong one and a quiet one, side by side",
    group: "Asks",
    html: `<p><a class="btn" href="#">The main thing</a> <a class="btn btn-quiet" href="#">The lesser one</a></p>`,
  },
  {
    key: "note",
    name: "Small print",
    hint: "A quieter line for a caveat or a disclosure",
    group: "Asks",
    html: `<p><small>The caveat, the disclosure or the date this was last checked.</small></p>`,
  },
];
