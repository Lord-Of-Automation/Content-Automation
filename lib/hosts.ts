/**
 * One shape for a hosted site, whoever hosts it. Types and facts only.
 *
 * Deliberately free of imports. The reader that fills these in reaches the
 * credential store, which reaches node:fs and node:crypto, and a component that
 * wanted nothing but the word "Cloudways" was dragging all of that into the
 * browser bundle. Everything here is a type or a plain object, so the table can
 * import it and the server can build against it from lib/hosting.ts.
 *
 * The hosts are not equals and pretending otherwise would be the mistake.
 * Cloudways will clone a site, move its domain, purge its cache and hand back
 * its admin login. Hostinger's hosting API does three things: list, create,
 * delete. So capability travels with the row rather than being assumed, and the
 * controls a host cannot support are absent rather than present and broken.
 */

export type HostId = "cloudways" | "hostinger";

export interface HostAbilities {
  label: string;
  /** Whether the host hands back the site's admin login. */
  credentials: boolean;
  /** Whether the site's primary domain can be changed through the API. */
  changeDomain: boolean;
  clone: boolean;
  /** Whether there is a cache this console can purge. */
  flushCache: boolean;
  remove: boolean;
}

/**
 * What each host can actually do, in one place.
 *
 * Kept as data rather than scattered conditionals, so a third host is a row
 * here and not a hunt through the components.
 */
export const HOSTS: Record<HostId, HostAbilities> = {
  cloudways: {
    label: "Cloudways",
    credentials: true,
    changeDomain: true,
    clone: true,
    flushCache: true,
    remove: true,
  },
  hostinger: {
    label: "Hostinger",
    credentials: false,
    changeDomain: false,
    clone: false,
    flushCache: false,
    remove: true,
  },
};

export interface HostedApp {
  host: HostId;
  /** Unique across hosts: the host, then whatever the host calls this. */
  key: string;
  /** The host's own id for it. A number on Cloudways, the domain on Hostinger. */
  id: string;
  label: string;
  /** The live domain, or "" when nothing is pointed at it. */
  domain: string;
  platform: string;
  platformLabel: string;
  version: string;
  /** An address that answers regardless of domain. Empty when there is none. */
  stagingUrl: string;
  adminPath: string;
  staging: boolean;
  /**
   * Whether the host holds a certificate. "unknown" is honest for a host that
   * does not say, and is not the same as "none".
   */
  ssl: "installed" | "pending" | "none" | "unknown";
  adminUser: string;
  adminPassword: string;
  createdAt: string;
  /** Whether the site is switched on. Hosts that never say are counted on. */
  enabled: boolean;
  /**
   * Where it lives: a server on Cloudways, a hosting account on Hostinger.
   * Both answer "which machine or plan is this on", which is what the filter
   * and the column are for.
   */
  placeId: string;
  placeLabel: string;
  /** The server address, where the host exposes one. */
  placeAddress: string;
  /** Which stored credential this came from, for hosts that allow several. */
  accountIndex: number;
}

/** A place a site can live, for the filter. */
export interface HostPlace {
  id: string;
  label: string;
  host: HostId;
  hostLabel: string;
  apps: number;
}

/** How one host's read went, so a page can say what it is missing. */
export interface HostSource {
  host: HostId;
  label: string;
  ok: boolean;
  count: number;
  note: string;
}

export interface HostedList {
  apps: HostedApp[];
  places: HostPlace[];
  sources: HostSource[];
  /** Which hosts are configured at all, so absence can be told from failure. */
  connected: HostId[];
}
