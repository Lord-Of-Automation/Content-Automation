import TopBar from "@/components/TopBar";
import MailingView from "@/components/MailingView";

export const metadata = { title: "Mailing | SEO Automation" };
export const dynamic = "force-dynamic";

export default function MailingPage() {
  return (
    <>
      <TopBar current="mailing" />
      {/* Wide, like the other pages that are mostly a table. The campaign
          tab is nine columns of publishers and the inbox is subject lines
          that were being cut off with room to spare beside them. */}
      <main className="wide">
        <MailingView />
      </main>
    </>
  );
}
