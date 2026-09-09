import TopBar from "@/components/TopBar";
import Overview from "@/components/Overview";

export const metadata = { title: "Overview — SEO Automation" };
export const dynamic = "force-dynamic";

/**
 * The address people actually type.
 *
 * It used to redirect to Optimize, which meant the console opened on a form
 * for starting work and answered nothing about the work already done. This is
 * that answer instead.
 */
export default function Home() {
  return (
    <>
      <TopBar current="home" />
      <main className="wide">
        <Overview />
      </main>
    </>
  );
}
