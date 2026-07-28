import { Navbar } from "@/components/navbar";
import type { Metadata } from "next";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Privacy Policy | DataToRAG",
  description: "DataToRAG privacy policy — how we handle your data.",
  alternates: { canonical: "https://datatorag.com/privacy" },
};

export default function PrivacyPage() {
  return (
    <>
      <Navbar />
      <main className="mx-auto max-w-3xl px-6 py-16 font-sans text-gray-800">
        <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
          Privacy Policy
        </h1>
        <p className="mt-2 text-sm text-gray-500">Last updated: March 30, 2026</p>

        <section className="mt-10 space-y-6 text-[15px] leading-relaxed">
          <h2 className="text-xl font-semibold">1. Information We Collect</h2>
          <p>
            When you sign in with Google, we receive your name, email address, and profile picture.
            We store these solely to identify your account on DataToRAG.
          </p>
          <p>
            If you connect a service (e.g., Google Workspace), we receive an OAuth access token
            scoped to the permissions you approve. We use this token only to fulfill requests you
            make through the MCP protocol. We do not access your data outside of explicit tool
            invocations.
          </p>

          <h2 className="text-xl font-semibold">2. How We Use Your Information</h2>
          <ul className="list-disc space-y-1 pl-6">
            <li>Authenticate your identity and manage your account</li>
            <li>Execute MCP tool calls on your behalf using connected service tokens</li>
            <li>Generate API keys that you create from the dashboard</li>
            <li>Send transactional emails related to your account (if applicable)</li>
          </ul>

          <h2 className="text-xl font-semibold">3. Data Storage and Security</h2>
          <p>
            Your data is stored in encrypted databases. OAuth tokens are stored securely and are
            never exposed in client-side code. We use HTTPS for all communications.
          </p>

          <h2 className="text-xl font-semibold">4. Third-Party Services</h2>
          <p>
            We integrate with third-party services (Google Workspace, etc.) only when you
            explicitly connect them. We do not sell, rent, or share your personal information with
            third parties for marketing purposes.
          </p>

          <h2 className="text-xl font-semibold">5. Data Retention</h2>
          <p>
            We retain your account data for as long as your account is active. You can disconnect
            services or delete your account at any time. Upon deletion, we remove your stored
            tokens and personal data.
          </p>

          <h2 className="text-xl font-semibold">6. Your Rights</h2>
          <p>
            You may request access to, correction of, or deletion of your personal data at any
            time by contacting us at{" "}
            <a href="mailto:support@datatorag.com" className="text-blue-600 underline">
              support@datatorag.com
            </a>
            .
          </p>

          <h2 className="text-xl font-semibold">7. Changes to This Policy</h2>
          <p>
            We may update this policy from time to time. We will notify you of significant changes
            by posting the new policy on this page with an updated date.
          </p>

          <h2 className="text-xl font-semibold">8. Contact</h2>
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
