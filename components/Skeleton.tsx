/**
 * The shape of what is coming, while it comes.
 *
 * Every list here used to wait behind a centred grey word. Domains and
 * Applications each reach several external APIs before they can draw a single
 * row, so that word sat alone for seconds and then the page jumped a screen
 * downwards as the rows landed under it.
 *
 * A skeleton fixes both halves of that. It says how much is coming rather than
 * merely that something is, and because it occupies the height the real rows
 * will occupy, nothing moves when they arrive. The wait is the same length and
 * feels shorter, which is the entire trick.
 *
 * These are deliberately dumb: no state, no timers, no measuring. A skeleton
 * that is cleverer than the thing it stands in for is a second layout to keep
 * in step with the first.
 */

/**
 * Bar widths, as a fixed cycle rather than random numbers.
 *
 * Uneven widths read as text; a column of identical bars reads as a progress
 * meter. The cycle is fixed because these render on the server too, and a
 * random width would differ between the two renders and be reported as a
 * hydration mismatch.
 */
const WIDTHS = [82, 61, 74, 48, 90, 57, 68, 79, 52, 86, 64, 71];

function width(seed: number): string {
  return `${WIDTHS[seed % WIDTHS.length]}%`;
}

/** One ghost bar. `w` overrides the cycle where a column has a known shape. */
export function SkeletonBar({ seed = 0, w }: { seed?: number; w?: string }) {
  return <span className="skel" style={{ width: w ?? width(seed) }} />;
}

/**
 * A table mid-load.
 *
 * The header is drawn rather than left out, because it is what sets the column
 * widths: without it the ghost rows would size themselves and then the real
 * table would resize on arrival, which is the jump this exists to prevent.
 */
export function SkeletonTable({
  columns,
  rows = 8,
}: {
  columns: number;
  rows?: number;
}) {
  const cols = Array.from({ length: columns }, (_, i) => i);

  return (
    <table className="logs logs-middle skel-table" aria-hidden>
      <thead>
        <tr>
          {cols.map((c) => (
            <th key={c}>
              {/* Shorter and paler than the rows below it, so the table still
                  reads as having a header rather than eleven identical bars. */}
              <SkeletonBar w="42%" />
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {Array.from({ length: rows }, (_, r) => (
          <tr key={r}>
            {cols.map((c) => (
              <td key={c}>
                <SkeletonBar seed={r * columns + c} />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * The headline figures, as tiles without their strip.
 *
 * Separate from the strip because the overview wraps the same tiles in a card
 * of its own, and a skeleton that brought its own wrapper would put a second
 * one inside the first.
 */
export function SkeletonStatCells({ count = 4 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <div className="domain-stat" key={i}>
          {/* Two bars, tall then short, because the real tile is a figure over
              a caption. One bar would stand two thirds as tall and the page
              would settle downwards as the numbers arrived. */}
          <span className="skel skel-tall" style={{ width: i ? "46%" : "62%" }} />
          <span className="skel skel-small" style={{ width: i ? "70%" : "84%" }} />
        </div>
      ))}
    </>
  );
}

/** The row of headline figures some pages carry above their table. */
export function SkeletonStats({ count = 4 }: { count?: number }) {
  return (
    <div className="domain-stats" aria-hidden>
      <SkeletonStatCells count={count} />
    </div>
  );
}

/** The search-and-filter strip that sits between the figures and the table. */
export function SkeletonBarRow() {
  return (
    <div className="skel-row" aria-hidden>
      <span className="skel skel-box" style={{ width: "220px" }} />
      <span className="skel skel-box" style={{ width: "260px" }} />
    </div>
  );
}

/** Stacked panels, for the pages whose rows are cards rather than table rows. */
export function SkeletonCards({ count = 3 }: { count?: number }) {
  return (
    <div className="skel-cards" aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <div className="skel-card" key={i}>
          <div className="skel-card-head">
            <SkeletonBar w="38%" />
            <SkeletonBar w="12%" />
          </div>
          <SkeletonBar seed={i * 3} />
          <SkeletonBar seed={i * 3 + 1} />
        </div>
      ))}
    </div>
  );
}

/**
 * Plain lines, for a short list with no columns to preserve.
 *
 * Used where the real thing is a list of one short item per row, and a table
 * skeleton would promise more structure than arrives.
 */
export function SkeletonLines({ count = 4 }: { count?: number }) {
  return (
    <div className="skel-lines" aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <SkeletonBar key={i} seed={i * 5} />
      ))}
    </div>
  );
}

/**
 * A list whose every row is a name over a smaller line, which is the shape of
 * all three panels on the overview. Padded and divided like the real rows, so
 * the panel is already the right height when the rows replace it.
 */
export function SkeletonStack({ count = 4 }: { count?: number }) {
  return (
    <div className="skel-stack" aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <div className="skel-stack-row" key={i}>
          <SkeletonBar seed={i * 4} w={`${[46, 34, 52, 40][i % 4]}%`} />
          <SkeletonBar seed={i * 4 + 1} w={`${[62, 74, 55, 68][i % 4]}%`} />
        </div>
      ))}
    </div>
  );
}
