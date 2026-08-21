import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Content Automation",
  description: "Run the n8n content automation workflow and watch it work.",
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
