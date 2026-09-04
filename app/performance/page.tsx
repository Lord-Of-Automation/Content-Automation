import TopBar from "@/components/TopBar";
import PerformanceView from "@/components/PerformanceView";

export const metadata = { title: "Performance — SEO Automation" };
export const dynamic = "force-dynamic";

export default function PerformancePage() {
  return (
    <>
      <TopBar current="performance" />
      <main className="wide">
        <PerformanceView />
      </main>
    </>
  );
}
