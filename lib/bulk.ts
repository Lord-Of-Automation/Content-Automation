/**
 * Doing one thing to many domains.
 *
 * The most dangerous screen in this console. A mistake here is not one wrong
 * page, it is four hundred sites off the internet at once, and the damage
 * arrives late enough that nobody notices until the caches expire.
 *
 * Three rules follow from that and are enforced here rather than in the
 * browser, where a different caller could skip them.
 *
 * Every action reports per domain. A bulk that answers "done" hides the nine
 * that failed among the three hundred that worked, and those nine are the whole
 * point of reading the result.
 *
 * Nothing runs unbounded. Work arrives in batches the caller loops over, so a
 * request finishes inside its time limit and a run of hundreds shows progress
 * instead of appearing to hang and being reloaded halfway through.
 *
 * And the destructive things are simply absent. Renewing costs money,
 * transferring is irreversible, deleting is deleting. None of them belong
 * behind a checkbox that also selects three hundred other domains.
 */

import { createZone, findZone } from "./cloudflare";
import { groupById } from "./dnsgroups";
import { setNameservers } from "./dns";
import { credentialFor, type ProviderId } from "./providers";
import { watchZone } from "./cfwatch";

/** What a bulk request may ask for. Read the header before adding to this. */
export type BulkAction =
  | "cloudflare-add"
  | "cloudflare-point"
  | "renew-auto-on"
  | "renew-auto-off";

export interface BulkTarget {
  domain: string;
  provider: ProviderId;
}

export interface BulkOutcome {
  domain: string;
  ok: boolean;
  /** What happened, in words worth showing beside the domain. */
  note: string;
}

/**
 * How many domains one request handles.
 *
 * Small, because each one is several round trips to a registrar and Cloudflare,
 * and a request that runs past its limit is killed with no idea which domains
 * it got to. Twelve leaves room under a sixty second budget even when every one
 * of them is slow.
 */
export const BATCH = 12;

async function setRenewAuto(
  target: BulkTarget,
  on: boolean,
): Promise<BulkOutcome> {
  const credential = await credentialFor(target.provider);

  if (target.provider === "godaddy") {
    const token = credential?.token?.trim();
    if (!token) return { domain: target.domain, ok: false, note: "no GoDaddy token" };

    const response = await fetch(
      `https://api.godaddy.com/v1/domains/${encodeURIComponent(target.domain)}`,
      {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({ renewAuto: on }),
        cache: "no-store",
        signal: AbortSignal.timeout(20_000),
      },
    );
    if (response.ok) {
      return { domain: target.domain, ok: true, note: on ? "auto-renew on" : "auto-renew off" };
    }
    const body = await response.text().catch(() => "");
    return {
      domain: target.domain,
      ok: false,
      note: `GoDaddy answered ${response.status}${body ? `: ${body.slice(0, 120)}` : ""}`,
    };
  }

  const key = credential?.apiKey?.trim();
  if (!key) return { domain: target.domain, ok: false, note: "no Gandi key" };

  const response = await fetch(
    `https://api.gandi.net/v5/domain/domains/${encodeURIComponent(target.domain)}/autorenew`,
    {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({ enabled: on }),
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    },
  );
  if (response.ok) {
    return { domain: target.domain, ok: true, note: on ? "auto-renew on" : "auto-renew off" };
  }
  const body = await response.text().catch(() => "");
  return {
    domain: target.domain,
    ok: false,
    note: `Gandi answered ${response.status}${body ? `: ${body.slice(0, 120)}` : ""}`,
  };
}

async function addToCloudflare(
  target: BulkTarget,
  groupId: string,
  accountId: string,
): Promise<BulkOutcome> {
  // Checked first, because Cloudflare's refusal for an existing zone is a 1061
  // that reads like a failure, and "already there" is a perfectly good outcome
  // to report as such rather than as an error somebody has to interpret.
  const already = await findZone(target.domain);
  if (already) {
    return {
      domain: target.domain,
      ok: true,
      note: `already a zone (${already.zone.status})`,
    };
  }

  const { zone, account } = await createZone(target.domain, accountId || undefined);

  let written = 0;
  const group = groupId ? await groupById(groupId) : null;
  if (group) {
    const { createRecord } = await import("./cloudflare");
    for (const r of group.records) {
      try {
        await createRecord(
          zone.id,
          {
            type: r.type,
            name: r.name === "@" ? target.domain : `${r.name}.${target.domain}`,
            content: r.content === "@" ? target.domain : r.content,
            ttl: r.ttl,
            proxied: r.proxied,
            priority: r.priority,
          },
          account.token,
        );
        written += 1;
      } catch {
        // Cloudflare creates records of its own on a new zone, so a clash here
        // is ordinary. The zone is the thing that had to work.
      }
    }
  }

  await watchZone(target.domain, zone.id);
  return {
    domain: target.domain,
    ok: true,
    note: `added${written ? `, ${written} record(s)` : ""} — now set ${zone.nameServers.join(" and ")}`,
  };
}

/**
 * Points a domain at whatever Cloudflare assigned its zone.
 *
 * Per domain, never one pair for all of them. Cloudflare gives each zone its
 * own pair, so a bulk "set these name servers" would point most of the
 * selection at servers that do not answer for them — every one of those sites
 * would go dark, and it would look like it worked.
 */
async function pointAtCloudflare(target: BulkTarget): Promise<BulkOutcome> {
  const found = await findZone(target.domain);
  if (!found) {
    return {
      domain: target.domain,
      ok: false,
      note: "no Cloudflare zone in any configured account — add it first",
    };
  }
  if (!found.zone.nameServers.length) {
    return { domain: target.domain, ok: false, note: "Cloudflare named no name servers" };
  }

  await setNameservers(target.provider, target.domain, found.zone.nameServers);
  return {
    domain: target.domain,
    ok: true,
    note: `now ${found.zone.nameServers.join(" and ")}`,
  };
}

export async function runBulk(
  action: BulkAction,
  targets: BulkTarget[],
  options: { groupId?: string; accountId?: string } = {},
): Promise<BulkOutcome[]> {
  const out: BulkOutcome[] = [];

  // One at a time on purpose. These are writes against two registrars and
  // Cloudflare, all of which rate limit, and a burst that earns a 429 turns a
  // careful bulk into a partial one nobody can tell apart from a finished one.
  for (const target of targets.slice(0, BATCH)) {
    try {
      if (action === "cloudflare-add") {
        out.push(await addToCloudflare(target, options.groupId ?? "", options.accountId ?? ""));
      } else if (action === "cloudflare-point") {
        out.push(await pointAtCloudflare(target));
      } else {
        out.push(await setRenewAuto(target, action === "renew-auto-on"));
      }
    } catch (error) {
      out.push({
        domain: target.domain,
        ok: false,
        note: error instanceof Error ? error.message.slice(0, 160) : "failed",
      });
    }
  }

  return out;
}
