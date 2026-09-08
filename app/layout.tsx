import type { Metadata } from "next";

import { auth } from "@/auth";
import AskClaude from "@/components/AskClaude";
import "./globals.css";

export const metadata: Metadata = {
  title: "Content Automation",
  description: "Run the n8n content automation workflow and watch it work.",
  robots: { index: false, follow: false },
};

// Runs before first paint so a saved choice is applied without a flash of the
// wrong theme. Deliberately not a React effect: an effect runs after paint.
const noFlashTheme = `
try {
  var t = localStorage.getItem('ca:theme');
  if (t === 'light' || t === 'dark') {
    document.documentElement.setAttribute('data-theme', t);
  }
} catch (e) {}
`;

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  /*
   * Only for somebody who is signed in.
   *
   * Here rather than on each page so it follows you between them and keeps the
   * conversation, which is most of the point of a panel rather than a page. The
   * sign-in screen is the one place it would be both useless and odd.
   */
  const session = await auth();

  return (
    // The script mutates <html> before React hydrates, which React would
    // otherwise report as a mismatch.
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: noFlashTheme }} />
      </head>
      <body>
        {children}
        {session?.user ? <AskClaude /> : null}
      </body>
    </html>
  );
}
