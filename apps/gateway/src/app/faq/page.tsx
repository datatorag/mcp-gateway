import type { Metadata } from "next";
import Link from "next/link";
import { Navbar } from "@/components/navbar";
import { FaqSection } from "@/components/faq-section";
import { JsonLd } from "@/components/json-ld";
import { faqPageNode } from "@/lib/site-schema";
import { siteFaqGroups, siteFaqs } from "@/lib/site-faq";

export const metadata: Metadata = {
  title: "FAQ | DataToRAG",
  description:
    "Quick answers on setup, what the gateway can do, the approval gate on writes, Google verification, and how DataToRAG compares to Claude's native connectors.",
  alternates: { canonical: "https://datatorag.com/faq" },
  openGraph: {
    title: "FAQ | DataToRAG",
    description:
      "Quick answers on setup, what the gateway can do, the approval gate on writes, Google verification, and how DataToRAG compares to Claude's native connectors.",
    type: "website",
    url: "https://datatorag.com/faq",
  },
};

/** This page used to hold its answers, its own copy of the FAQ block and its own
 * copy of the JSON-LD escape. It now holds none of the three: the answers are in
 * `site-faq.ts` where one guard can walk them, the block is the component every
 * other surface renders, and the escape lives in `JsonLd`. What is left here is
 * the page: its metadata, its heading, and the order of its groups. */
const groups = siteFaqGroups("/faq");
const faqs = siteFaqs("/faq");

export default function FaqPage() {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="mx-auto max-w-3xl px-6 pt-32 pb-16 sm:pt-36">
        <JsonLd nodes={faqs.length > 0 ? [faqPageNode(faqs)] : []} />

        <h1 className="text-3xl font-semibold tracking-tight">
          Frequently asked questions
        </h1>
        <p className="mt-3 text-muted-foreground">
          Quick answers, with links to the docs and comparisons that go deeper.
          Not covered here?{" "}
          <Link href="/contact" className="underline hover:text-foreground">
            Ask us directly
          </Link>
          .
        </p>

        {groups.map((group) => (
          <FaqSection
            key={group.title}
            title={group.title}
            faqs={group.faqs}
            variant="page"
            className="mt-12"
          />
        ))}
      </main>
    </div>
  );
}
