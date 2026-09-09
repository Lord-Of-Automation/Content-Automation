import TopBar from "@/components/TopBar";
import DomainCheck from "@/components/DomainCheck";

export const metadata = { title: "Availability — SEO Automation" };
export const dynamic = "force-dynamic";

export default function CheckPage() {
  return (
    <>
      <TopBar current="check" />
      <main>
        <DomainCheck />
      </main>
    </>
  );
}
