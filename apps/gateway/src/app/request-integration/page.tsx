import type { Metadata } from "next";
import { Navbar } from "@/components/navbar";
import { ContactForm } from "@/components/contact-form";
import { CUSTOM_INTEGRATION } from "@/lib/site-faq";
import { utmFromSearchParams, type ContactSearchParams } from "@/lib/contact-utm";
import { SOCIAL_OPEN_GRAPH, SOCIAL_TWITTER } from "@/lib/social-card";

export const dynamic = "force-dynamic";

const TITLE = "Request an integration | DataToRAG";
const DESCRIPTION = CUSTOM_INTEGRATION.body;

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "https://datatorag.com/request-integration" },
  twitter: SOCIAL_TWITTER,
  openGraph: {
    ...SOCIAL_OPEN_GRAPH,
    title: TITLE,
    description: DESCRIPTION,
    type: "website",
    url: "https://datatorag.com/request-integration",
  },
};

/** The custom integration request form: the contact form's custom variant,
 * writing to the same leads table with its own source. The landing block, the
 * pricing page and the home FAQ all link here. */
export default async function RequestIntegrationRoute({
  searchParams,
}: {
  searchParams: Promise<ContactSearchParams>;
}) {
  const utm = utmFromSearchParams(await searchParams);
  return (
    <>
      <Navbar />
      <main>
        <div className="mx-auto grid max-w-6xl gap-12 px-6 py-16 lg:grid-cols-2 lg:py-24">
          <div>
            <p className="text-sm font-semibold uppercase tracking-widest text-primary">
              Custom integrations
            </p>
            <h1 className="mt-3 font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              {CUSTOM_INTEGRATION.heading}
            </h1>
            <p className="mt-5 text-base leading-relaxed text-muted-foreground">
              {CUSTOM_INTEGRATION.body}
            </p>
          </div>
          <div>
            <ContactForm utm={utm} kind="custom_integration" />
          </div>
        </div>
      </main>
    </>
  );
}
