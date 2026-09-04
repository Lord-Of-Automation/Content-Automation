/**
 * Ordering and labelling for the domains table.
 *
 * Out of the component because these are the rules the table is FOR, and a
 * rule that can only be exercised by rendering a page is a rule nobody checks.
 * Comparators in particular: a sort that is subtly wrong looks like a sort.
 */

export type SortKey =
  | "domain" | "provider" | "status" | "expires" | "renewal" | "price" | "ns"
  | "cloudflare";
export type Direction = "asc" | "desc";

export interface Sortable {
  domain: string;
  status: string;
  daysLeft: number | null;
  renewAuto: boolean;
  nameServers: string[];
  suffix: string;
  /** Micro-units, or null when the registrar would not price this extension. */
  renewalPrice: number | null;
  providerLabel: string;
  cloudflare: string;
}

/**
 * Where a domain actually points.
 *
 * The registrar's default name servers mean the domain is parked: registered
 * and doing nothing. That is the single most useful thing this list can say
 * beyond the expiry date, and it is invisible in GoDaddy's own interface
 * without opening each domain in turn.
 */
export function pointsAt(nameServers: string[]): { label: string; tone: string } {
  if (!nameServers.length) return { label: "unknown", tone: "idle" };
  const hosts = nameServers.map((n) => n.toLowerCase());
  if (hosts.some((h) => /(^|\.)domaincontrol\.com$/.test(h))) {
  return { label: "parked at GoDaddy", tone: "idle" };
  }
  if (hosts.some((h) => /(^|\.)cloudflare\.com$/.test(h))) {
  return { label: "Cloudflare", tone: "ok" };
  }
  if (hosts.some((h) => /(^|\.)vercel-dns\.com$/.test(h))) {
  return { label: "Vercel", tone: "ok" };
  }
  // The registrable part of the first name server, which is the host that
  // actually answers for this domain.
  const parts = hosts[0].split(".").filter(Boolean);
  return { label: parts.slice(-2).join(".") || hosts[0], tone: "ok" };
}

/**
 * GoDaddy's statuses are SHOUTED enum names, and there are over two hundred of
 * them. Only ACTIVE is unremarkable; everything else is matched on the word
 * that carries the meaning.
 *
 * ABUSE and LOCKED_ are here because this account actually holds a
 * LOCKED_ABUSE domain, and neither the word "locked" nor "abuse" appeared in
 * the first version of this list — so the one domain on the account in real
 * trouble rendered in the same grey as an unknown status. Registry suspension
 * and redemption are the other two that turn up.
 */
export function statusTone(status: string): string {
  if (status === "ACTIVE") return "ok";
  if (/EXPIRED|CANCELL?ED|SUSPENDED|ABUSE|LOCKED_|HELD|HOLD|REDEMPTION|INVALID/i.test(status)) {
  return "bad";
  }
  if (/PENDING|TRANSFER|VERIFICATION|RENEWAL|AWAITING/i.test(status)) return "warn";
  return "idle";
}

/**
 * The table's order.
 *
 * Every comparator falls back to the domain name, so equal rows do not shuffle
 * between renders — two ACTIVE domains have to land somewhere, and somewhere
 * stable is the only answer that does not look like a bug.
 */
export function orderDomains<T extends Sortable>(
  rows: T[],
  sortKey: SortKey,
  direction: Direction,
): T[] {
  /**
   * Null sorts last whichever way the column is pointing.
   *
   * A domain with no expiry and a suffix with no price are both "unknown",
   * and flipping the direction should not march them to the top as though
   * they were the extreme case. They are absent, not extreme.
   */
  const nullsLast = (value: number | null, flip: number): number =>
    value === null ? Number.POSITIVE_INFINITY * flip : value;

  const flip = direction === "asc" ? 1 : -1;

  return [...rows].sort((a, b) => {
    switch (sortKey) {
      case "domain":
        return a.domain.localeCompare(b.domain) * flip;
      case "status":
        return (a.status.localeCompare(b.status) || a.domain.localeCompare(b.domain)) * flip;
      case "renewal":
        // Manual first when ascending: it is the one that needs doing.
        return (
          (Number(a.renewAuto) - Number(b.renewAuto) || a.domain.localeCompare(b.domain)) * flip
        );
      case "ns":
        return (
          (pointsAt(a.nameServers).label.localeCompare(pointsAt(b.nameServers).label) ||
            a.domain.localeCompare(b.domain)) * flip
        );
      case "cloudflare": {
        // Ordered by how much attention each state wants rather than
        // alphabetically: not added, then pending, then unknown, then active.
        const rank: Record<string, number> = { none: 0, pending: 1, unknown: 2, active: 3 };
        return (
          ((rank[a.cloudflare] ?? 9) - (rank[b.cloudflare] ?? 9) ||
            a.domain.localeCompare(b.domain)) * flip
        );
      }
      case "provider":
        return (
          (a.providerLabel.localeCompare(b.providerLabel) ||
            a.domain.localeCompare(b.domain)) * flip
        );
      case "price": {
        const pa = a.renewalPrice;
        const pb = b.renewalPrice;
        if (pa === null && pb === null) return a.domain.localeCompare(b.domain);
        return (nullsLast(pa, flip) - nullsLast(pb, flip)) * flip;
      }
      case "expires":
      default: {
        if (a.daysLeft === null && b.daysLeft === null) return a.domain.localeCompare(b.domain);
        return (nullsLast(a.daysLeft, flip) - nullsLast(b.daysLeft, flip)) * flip;
      }
    }
  });
}
