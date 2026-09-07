import TopBar from "@/components/TopBar";
import AppsView from "@/components/AppsView";

export const metadata = { title: "Applications — SEO Automation" };
export const dynamic = "force-dynamic";

export default function AppsPage() {
  return (
    <>
      <TopBar current="apps" />
      <main className="wide">
        <AppsView />
      </main>
    </>
  );
}
