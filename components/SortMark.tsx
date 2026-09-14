/**
 * The pair of arrows beside a sortable column heading.
 *
 * One shape, used by every table that sorts. It was written twice before this
 * file existed and was about to be written a third time, which is the point at
 * which two tables start disagreeing about what a sorted column looks like.
 *
 * Both arrows are drawn always. A heading that shows an arrow only once it is
 * in use is a heading that gives no sign it can be clicked, and the dimming is
 * what says which way the column is running. Hidden from assistive technology,
 * which reads the heading's own aria-sort instead.
 */
export default function Chevrons({ state }: { state: "none" | "asc" | "desc" }) {
  return (
    <svg className={`sortmark is-${state}`} viewBox="0 0 10 14" aria-hidden>
      <path className="sortmark-up" d="M5 1.5 8.2 5.4H1.8z" />
      <path className="sortmark-down" d="M5 12.5 1.8 8.6h6.4z" />
    </svg>
  );
}
