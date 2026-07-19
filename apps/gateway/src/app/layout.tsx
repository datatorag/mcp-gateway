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
      <body className="min-h-full flex flex-col font-sans overflow-x-hidden">
        {/* Must stay before {children}: effects flush in tree order, so the
            gtag stub exists before page effects (e.g. the dashboard's signup
            conversion) run. */}
        <GoogleAds />
        <PostHogProvider>{children}</PostHogProvider>
      </body>
    </html>
  );
}
