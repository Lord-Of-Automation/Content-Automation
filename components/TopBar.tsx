import Link from "next/link";

import { auth } from "@/auth";
import { logout } from "@/app/actions";
import ThemeToggle from "@/components/ThemeToggle";

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
        {session?.user ? <span className="who">{session.user.name}</span> : null}
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
