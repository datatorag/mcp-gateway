import { Navbar } from "@/components/navbar";
import type { Metadata } from "next";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Privacy Policy | DataToRAG",
  description: "DataToRAG privacy policy: how we handle your data.",
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
        <p className="mt-2 text-sm text-gray-500">Last updated: August 21, 2026</p>

        <section className="mt-10 space-y-6 text-[15px] leading-relaxed">
          <h2 className="text-xl font-semibold">1. Information We Collect</h2>
          <p>
            When you sign in with Google, we receive your name, email address, and profile
            picture. We store these to identify your account on DataToRAG.
          </p>
          <p>
            If you connect a service such as Google Workspace, we receive an OAuth access token
            scoped to the permissions you approve, and we record which permissions you granted. We
            use the token only to fulfil requests you make. We do not access your data outside an
            explicit tool invocation.
          </p>
          <p>
            <strong>Conversations.</strong> If you use the in-product agent, we store your
            messages, the agent&apos;s replies, and the tool calls and results from that
            conversation. We keep them so you can return to a thread, and they remain until you
            delete the thread or ask us to delete your account. Please do not paste anything into a
            conversation that you would not want stored, including other people&apos;s personal
            details.
          </p>
          <p>
            <strong>Usage records.</strong> For each tool call we record the tool name, the
            connected account it ran against, whether it succeeded, how long it took, and the size
            of the request and response. We do not store the arguments or the response body in
            these records. Error messages are redacted for emails, identifiers and quoted content
            before they are stored.
          </p>
          <p>
            <strong>How you found us.</strong> We record the marketing channel, campaign
            parameters, referring site and entry page associated with your sign-up, so we
            understand which channels bring people to DataToRAG.
          </p>
          <p>
            <strong>Billing.</strong> If you subscribe, Stripe processes your payment and we store
            the customer reference it returns. We never see or store your card details.
          </p>

          <h2 className="text-xl font-semibold">2. How We Use Your Information</h2>
          <p>
            To authenticate you and manage your account; to execute tool calls on your behalf using
            the services you have connected; to generate and manage API keys you create; to operate
            and improve the product, including diagnosing failures; to send transactional email
            about your account.
          </p>
          <p>
            We do not sell your personal information, and we do not use your conversations or your
            connected-service data to train models.
          </p>

          <h2 className="text-xl font-semibold">3. Data Storage and Security</h2>
          <p>
            Your data is stored in encrypted databases hosted in the United States. OAuth tokens
            are stored securely and are never exposed in client-side code. All traffic uses HTTPS.
            Access is scoped to your user account.
          </p>

          <h2 className="text-xl font-semibold">4. Third-Party Services</h2>
          <p>Two different kinds, and the difference matters.</p>
          <p>
            <strong>Services you connect.</strong> Google Workspace and similar integrations are
            used only after you explicitly connect them, and only to carry out requests you make.
          </p>
          <p>
            <strong>Providers we use to run DataToRAG.</strong> These process data without a
            connection step on your part: <strong>Anthropic</strong>, which receives your
            conversation content in order to generate the agent&apos;s replies;{" "}
            <strong>PostHog</strong>, for product analytics tied to your account;{" "}
            <strong>Stripe</strong>, for payments; and our hosting and database providers. We do
            not sell, rent or share your personal information with third parties for marketing
            purposes.
          </p>

          <h2 className="text-xl font-semibold">5. Data Retention</h2>
          <p>We retain your account data for as long as your account is active.</p>
          <p>
            You can disconnect a service at any time from your dashboard, and you can delete an
            individual conversation at any time from the agent.
          </p>
          <p>
            <strong>
              To delete your account, email{" "}
              <a href="mailto:support@datatorag.com" className="text-blue-600 underline">
                support@datatorag.com
              </a>{" "}
              and we will remove your account, your stored tokens, your conversations and your
              personal data.
            </strong>{" "}
            We do not currently offer a self-serve delete button. We aim to complete a deletion
            request within 30 days. Some records may be retained where we are required to keep
            them, for example billing records.
          </p>

          <h2 className="text-xl font-semibold">6. Your Rights</h2>
          <p>
            You may request access to, correction of, or deletion of your personal data at any time
            by contacting{" "}
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
