/**
 * The mark on a button that re-reads something.
 *
 * It turns while the reading happens. Its own mark rather than its label,
 * because a button that changes word mid-click resizes under the pointer that
 * is still on it.
 */
export default function RefreshIcon({ spinning }: { spinning?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className={spinning ? "spin" : undefined}
      aria-hidden
    >
      <path d="M20 11a8 8 0 1 0-1.6 5.2" />
      <path d="M20 4v7h-7" />
    </svg>
  );
}
