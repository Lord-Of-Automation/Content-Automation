import TopBar from "@/components/TopBar";
import CustomView from "@/components/CustomView";
import { currentUser } from "@/lib/actor";
import { may } from "@/lib/permissions";

export const metadata = { title: "Custom | SEO Automation" };
export const dynamic = "force-dynamic";

/**
 * Page types somebody defined, and runs made with them.
 *
 * Checked here as well as in every route behind it. The routes are what keep
 * the money safe; this is what spares somebody a page of controls that would
 * each answer "not allowed" the moment they were used.
 */
export default async function CustomPage() {
  const allowed = await may(await currentUser(), "custom");

  return (
    <>
      <TopBar current="custom" />
      {allowed ? (
        <main className="wide">
          <CustomView />
        </main>
      ) : (
        <main>
          <div className="card">
            <div className="card-body">
              <div className="notice warn">
                You don&rsquo;t have access to Custom page types. Ask an admin to
                grant it in Website Accounts → Edit permissions.
              </div>
            </div>
          </div>
        </main>
      )}
    </>
  );
}
