import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";

import { auth } from "@/auth";
import Ask from "@/components/Ask";
import PageFrame from "@/components/PageFrame";
import { getPalette, paletteCss } from "@/lib/palette";
import AskClaude from "@/components/AskClaude";
import "./globals.css";

/**
 * Two faces, chosen for what this console actually is.
 *
 * It was set in the system stack, which is free and looks different on every
 * machine somebody opens it on: Segoe UI here, SF there, Roboto elsewhere,
 * each with its own widths, so a table tuned on one is loose or cramped on the
 * next. For a product that is mostly small text in dense rows, that is not a
 * neutral choice, it is a different design per visitor.
 *
 * Inter for the interface. It was drawn for user interfaces at exactly these
 * sizes — a tall x-height, open apertures, and letterforms that stay distinct
 * at twelve pixels, which is where four fifths of this console lives. Its
 * numerals also line up on request, which matters on pages that are columns of
 * money and dates.
 *
 * JetBrains Mono for the things read character by character: application
 * passwords, run ids, tokens, domains and raw HTML. A proportional face is the
 * wrong tool there — the question is not "what does this say" but "is that a
 * zero or a letter O", and this one answers it in the shape of the glyph
 * rather than leaving it to the reader. The system mono stack it replaces was
 * Consolas here and Menlo there, which disagree about exactly that.
 *
 * Both are self-hosted: next/font fetches them at build time, subsets them and
 * serves them from this origin, so there is no request to Google from a
 * viewer's browser and nothing to block. It also measures each face and writes
 * a matching fallback, so the text does not move when the real one arrives.
 */
const sans = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-mono",
  // Only what is used. A monospace here is never bold and never large.
  weight: ["400", "500"],
});

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

  /*
   * The console's own colours, if anybody has changed them.
   *
   * Rendered into the document rather than fetched, because a palette that
   * arrives after the first paint is a palette you watch being applied. This
   * is the same reason the theme script above runs where it does.
   *
   * Empty for an installation nobody has touched, which is the usual case, and
   * then this is one absent style element rather than a copy of the defaults.
   */
  const palette = paletteCss(await getPalette());

  return (
    // The script mutates <html> before React hydrates, which React would
    // otherwise report as a mismatch.
    <html
      lang="en"
      suppressHydrationWarning
      className={`${sans.variable} ${mono.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: noFlashTheme }} />
        {palette ? (
          <style id="ca-palette" dangerouslySetInnerHTML={{ __html: palette }} />
        ) : null}
      </head>
      <body>
        {/* Above everything, because anything may need to ask something. */}
        <Ask>
          {/* Keyed on the path inside, so a page arrives on every visit to it
              and not only on the first. */}
          <PageFrame>{children}</PageFrame>
          {session?.user ? <AskClaude /> : null}
        </Ask>
      </body>
    </html>
  );
}
