import TopBar from "@/components/TopBar";
import LoopView from "@/components/LoopView";

export const metadata = { title: "Loop — SEO Automation" };
export const dynamic = "force-dynamic";

export default function LoopPage() {
  return (
    <>
      <TopBar current="loop" />
      <main>
        <LoopView />
      </main>
    </>
  );
}
