import type { Metadata } from "next";
import { Montserrat, Inter, PT_Mono } from "next/font/google";
import { PostHogProvider } from "@/components/posthog-provider";
import { GoogleAds } from "@/components/google-ads";
import "./globals.css";

const montserrat = Montserrat({
  variable: "--font-montserrat",
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const ptMono = PT_Mono({
  variable: "--font-pt-mono",
  subsets: ["latin"],
  weight: "400",
});

export const metadata: Metadata = {
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
