import type { Metadata } from "next";
import Link from "next/link";
import { Navbar } from "@/components/navbar";

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

interface Faq {
  id: string;
  q: string;
  // Answer as an HTML string: the single source rendered on the page AND
  // embedded in the FAQPage JSON-LD, so the two can never drift apart.
  a: string;
}

interface FaqGroup {
  title: string;
  faqs: Faq[];
}

const groups: FaqGroup[] = [
  {
    title: "Getting started",
    faqs: [
      {
        id: "what-is-datatorag",
        q: "What is DataToRAG?",
        a: `One hosted MCP server that connects Claude and other AI clients to your Google Workspace and Atlassian tools, with the write actions the native connectors stop short of. You connect your accounts once, paste one URL into your client, and your AI can read and change things in Gmail, Drive, Docs, Sheets, Slides, Calendar, Contacts, Tasks, Jira and Confluence, with your approval on every write. <a href="/docs/getting-started">Getting started</a> has the two minute version.`,
      },
      {
        id: "how-do-i-set-it-up",
        q: "How do I set it up?",
        a: `Three steps, and the order matters. First sign up and connect at least one Google account. Then copy your MCP config from the dashboard. Then paste it into your client. If you copy the config before connecting an account, the config has nothing to authenticate against and your client will connect to an empty account, so connect first. The <a href="/docs/getting-started">setup guide</a> walks you through it.`,
      },
      {
        id: "which-clients",
        q: "Which AI clients work with it?",
        a: `Any client that supports remote MCP servers. Claude on web, desktop and the phone app all do. Because the server is hosted, your setup follows you: the same connection works from your laptop and your phone. There is a <a href="/docs/getting-started">walkthrough for Claude</a> if you want screenshots.`,
      },
      {
        id: "run-a-server",
        q: "Do I need to run a server or manage OAuth myself?",
        a: `No. That is most of the point. OAuth terminates at our gateway, tokens are stored and refreshed server side, and there is nothing on your machine to break over the weekend. We wrote up <a href="/blog/oauth-refresh-tokens">why OAuth refresh is the hard part</a> after running into it ourselves.`,
      },
    ],
  },
  {
    title: "What it can do",
    faqs: [
      {
        id: "what-can-it-do",
        q: "What can it actually do?",
        a: `Read and search across your connected services, and change things: <a href="/docs/gmail">send and reply to email</a>, <a href="/docs/sheets">edit cells in an existing spreadsheet</a>, <a href="/docs/docs">restructure a doc in place</a>, <a href="/docs/slides">build slides onto a deck</a>, <a href="/docs/calendar">create and update calendar events</a>, manage <a href="/docs/contacts">contacts</a> and <a href="/docs/tasks">tasks</a>, <a href="/docs/jira">file and update Jira issues</a>, and <a href="/docs/confluence">edit Confluence pages</a>. Every change goes through an approval step, so you see what is about to happen before it does. The hub pages list every action: <a href="/docs/google-workspace">Google Workspace</a> and <a href="/docs/atlassian">Atlassian</a>.`,
      },
      {
        id: "why-not-native",
        q: "Claude already connects to Gmail, Calendar and Drive. Why would I need this?",
        a: `For reading, you often don't. The difference is changing things. As of our last check of the native connectors' tool lists (August 7, 2026): the native Gmail connector creates drafts it can neither send nor delete, and now labels and archives, but still has no send, reply or forward. The native Drive connector can create a Slides deck, but the deck arrives empty and nothing in the native surface can put a slide or a word into it, and it cannot edit a file you already have. Native Calendar is genuinely strong, with full create, update and delete, and if calendars on one account are your whole job the native connector is the answer. We publish claim by claim comparisons and re-test them when the connectors change: <a href="/blog/claude-gmail-connector-vs-datatorag-send-reply">Gmail</a>, <a href="/blog/claude-google-drive-vs-datatorag-editing">Drive and Docs</a>, <a href="/blog/claude-google-calendar-vs-datatorag-multi-account">Calendar</a>, and <a href="/blog/claude-google-workspace-mcp-alternatives">the full map of your options</a>.`,
      },
      {
        id: "multiple-accounts",
        q: "Can it work across multiple accounts?",
        a: `Yes. Connect your work account, your personal account, and any others under one endpoint, then say which one you mean in the prompt, or search across all of them at once. Switching accounts does not mean disconnecting and reconnecting. <a href="/blog/one-prompt-two-inboxes-multi-account-mcp">One prompt, two inboxes</a> shows what that looks like in practice.`,
      },
      {
        id: "edit-existing-files",
        q: "Can it edit existing files, not just create new ones?",
        a: `Yes. Cell level edits in Sheets, in place edits in Docs and Slides, replies inside existing email threads. Creating a new file is the easy half; changing the one you already have is the half we built this for.`,
      },
    ],
  },
  {
    title: "Safety",
    faqs: [
      {
        id: "is-write-access-safe",
        q: "Is giving an AI write access safe?",
        a: `Our answer has structure behind it, not confidence. Reads flow, writes wait: before anything that changes your data runs, you see it and approve or deny it. The gate fails closed, so a tool we don't positively recognize as a read is treated as a write and asks first. And there is no shell and no arbitrary code execution anywhere in the gateway, so there is no path for a prompt injection to reach one. The <a href="/blog/reddit-mcp-write-access-research">write access research post</a> walks through the whole design and the skepticism that shaped it.`,
      },
      {
        id: "google-verified",
        q: "Is this Google verified?",
        a: `Yes. DataToRAG passed Google's CASA Tier 2 security assessment, which is what the restricted Workspace scopes require. You will not see an unverified app warning when you connect. Here is <a href="/blog/casa-tier-2-verified">what the verification involved</a> and <a href="/blog/unverified-app-warning-and-casa-tier-2">what that warning means</a> on apps that have not done it.`,
      },
      {
        id: "data-and-tokens",
        q: "What happens to my data and tokens?",
        a: `Your OAuth tokens are stored server side so the connection keeps working, and you can revoke access at any time from your dashboard or from your Google account settings. We do not train on your data. See the <a href="/privacy">privacy policy</a> for the full picture.`,
      },
      {
        id: "how-do-i-disconnect",
        q: "How do I disconnect?",
        a: `From your <a href="/dashboard">dashboard</a>, disconnect the account. From Google's side, you can also revoke DataToRAG's access at myaccount.google.com under third party access. Either one ends our ability to touch that account.`,
      },
    ],
  },
  {
    title: "Account",
    faqs: [
      {
        id: "what-does-it-cost",
        q: "What does it cost?",
        a: `It is free to get started today. Paid plans are coming and the <a href="/pricing">pricing page</a> carries the current state. We would rather the page be honest than exciting.`,
      },
      {
        id: "where-do-i-get-help",
        q: "Where do I get help?",
        a: `The <a href="/contact">contact form</a> reaches us directly, and the <a href="/docs">docs</a> cover setup per service. If something looks broken, tell us what you asked your client to do and what happened instead, and we will chase it.`,
      },
    ],
  },
];

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: groups.flatMap((g) =>
    g.faqs.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    }))
  ),
};

export default function FaqPage() {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="mx-auto max-w-3xl px-6 pt-32 pb-16 sm:pt-36">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
        />

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
          <section key={group.title} className="mt-12">
            <h2 className="text-xl font-semibold">{group.title}</h2>
            <div className="mt-6 space-y-8">
              {group.faqs.map((faq) => (
                <div key={faq.id} id={faq.id} className="scroll-mt-28">
                  <h3 className="group font-medium">
                    {faq.q}{" "}
                    <a
                      href={`#${faq.id}`}
                      className="text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                      aria-label={`Link to: ${faq.q}`}
                    >
                      #
                    </a>
                  </h3>
                  <div
                    className="mt-2 text-sm leading-relaxed text-muted-foreground [&_a]:underline [&_a]:underline-offset-2 [&_a:hover]:text-foreground"
                    dangerouslySetInnerHTML={{ __html: faq.a }}
                  />
                </div>
              ))}
            </div>
          </section>
        ))}
      </main>
    </div>
  );
}
