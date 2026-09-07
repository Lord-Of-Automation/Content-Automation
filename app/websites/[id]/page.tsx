import TopBar from "@/components/TopBar";
import WebsiteEditor from "@/components/WebsiteEditor";

export const metadata = { title: "Edit website — SEO Automation" };
export const dynamic = "force-dynamic";

export default async function WebsitePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <>
      <TopBar current="websites" />
      <main className="wide">
        <WebsiteEditor id={id} />
      </main>
    </>
  );
}
