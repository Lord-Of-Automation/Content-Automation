import Link from "next/link";

import { auth } from "@/auth";
import { logout } from "@/app/actions";
import NavMenu from "@/components/NavMenu";
import ProfileMenu from "@/components/ProfileMenu";

export default async function TopBar({
  current,
}: {
  current:
    | "runs" | "loop" | "logs"
    | "domains" | "generator" | "performance"
    | "accounts" | "keys";
}) {
  const session = await auth();

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <div className="brand">
          <span className="brand-dot" />
          <span>SEO Automation</span>
        </div>

        {/* Only the pages work happens on. Accounts and Keys are settings and
            live in the profile menu, where they stop reading as somewhere to
            go and start reading as something to change. */}
        <nav className="topnav">
          {/* The label says what the page does; the address stays /runs, which
              is what every bookmark and every stored selection points at. */}
          <Link
            href="/runs"
            className={current === "runs" ? "topnav-link is-current" : "topnav-link"}
          >
            Optimize
          </Link>
          <Link
            href="/loop"
            className={current === "loop" ? "topnav-link is-current" : "topnav-link"}
          >
            Loop
          </Link>
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
