import Link from "next/link";

import { auth } from "@/auth";
import { logout } from "@/app/actions";
import ThemeToggle from "@/components/ThemeToggle";

/** Matches the one on the Accounts page, so a user reads the same either side. */
function UserIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

export default async function TopBar({
  current,
}: {
  current: "runs" | "logs" | "accounts";
}) {
  const session = await auth();

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <div className="brand">
          <span className="brand-dot" />
          <span>
            Content Automation
            <small>n8n workflow console</small>
          </span>
        </div>

        <nav className="topnav">
          <Link
            href="/runs"
            className={current === "runs" ? "topnav-link is-current" : "topnav-link"}
          >
            Runs
          </Link>
          <Link
            href="/logs"
            className={current === "logs" ? "topnav-link is-current" : "topnav-link"}
          >
            Logs
          </Link>
          <Link
            href="/accounts"
            className={
              current === "accounts" ? "topnav-link is-current" : "topnav-link"
            }
          >
            Accounts
          </Link>
        </nav>

        <div className="spacer" />
        {session?.user ? (
          <span className="who">
            <UserIcon />
            <span className="who-name">{session.user.name}</span>
          </span>
        ) : null}
        <ThemeToggle />
        <form action={logout}>
          <button type="submit" className="btn btn-danger">
            Sign out
          </button>
        </form>
      </div>
    </header>
  );
}
