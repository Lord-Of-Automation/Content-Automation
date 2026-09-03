import TopBar from "@/components/TopBar";
import NameGenerator from "@/components/NameGenerator";

export const metadata = { title: "Name generator — SEO Automation" };
export const dynamic = "force-dynamic";

export default function GeneratePage() {
  return (
    <>
      <TopBar current="generator" />
      <main>
        <NameGenerator />
      </main>
    </>
  );
}
