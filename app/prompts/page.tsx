import TopBar from "@/components/TopBar";
import PromptsView from "@/components/PromptsView";

export const metadata = { title: "Prompts | Content Automation" };
export const dynamic = "force-dynamic";

export default function PromptsPage() {
  return (
    <>
      <TopBar current="prompts" />
      <main>
        <PromptsView />
      </main>
    </>
  );
}
