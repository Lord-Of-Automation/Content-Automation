import TopBar from "@/components/TopBar";
import KeysView from "@/components/KeysView";

export const metadata = { title: "Keys — Content Automation" };
export const dynamic = "force-dynamic";

export default function KeysPage() {
  return (
    <>
      <TopBar current="keys" />
      <main>
        <div className="stack">
          <KeysView />
        </div>
      </main>
    </>
  );
}
