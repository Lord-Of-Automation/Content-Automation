import Link from "next/link";

import { auth } from "@/auth";
import { logout } from "@/app/actions";
import ProfileMenu from "@/components/ProfileMenu";

export default async function TopBar({
  current,
}: {
  current: "runs" | "loop" | "logs" | "accounts" | "keys";
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
          <Link
            href="/runs"
            className={current === "runs" ? "topnav-link is-current" : "topnav-link"}
          >
            Runs
          </Link>
          <Link
            href="/loop"
            className={current === "loop" ? "topnav-link is-current" : "topnav-link"}
          >
            Loop
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
