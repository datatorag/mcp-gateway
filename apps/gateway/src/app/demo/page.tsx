import type { Metadata } from "next";
import { ContactPage } from "@/components/contact-page";
import {
  utmFromSearchParams,
  type ContactSearchParams,
} from "@/lib/contact-utm";
import { SOCIAL_OPEN_GRAPH, SOCIAL_TWITTER } from "@/lib/social-card";

export const dynamic = "force-dynamic";

// /demo predates /contact and stays live: it's the recorded landing page in
// our analytics history and the destination on ad assets, so it must keep
// serving (no redirect). /contact is the canonical URL for search.
export const metadata: Metadata = {
  title: "Get in touch | DataToRAG",
  description:
    "Tell us what you're trying to build with AI. We'll figure out whether DataToRAG fits, and if it does, the shortest path to a working setup against your data.",
  alternates: { canonical: "https://datatorag.com/contact" },
  twitter: SOCIAL_TWITTER,
  openGraph: {
    ...SOCIAL_OPEN_GRAPH,
    title: "Get in touch | DataToRAG",
    description:
      "Tell us what you're trying to build with AI. We'll figure out whether DataToRAG fits, and if it does, the shortest path to a working setup against your data.",
    type: "website",
    url: "https://datatorag.com/contact",
  },
};

export default async function DemoPage({
  searchParams,
}: {
  searchParams: Promise<ContactSearchParams>;
}) {
  return <ContactPage utm={utmFromSearchParams(await searchParams)} />;
}
