/**
 * One shape for a domain, whoever it is registered with.
 *
 * The page is called Domains, not GoDaddy. Once a second registrar holds part
 * of the estate, a list that shows one of them answers none of the questions
 * worth asking — what expires next, what is on manual renewal, what the year
 * costs — because the answer is always "of the ones you can see".
 *
 * Prices belong on the domain rather than in a table keyed by extension,
 * because the same extension costs different money at different registrars.
 * GoDaddy will not price .fr at all; Gandi renews one for $31.98. A shared
 * lookup would have to pick one of those and be wrong for half the list.
 */

import type { ProviderId } from "./providers";

export interface Domain {
  provider: ProviderId;
  /** "GoDaddy", "Gandi". Shown in the table, so it lives with the row. */
  providerLabel: string;
  domain: string;
  /** Everything after the first dot: "com", "co.uk". */
  suffix: string;
  status: string;
  /** ISO date, or null for a domain with no expiry recorded. */
  expires: string | null;
  /** Days until expiry, negative once past. Null when there is no expiry. */
  daysLeft: number | null;
  renewAuto: boolean;
  nameServers: string[];
  /**
   * A year's renewal in micro-units, as both registrars quote it: 22990000 is
   * 22.99. Null when the registrar would not price this extension.
   */
  renewalPrice: number | null;
  currency: string;
  /**
   * Where this domain stands with Cloudflare.
   *
   * "active" is a zone this token can see that Cloudflare has verified.
   * "pending" is a zone created but not yet picked up, which nearly always
   * means its name servers have not been changed at the registrar yet.
   * "none" means no zone this token can see — which is not the same as no zone
   * at all, since a token only sees the accounts it was issued for.
   */
  cloudflare: "active" | "pending" | "none" | "unknown";
  /** The zone id, when there is one, so the DNS panel can go straight to it. */
  cloudflareZoneId: string | null;
}

/** How one registrar's read went, so a page can say what it is missing. */
export interface DomainSource {
  provider: ProviderId;
  label: string;
  ok: boolean;
  count: number;
  /** Why it failed, or how it was read. Shown as-is. */
  note: string;
  /** Extensions this registrar would not price. */
  unpriced: string[];
}

export interface DomainList {
  domains: Domain[];
  sources: DomainSource[];
  /** How the Cloudflare read went, so "none" can be told from "not asked". */
  cloudflare: { ok: boolean; zones: number; note: string };
}

/** "shop.example.co.uk" -> "co.uk". Everything after the first label. */
export function suffixOf(domain: string): string {
  const at = domain.indexOf(".");
  return at < 0 ? "" : domain.slice(at + 1).toLowerCase();
}

export function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return null;
  return Math.round((at - Date.now()) / 86_400_000);
}

/**
 * Soonest to expire first, because that is the only column anyone opens this
 * page in a hurry to read. Domains with no expiry sort to the bottom rather
 * than the top, where a missing date would otherwise look like an emergency.
 */
export function byExpiry(domains: Domain[]): Domain[] {
  return [...domains].sort((a, b) => {
    if (a.daysLeft === null && b.daysLeft === null) return a.domain.localeCompare(b.domain);
    if (a.daysLeft === null) return 1;
    if (b.daysLeft === null) return -1;
    return a.daysLeft - b.daysLeft || a.domain.localeCompare(b.domain);
  });
}

/**
 * Every registrar this console can read, merged into one list.
 *
 * Read in parallel and merged, because the page's questions are about the
 * estate rather than about an account: what expires next, what is on manual
 * renewal, what the year costs. Split by registrar those all become "of the
 * ones on this tab", which is not the question anybody has.
 *
 * One registrar failing never empties the page. Its row in `sources` says what
 * happened and the rest of the list is still correct — the alternative is a
 * lapsed Gandi key hiding four hundred GoDaddy domains.
 */
export async function listAllDomains(): Promise<DomainList> {
  const { listGoDaddyDomains } = await import("./godaddy");
  const { listGandiDomains } = await import("./gandi");

  const readers: Array<{
    provider: ProviderId;
    label: string;
    run: () => Promise<{ domains: Domain[]; source: DomainSource }>;
  }> = [
    { provider: "godaddy", label: "GoDaddy", run: listGoDaddyDomains },
    { provider: "gandi", label: "Gandi", run: listGandiDomains },
  ];

  const results = await Promise.all(
    readers.map(async (reader) => {
      try {
        return await reader.run();
      } catch (error) {
        return {
          domains: [] as Domain[],
          source: {
            provider: reader.provider,
            label: reader.label,
            ok: false,
            count: 0,
            note: error instanceof Error ? error.message : "Could not be read.",
            unpriced: [] as string[],
          },
        };
      }
    }),
  );

  const domains = byExpiry(results.flatMap((r) => r.domains));

  /**
   * Cloudflare's view, folded in.
   *
   * One listing for the whole estate rather than a call per domain: four
   * hundred lookups to answer a column would make the page unusable, and the
   * zone list is a handful of paged requests however many domains there are.
   *
   * A failure here leaves every row "unknown" rather than "none". Those mean
   * opposite things — one is "Cloudflare does not have it", the other is "we
   * could not ask" — and showing a red dot for the second would have people
   * adding zones that already exist.
   */
  let cloudflare = { ok: false, zones: 0, note: "no Cloudflare token is set" };
  try {
    const { listZones } = await import("./cloudflare");
    const zones = await listZones();
    cloudflare = { ok: true, zones: zones.size, note: "" };

    for (const d of domains) {
      const zone = zones.get(d.domain.toLowerCase());
      if (!zone) {
        d.cloudflare = "none";
        continue;
      }
      d.cloudflareZoneId = zone.id;
      d.cloudflare = zone.status === "active" ? "active" : "pending";
    }
  } catch (error) {
    cloudflare = {
      ok: false,
      zones: 0,
      note: error instanceof Error ? error.message : "Cloudflare could not be read.",
    };
    for (const d of domains) d.cloudflare = "unknown";
  }

  return { domains, sources: results.map((r) => r.source), cloudflare };
}
