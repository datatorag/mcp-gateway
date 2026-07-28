import { Navbar } from "@/components/navbar";
import type { Metadata } from "next";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Terms of Service | DataToRAG",
  description: "DataToRAG terms of service.",
  alternates: { canonical: "https://datatorag.com/terms" },
};

export default function TermsPage() {
  return (
    <>
      <Navbar />
      <main className="mx-auto max-w-3xl px-6 py-16 font-sans text-gray-800">
        <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
          Terms of Service
        </h1>
        <p className="mt-2 text-sm text-gray-500">Last updated: March 30, 2026</p>

        <section className="mt-10 space-y-6 text-[15px] leading-relaxed">
          <h2 className="text-xl font-semibold">1. Acceptance of Terms</h2>
          <p>
            By accessing or using DataToRAG ("the Service"), you agree to be bound by these Terms
            of Service. If you do not agree, do not use the Service.
          </p>

          <h2 className="text-xl font-semibold">2. Description of Service</h2>
          <p>
            DataToRAG is an MCP gateway that lets AI assistants access your connected data sources
            through standardized tool calls. We provide the infrastructure; you control which
            services are connected and what data is accessed.
          </p>

          <h2 className="text-xl font-semibold">3. Accounts</h2>
          <p>
            You must sign in with a valid Google account to use the Service. You are responsible
            for maintaining the security of your account and API keys. Notify us immediately if you
            suspect unauthorized access.
          </p>

          <h2 className="text-xl font-semibold">4. Acceptable Use</h2>
          <p>You agree not to:</p>
          <ul className="list-disc space-y-1 pl-6">
            <li>Use the Service for any unlawful purpose</li>
            <li>Attempt to gain unauthorized access to other users' data</li>
            <li>Abuse API rate limits or intentionally degrade the Service</li>
            <li>Reverse-engineer the Service beyond what is permitted by law</li>
          </ul>

          <h2 className="text-xl font-semibold">5. Connected Services</h2>
          <p>
            When you connect third-party services (e.g., Google Workspace), you grant DataToRAG
            permission to access those services on your behalf within the scopes you approve. You
            can revoke access at any time from your dashboard or the third-party provider's
            settings.
          </p>

          <h2 className="text-xl font-semibold">6. API Keys</h2>
          <p>
            API keys you generate are credentials that grant access to your connected services.
            Treat them as secrets. We are not liable for unauthorized use resulting from exposed
            keys.
          </p>

          <h2 className="text-xl font-semibold">7. Availability</h2>
          <p>
            We strive to keep the Service available but do not guarantee uninterrupted access. We
            may perform maintenance or updates that temporarily affect availability.
          </p>

          <h2 className="text-xl font-semibold">8. Limitation of Liability</h2>
          <p>
            The Service is provided "as is" without warranties of any kind. To the fullest extent
            permitted by law, DataToRAG shall not be liable for any indirect, incidental, or
            consequential damages arising from your use of the Service.
          </p>

          <h2 className="text-xl font-semibold">9. Termination</h2>
          <p>
            We may suspend or terminate your access if you violate these terms. You may stop using
            the Service and delete your account at any time.
          </p>

          <h2 className="text-xl font-semibold">10. Changes to Terms</h2>
          <p>
            We may update these terms from time to time. Continued use of the Service after changes
            constitutes acceptance of the new terms.
          </p>

          <h2 className="text-xl font-semibold">11. Contact</h2>
          <p>
            Questions? Reach us at{" "}
            <a href="mailto:support@datatorag.com" className="text-blue-600 underline">
              support@datatorag.com
            </a>
            .
          </p>
        </section>
      </main>
    </>
  );
}
