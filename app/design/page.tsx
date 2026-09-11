import TopBar from "@/components/TopBar";
import DesignView from "@/components/DesignView";

export const metadata = { title: "Appearance | Content Automation" };
export const dynamic = "force-dynamic";

export default function DesignPage() {
  return (
    <>
      <TopBar current="design" />
      <main>
        <DesignView />
      </main>
    </>
  );
}
