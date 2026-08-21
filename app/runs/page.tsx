import TopBar from "@/components/TopBar";
import Console from "@/components/Console";

export const metadata = { title: "Runs — Content Automation" };
export const dynamic = "force-dynamic";

export default function RunsPage() {
  return (
    <>
      <TopBar current="runs" />
      <main>
        <Console />
      </main>
    </>
  );
}
