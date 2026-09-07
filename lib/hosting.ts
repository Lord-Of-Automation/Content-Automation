/**
 * Reading every host into one list.
 *
 * The page is called Applications, not Cloudways. Once a second host holds part
 * of the estate, a list showing one of them answers none of the questions worth
 * asking — what is running, what has no domain on it, where does example.com
 * actually live — because the answer is always "of the ones on this tab".
 *
 * The shapes and the table of what each host can do live in ./hosts, which has
 * no imports at all. This file reaches the credential store and so reaches
 * node:fs and node:crypto; a component that wants nothing but the word
 * "Cloudways" must not drag that into the browser through a shared import.
 */

import { HOSTS, type HostId, type HostPlace, type HostSource, type HostedApp, type HostedList } from "./hosts";

export * from "./hosts";

export async function listAllApplications(): Promise<HostedList> {
  const [cloudways, hostinger] = await Promise.all([
    readCloudways(),
    readHostinger(),
  ]);

  const apps = [...cloudways.apps, ...hostinger.apps].sort((a, b) =>
    (a.domain || a.label).localeCompare(b.domain || b.label),
  );

  return {
    apps,
    places: [...cloudways.places, ...hostinger.places],
    sources: [cloudways.source, hostinger.source],
    connected: [
      ...(cloudways.configured ? (["cloudways"] as HostId[]) : []),
      ...(hostinger.configured ? (["hostinger"] as HostId[]) : []),
    ],
  };
}

interface OneHost {
  apps: HostedApp[];
  places: HostPlace[];
  source: HostSource;
  /** Whether a credential exists at all, as opposed to one that failed. */
  configured: boolean;
}

async function readCloudways(): Promise<OneHost> {
  const { listApplications, CloudwaysConfigError } = await import("./cloudways");

  try {
    const estate = await listApplications();

    return {
      configured: true,
      apps: estate.apps.map((a) => ({
        host: "cloudways" as const,
        key: `cloudways:${a.id}`,
        id: a.id,
        label: a.label,
        domain: a.domain,
        platform: a.platform,
        platformLabel: a.platformLabel,
        version: a.version,
        stagingUrl: a.stagingUrl,
        adminPath: a.adminPath,
        staging: a.staging,
        ssl: a.ssl,
        adminUser: a.adminUser,
        adminPassword: a.adminPassword,
        createdAt: a.createdAt,
        enabled: true,
        placeId: `cloudways:${a.serverId}`,
        placeLabel: a.serverLabel,
        placeAddress: a.serverIp,
        accountIndex: 0,
      })),
      places: estate.servers.map((s) => ({
        id: `cloudways:${s.id}`,
        label: s.label,
        host: "cloudways" as const,
        hostLabel: HOSTS.cloudways.label,
        apps: s.apps,
      })),
      source: {
        host: "cloudways",
        label: HOSTS.cloudways.label,
        ok: true,
        count: estate.apps.length,
        note: "",
      },
    };
  } catch (error) {
    // A missing token is "not connected", not "broken". The page says nothing
    // about a host nobody configured, and says plenty about one that failed.
    const configured = !(error instanceof CloudwaysConfigError && /No Cloudways token/i.test(error.message));
    return {
      configured,
      apps: [],
      places: [],
      source: {
        host: "cloudways",
        label: HOSTS.cloudways.label,
        ok: false,
        count: 0,
        note: error instanceof Error ? error.message : "Could not be read.",
      },
    };
  }
}

async function readHostinger(): Promise<OneHost> {
  const { listHostingerSites } = await import("./hostinger");

  try {
    const estate = await listHostingerSites();
    if (!estate.accounts.length) {
      return {
        configured: false,
        apps: [],
        places: [],
        source: {
          host: "hostinger",
          label: HOSTS.hostinger.label,
          ok: true,
          count: 0,
          note: "",
        },
      };
    }

    const apps: HostedApp[] = estate.sites.map((s) => {
      const account = estate.accounts[s.tokenIndex];
      const wordpress = /wordpress/i.test(s.platform);
      return {
        host: "hostinger" as const,
        key: `hostinger:${s.domain}`,
        id: s.domain,
        label: s.domain,
        domain: s.domain,
        platform: s.platform,
        // Hostinger says "other" for anything it does not recognise, which
        // is most of a static site. Capitalised rather than renamed: it is
        // their word for it and inventing a better one would be a guess.
        platformLabel: wordpress
          ? "WordPress"
          : s.platform
            ? s.platform[0].toUpperCase() + s.platform.slice(1)
            : "Unknown",
        version: "",
        // Hostinger gives no address of its own: the domain is how a site is
        // reached, including the hostingersite.com one it starts with.
        stagingUrl: "",
        adminPath: wordpress ? "/wp-admin/" : "",
        staging: false,
        // Hostinger issues certificates and does not report them here. Saying
        // "none" would put a warning on every row of a perfectly secure estate.
        ssl: "unknown" as const,
        adminUser: "",
        adminPassword: "",
        createdAt: s.createdAt.replace("T", " ").replace("Z", ""),
        enabled: s.enabled,
        placeId: `hostinger:${account?.id ?? s.tokenIndex}`,
        placeLabel: account?.label ?? "Hostinger",
        placeAddress: "",
        accountIndex: s.tokenIndex,
      };
    });

    const failed = estate.accounts.filter((a) => !a.ok);
    return {
      configured: true,
      apps,
      places: estate.accounts.map((a) => ({
        id: `hostinger:${a.id}`,
        label: a.label,
        host: "hostinger" as const,
        hostLabel: HOSTS.hostinger.label,
        apps: a.sites,
      })),
      source: {
        host: "hostinger",
        label: HOSTS.hostinger.label,
        ok: !failed.length,
        count: apps.length,
        note: failed.length
          ? `${failed.length} of ${estate.accounts.length} accounts could not be read: ${failed[0].note}`
          : "",
      },
    };
  } catch (error) {
    return {
      configured: true,
      apps: [],
      places: [],
      source: {
        host: "hostinger",
        label: HOSTS.hostinger.label,
        ok: false,
        count: 0,
        note: error instanceof Error ? error.message : "Could not be read.",
      },
    };
  }
}
