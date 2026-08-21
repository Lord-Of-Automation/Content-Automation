import type { Metadata } from "next";
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

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // The script mutates <html> before React hydrates, which React would
    // otherwise report as a mismatch.
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: noFlashTheme }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
