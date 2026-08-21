import { auth } from "@/auth";
import { logout } from "@/app/actions";
import Console from "@/components/Console";

export const metadata = { title: "Runs — Content Automation" };
export const dynamic = "force-dynamic";

export default async function RunsPage() {
  const session = await auth();

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <span className="brand-dot" />
            <span>
              Content Automation
              <small>n8n workflow console</small>
            </span>
          </div>
          <div className="spacer" />
          {session?.user ? (
            <span className="who">{session.user.email}</span>
          ) : null}
          <form action={logout}>
            <button type="submit" className="btn-ghost">
              Sign out
            </button>
          </form>
        </div>
      </header>

      <main>
        <Console />
      </main>
    </>
  );
}
