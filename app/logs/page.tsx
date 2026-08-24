import TopBar from "@/components/TopBar";
import LogsView from "@/components/LogsView";
import SpendPanel from "@/components/SpendPanel";

export const metadata = { title: "Logs — Content Automation" };
export const dynamic = "force-dynamic";

export default function LogsPage() {
  return (
    <>
      <TopBar current="logs" />
      <main>
        <div className="stack">
          <SpendPanel />
          <LogsView />
        </div>
      </main>
    </>
  );
}
