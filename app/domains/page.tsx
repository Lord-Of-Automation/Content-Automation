import TopBar from "@/components/TopBar";
import DomainsView from "@/components/DomainsView";

export const metadata = { title: "Domains — SEO Automation" };
export const dynamic = "force-dynamic";

export default function DomainsPage() {
  return (
    <>
      <TopBar current="domains" />
      <main>
        <DomainsView />
      </main>
    </>
  );
}
