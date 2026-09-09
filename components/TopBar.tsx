import Link from "next/link";

import { auth } from "@/auth";
import { logout } from "@/app/actions";
import NavMenu from "@/components/NavMenu";
import type { Section } from "@/lib/nav";
import ProfileMenu from "@/components/ProfileMenu";

export default async function TopBar({
  current,
}: {
  current: Section;
}) {
  const session = await auth();

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Link className="brand" href="/">
          <span className="brand-dot" />
          <span>SEO Automation</span>
        </Link>

        {/* Only the pages work happens on. Accounts and Keys are settings and
            live in the profile menu, where they stop reading as somewhere to
            go and start reading as something to change. */}
        <nav className="topnav">
          {/* First, and named for what it answers rather than for a place.
              It is the page you land on, so it is also the way back to it. */}
          <Link
            href="/"
            className={current === "home" ? "topnav-link is-current" : "topnav-link"}
          >
            Overview
          </Link>
{/* The two ways of running the engine over a site, under the one word
              for what they are both for. Separately they read as two unrelated
              features; together they read as a choice between doing it now and
              having it done.

              The addresses do not move. Every bookmark, every stored selection
              and every link in the logs points at /runs and /loop. */}
          <NavMenu
            label="SEO"
            active={current === "runs" || current === "loop"}
            items={[
              {
                href: "/runs",
                label: "Optimize",
                note: "run it over a site now, once",
                current: current === "runs",
              },
              {
                href: "/loop",
                label: "Loop",
                note: "have it run again on a schedule",
                current: current === "loop",
              },
            ]}
          />
          {/* Not a link. Domains is two pages now, and a parent that both
              navigates and opens a menu makes you guess which it will do. */}
          <NavMenu
            label="Domains"
            active={current === "domains" || current === "generator"}
            items={[
              {
                href: "/domains",
                label: "My Domains",
                note: "everything the accounts hold",
                current: current === "domains",
              },
              {
                href: "/domains/generate",
                label: "Name generator",
                note: "find one that is free, with its price",
                current: current === "generator",
              },
            ]}
          />
          {/* What this platform wrote, before anything hosts it. Ahead of
              Applications because that is the order the work happens in. */}
          <Link
            href="/websites"
            className={current === "websites" ? "topnav-link is-current" : "topnav-link"}
          >
            Websites
          </Link>
          {/* Between Websites and Performance on purpose: what is registered,
              what is running on it, what it earns. */}
          <Link
            href="/apps"
            className={current === "apps" ? "topnav-link is-current" : "topnav-link"}
          >
            Applications
          </Link>
          <Link
            href="/performance"
            className={current === "performance" ? "topnav-link is-current" : "topnav-link"}
          >
            Performance
          </Link>
          <Link
            href="/logs"
            className={current === "logs" ? "topnav-link is-current" : "topnav-link"}
          >
            Logs
          </Link>
        </nav>

        <div className="spacer" />

        {session?.user ? (
          <ProfileMenu
            name={session.user.name ?? "Signed in"}
            current={current}
            signOut={logout}
          />
        ) : null}
      </div>
    </header>
  );
}
