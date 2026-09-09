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
        <Link className="brand" href="/runs">
          <span className="brand-dot" />
          <span>SEO Automation</span>
        </Link>

        {/* Only the pages work happens on. Accounts and Keys are settings and
            live in the profile menu, where they stop reading as somewhere to
            go and start reading as something to change. */}
        <nav className="topnav">
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
            active={
              current === "domains" || current === "generator" || current === "check"
            }
            items={[
              {
                href: "/domains",
                label: "My Domains",
                note: "everything the accounts hold",
                current: current === "domains",
              },
              {
                href: "/domains/check",
                label: "Availability",
                note: "is a name free, and what does it cost",
                current: current === "check",
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
              Hosting because that is the order the work happens in.

              AI Websites rather than Websites, which is every page on every
              host in this console. These are the ones written here. */}
          <Link
            href="/websites"
            className={current === "websites" ? "topnav-link is-current" : "topnav-link"}
          >
            AI Websites
          </Link>
          {/* Between Websites and Search Console on purpose: what is
              registered, what is running on it, what it earns.

              Hosting rather than Applications, which is Cloudways' word for a
              site and nobody else's. The page lists what is hosted across two
              hosts, and the row for a Hostinger site was never an application
              in anybody's vocabulary. */}
          <Link
            href="/apps"
            className={current === "apps" ? "topnav-link is-current" : "topnav-link"}
          >
            Hosting
          </Link>
          {/* Named for the thing it reads rather than for what the numbers
              are about. Everything in this console is performance; only this
              page is Google's own report of it. */}
          <Link
            href="/performance"
            className={current === "performance" ? "topnav-link is-current" : "topnav-link"}
          >
            Search Console
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
