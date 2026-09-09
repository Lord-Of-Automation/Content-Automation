import TopBar from "@/components/TopBar";
import WebsitesView from "@/components/WebsitesView";

export const metadata = { title: "AI Websites — SEO Automation" };
export const dynamic = "force-dynamic";

export default function WebsitesPage() {
  return (
    <>
      <TopBar current="websites" />
      <main className="wide">
        <WebsitesView />
      </main>
    </>
  );
}
