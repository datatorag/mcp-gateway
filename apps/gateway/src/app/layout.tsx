import type { Metadata } from "next";
import localFont from "next/font/local";
import { PostHogProvider } from "@/components/posthog-provider";
import { GoogleAds } from "@/components/google-ads";
import { SOCIAL_OPEN_GRAPH, SOCIAL_TWITTER } from "@/lib/social-card";
import "./globals.css";

/* The three typefaces are files in the repository (fonts/, each with its
 * licence), so a build fetches nothing: loading them from Google Fonts at
 * build time failed the build whenever Google Fonts answered with a font
 * URL it could not parse. Latin subset; Inter and Montserrat are variable
 * fonts, so one file covers every weight the site uses. */
const montserrat = localFont({
  variable: "--font-montserrat",
  src: "./fonts/montserrat-latin.woff2",
  weight: "500 800",
});

const inter = localFont({
  variable: "--font-inter",
  src: "./fonts/inter-latin.woff2",
  weight: "400 600",
});

const ptMono = localFont({
  variable: "--font-pt-mono",
  src: "./fonts/pt-mono-latin.woff2",
  weight: "400",
});

/* The link-preview card for every page that sets no `openGraph` or `twitter`
 * of its own (SCRUM-367). A page that sets one replaces this object whole, so
 * it spreads the same constants itself; see lib/social-card.ts. */
export const metadata: Metadata = {
  openGraph: SOCIAL_OPEN_GRAPH,
  twitter: SOCIAL_TWITTER,
  title: "DataToRAG | Connect Your Data to AI",
  description:
    "Link your data sources and let your AI assistant access everything. No engineering required.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${montserrat.variable} ${inter.variable} ${ptMono.variable} h-full antialiased`}
    >
      {/* `overflow-x-clip`, NOT `hidden`. Both stop the document widening, but
          `hidden` makes this element a scroll container, and then every
          `position: sticky` descendant sticks to BODY's scrollport instead of
          the viewport. Body never scrolls — the viewport does — so those
          elements silently stop sticking and travel with the page.

          That shipped: the dashboard rail and the docs sidebar both scrolled
          away, and the docs one went unreported for as long as it existed.
          `globals.css` already makes exactly this distinction on `html`, with
          a comment explaining it, and the same reasoning was never carried
          the one file across to `body`. */}
      <body className="min-h-full flex flex-col font-sans overflow-x-clip">
        {/* Must stay before {children}: effects flush in tree order, so the
            gtag stub exists before page effects (e.g. the dashboard's signup
            conversion) run. */}
        <GoogleAds />
        <PostHogProvider>{children}</PostHogProvider>
      </body>
    </html>
  );
}
