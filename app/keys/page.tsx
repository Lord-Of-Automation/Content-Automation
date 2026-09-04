import TopBar from "@/components/TopBar";
import KeysView from "@/components/KeysView";
import DomainProviders from "@/components/DomainProviders";
import DnsGroups from "@/components/DnsGroups";

export const metadata = { title: "Keys — Content Automation" };
export const dynamic = "force-dynamic";

export default function KeysPage() {
  return (
    <>
      <TopBar current="keys" />
      <main>
        <div className="stack">
          {/* Above the engine's keys because it belongs to a different thing:
              registrar credentials live in the console and the ones below live
              on the engine. Two cards say that; one long list would not. */}
          <DomainProviders />
          <DnsGroups />
          <KeysView />
        </div>
      </main>
    </>
  );
}
