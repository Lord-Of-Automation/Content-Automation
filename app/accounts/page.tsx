import TopBar from "@/components/TopBar";
import AccountsView from "@/components/AccountsView";

export const metadata = { title: "Accounts — Content Automation" };
export const dynamic = "force-dynamic";

export default function AccountsPage() {
  return (
    <>
      <TopBar current="accounts" />
      <main>
        <AccountsView />
      </main>
    </>
  );
}
