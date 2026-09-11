import TopBar from "@/components/TopBar";
import MailingView from "@/components/MailingView";

export const metadata = { title: "Mailing | SEO Automation" };
export const dynamic = "force-dynamic";

export default function MailingPage() {
  return (
    <>
      <TopBar current="mailing" />
      <main>
        <MailingView />
      </main>
    </>
  );
}
