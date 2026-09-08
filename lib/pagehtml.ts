/**
 * Small questions about a generated page's markup.
 *
 * This was a whole component once: the page rendered into the console and made
 * editable there, with everything that runs or reaches out stripped out first,
 * because a script in that surface would have arrived carrying the console's
 * cookies. Editing happens inside the preview frame now, which is its own
 * origin and can reach nothing, so the stripping is gone and pages keep their
 * own scripts and styles instead of being quietly flattened by the editor.
 *
 * What is left is the one question the editor still asks.
 */

/**
 * Whether a page carries anything that does something on its own.
 *
 * Used to say so out loud beside the editor, since a page that moves is worth
 * a sentence. Cheap and deliberately rough: a false positive puts a true
 * sentence on screen about a page that mentions a script tag, which costs
 * nothing.
 */
export function hasBehaviour(html: string): boolean {
  return /<script[\s>]|<style[\s>]|\son[a-z]+\s*=/i.test(html);
}
