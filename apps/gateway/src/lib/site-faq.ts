import type { ContentFaq } from "./content-collection";
import { planLimits } from "@/gateway/billing/plans";
import { BUILT_IN_CHECKED_ON, BUILT_IN_HELP_URL } from "./connector-verification";
import { PUBLIC_CLIENTS_TEXT, PUBLIC_CONNECTORS_TEXT, PUBLIC_SERVICES_TEXT } from "./public-integrations";

/** Numbers and dates are IMPORTED, never retyped.
 *
 * An answer is the most quotable surface we publish, so a hand-written copy of
 * a figure is the copy that outlives the change to it. The free allowance comes
 * from the constant the gateway enforces, and the comparison date from the
 * module that names the vendor page it was read from, so neither can say one thing here and
 * another where it is decided. Dollar amounts are deliberately absent for the
 * same reason in reverse: they are hand-written on the pricing page today and
 * live in no constant, so quoting one here would add a fourth copy in the one
 * format a machine repeats verbatim. Link to the page instead. */
const FREE = planLimits("free");
const count = (n: number) => n.toLocaleString("en-US");
/** BOTH allowances, because Free has two and naming only one is a half-truth
 * on a page that lists both. The run cap is the one expected to bind first: a
 * single agent run normally makes several tool calls. Read from the plan table
 * the pricing cards and enforcement both read, never retyped. */
const FREE_CALLS = count(FREE.monthlyIncluded);
const FREE_RUNS = count(FREE.agentRuns);
const PRO = planLimits("pro");
const PRO_CALLS = count(PRO.monthlyIncluded);
const PRO_RUNS = count(PRO.agentRuns);

/** Authored FAQs for the pages that are TSX rather than markdown.
 *
 * WHY A MODULE AND NOT FRONTMATTER. `/faq`, the home page and `/pricing` have no
 * markdown file to carry a `faqs:` block, so their answers have to live in code.
 * They live HERE rather than beside each page, because the value of the docs and
 * blog rollout is that one guard walks one list: a page holding its own array
 * is a source the registry cannot see, which is precisely the failure SCRUM-213
 * exists to remove.
 *
 * `a` IS MARKDOWN, same as every other surface, and that is the migration. The
 * `/faq` page used to hold HTML strings with hand-written anchors, rendered by
 * its own copy of the block and its own copy of the JSON-LD escape. HTML in an
 * answer reaches `acceptedAnswer.text` as tag soup unless somebody remembers to
 * strip it, and a hand-written anchor can disagree with the heading it labels.
 * One authored string, two derived projections, anchors derived from `q`.
 *
 * Groups are presentation. A long single-purpose page reads better in sections,
 * but the FAQPage node and the guard both flatten them, because the grouping is
 * not part of the claim.
 */

export interface SiteFaqGroup {
  title: string;
  faqs: ContentFaq[];
}

export interface SiteFaqPage {
  /** The route as it appears in the URL, e.g. `/faq`. Also what the guard names
   * in a failure, so it points at a page rather than at a module. */
  route: string;
  groups: SiteFaqGroup[];
}

/** Custom integrations on request: the landing block, the pricing line and
 * the home FAQ entry share this copy and the form's address, so they cannot
 * drift. No price, no timeline, no promise a request is built: "on request"
 * is the whole claim. */
const INTEGRATION_OFFER = "We build integrations for your own services on request.";
const INTEGRATION_ASK = "Tell us the service and what you want your agent to do with it";

/** The one answer to "Can I self-host DataToRAG?".
 *
 * Three pages used to answer it three ways: a hero line offered self-hosting
 * as a preference, a pricing answer said "you can self-host it", and the blog
 * said there is no packaged guide. This sentence points at the README's
 * self-hosting section, which exists, and every
 * answer and page line that mentions running the gateway yourself uses it, so
 * the next change to it is one edit. The license half is the repository's
 * LICENSE file (MIT); re-read that file before changing the word. */
export const SELF_HOSTING =
  "The DataToRAG gateway's code is MIT-licensed and can be self-hosted. It is not one command, and the README's self-hosting section lists the steps: you supply a Postgres database, your own Google OAuth clients (and Google's verification for the restricted Gmail and Drive scopes), and an encryption key for the stored tokens.";

/** What DataToRAG is next to Claude's built-in Google connectors, in the
 * opening of /hosted-google-workspace-mcp and in every answer that compares
 * the two.
 *
 * OURS FIRST, and every clause of it is on our own docs pages: the clients
 * (lib/mcp-clients.ts), several Google accounts (docs/multiple-accounts, the
 * `account` argument), Contacts and Tasks (docs/contacts, docs/tasks), and
 * Jira, Confluence, and Notion (docs/getting-started, "Available connectors").
 * `ours` is `oursWhat` then `oursAdds`, so an answer that already said what
 * DataToRAG is can use the second sentence alone.
 *
 * THEIRS is only what Anthropic's own help page said on the day in
 * BUILT_IN_CHECKED_ON, and only what it says the connectors DO. It states no
 * limit on purpose. That page does not say how many Google accounts a person
 * can connect, and does not mention Contacts or Tasks either way, so neither
 * is claimed here: a page being silent is not the vendor stating a limit.
 * The page and the date live in lib/connector-verification.ts with the rule.
 * Re-read BUILT_IN_HELP_URL before changing a word of `theirs`, and move the
 * date only when you have. */
export { BUILT_IN_CHECKED_ON, BUILT_IN_HELP_URL };
const OURS_WHAT = `DataToRAG is one MCP endpoint that your agent uses from ${PUBLIC_CLIENTS_TEXT}, or any other MCP client.`;
const OURS_ADDS =
  "It reaches several Google accounts through one connection, includes Contacts and Tasks, and puts Jira, Confluence, and Notion on the same endpoint.";
export const BUILT_IN_DIFFERENCE = {
  question: "What is the difference between DataToRAG and Claude's built-in Google connectors?",
  ours: `${OURS_WHAT} ${OURS_ADDS}`,
  oursAdds: OURS_ADDS,
  theirsLead: `Claude's built-in Google connectors are a feature of Claude itself. As of ${BUILT_IN_CHECKED_ON}, `,
  theirsSource: "Anthropic's help page",
  theirsRest:
    " lists them for Gmail, Google Calendar, Google Drive, Docs, Sheets, and Slides, and says they send email and create and edit Docs, Sheets, and Slides files.",
  close: "If your work stays in Google and in Claude, the built-in connectors may be all you need.",
} as const;

/** The dated sentence about the built-in connectors, as an answer writes it:
 * the same three parts the landing page renders around its own anchor. */
const THEIRS = `${BUILT_IN_DIFFERENCE.theirsLead}[${BUILT_IN_DIFFERENCE.theirsSource}](${BUILT_IN_HELP_URL})${BUILT_IN_DIFFERENCE.theirsRest}`;

const BUILT_IN_DIFFERENCE_FAQ: ContentFaq = {
  q: BUILT_IN_DIFFERENCE.question,
  a: `${BUILT_IN_DIFFERENCE.ours} ${THEIRS} ${BUILT_IN_DIFFERENCE.close}`,
};

export const CUSTOM_INTEGRATION = {
  heading: "Need a service that is not listed?",
  body: `${INTEGRATION_OFFER} ${INTEGRATION_ASK}.`,
  /** The pricing page's one line: the body's first sentence. */
  short: INTEGRATION_OFFER,
  action: "Request an integration",
  href: "/request-integration",
  /** The form's address from each surface that links to it, so a request
   * says where it came from (`?from=`, read by `lib/contact-utm.ts`). */
  from: {
    home: "/request-integration?from=home",
    pricing: "/request-integration?from=pricing",
    faq: "/request-integration?from=faq",
  },
} as const;

/** Moving files, as the home page's section, the hosted landing page's block,
 * and the home FAQ answer say it. One copy, so the three cannot drift.
 *
 * EVERY CLAUSE IS ON content/docs/file-references.md, and that page is the
 * thing to re-read before changing a word here:
 * - from your computer: "Uploading a file from your computer" (the upload
 *   reference goes to drive_upload_file, jira_add_attachment,
 *   notion_attach_file, or an email's attachments; the link takes one file,
 *   once, of at most 25 MB);
 * - from an email: the gmail_message and gmail_attachment references;
 * - from Drive: the drive_file and drive_export references, and "Attaching
 *   files to an email";
 * - to your computer: "Saving a file to your computer" (a link works once).
 * The receipt sentence is "What the receipt says" and the email response
 * there: each of those tools answers with the file's name, size, and SHA-256.
 * gmail_save_attachment_to_drive answers with Drive's metadata and no hash,
 * so no job here is described by that tool.
 *
 * It says nothing about any other product, on purpose: what somebody else's
 * tools do with a file is not ours to state here. One number only, the upload
 * link's, which site-faq.test.ts holds to the docs page; every other limit is
 * behind the link. */
export const FILE_MOVES = {
  eyebrow: "Files",
  heading: "Move files between your tools",
  standfirst:
    "Ask your agent, and DataToRAG carries a file from where it is to where you need it, without its content passing through the conversation.",
  jobs: [
    {
      id: "from-your-computer",
      title: "From your computer",
      body: "Send a file through an upload link that works once, and your agent puts it in Drive, on a Jira issue, on a Notion page, or in an email.",
      from: ["computer"],
      to: ["drive", "jira", "notion", "gmail"],
    },
    {
      id: "from-an-email",
      title: "From an email",
      body: "Put an email's attachment, or the whole email as its original file, on a Jira issue, on a Notion page, or in Drive.",
      from: ["gmail"],
      to: ["jira", "notion", "drive"],
    },
    {
      id: "from-drive",
      title: "From Drive",
      body: "Attach a Drive file to an email, a Jira issue, or a Notion page. A Google Doc, Sheet, or Slides deck can go as an exported file, such as a PDF.",
      from: ["drive"],
      to: ["gmail", "jira", "notion"],
    },
    {
      id: "to-your-computer",
      title: "To your computer",
      body: "Save a whole email, one attachment, or a Drive file to your computer through a download link that works once.",
      from: ["gmail", "drive"],
      to: ["computer"],
    },
  ],
  receipt:
    "A file moved by an upload, an attachment, or a download link comes back on a receipt with its name, its size, and its SHA-256, so you can check what went where.",
  limits: "An upload link takes a file of up to 25 MB, and each destination has its own limit.",
  docsHref: "/docs/file-references",
  docsLabel: "How moving files works",
} as const;

export const SITE_FAQ_PAGES: SiteFaqPage[] = [
  {
    route: "/faq",
    groups: [
      {
        title: "Getting started",
        faqs: [
          {
            q: "What is DataToRAG?",
            a: `One hosted MCP server that connects Claude and other AI clients to your ${PUBLIC_CONNECTORS_TEXT} tools. You connect your accounts once, paste one URL into your client, and your agent can read and change things in ${PUBLIC_SERVICES_TEXT}, with your approval on every write. [Getting started](/docs/getting-started) has the two minute version.`,
          },
          {
            q: "How do I set it up?",
            a: "Two steps, in either order. Add the DataToRAG URL to your client and sign in when it asks. Connect the accounts you want it to use, on the Connections page in the dashboard or by asking your agent to connect one, which answers with a link. Your agent needs at least one connected account before its first call does anything. The [setup guide](/docs/getting-started) walks you through it.",
          },
          {
            q: "Which AI clients work with it?",
            a: "Any client that supports remote MCP servers. Claude on web, desktop and the phone app all do. Because the server is hosted, your setup follows you: the same connection works from your laptop and your phone. There is a [walkthrough for Claude](/docs/getting-started) if you want screenshots.",
          },
          {
            q: "Do I need to run a server or manage OAuth myself?",
            a: "No. That is most of the point. OAuth terminates at our gateway, tokens are stored and refreshed server side, and there is nothing on your machine to break over the weekend. We wrote up [why OAuth refresh is the hard part](/blog/oauth-refresh-tokens) after running into it ourselves.",
          },
        ],
      },
      {
        title: "What it can do",
        faqs: [
          {
            q: "What can it actually do?",
            a: "Read and search across your connected services, and change things: [send and reply to email](/docs/gmail), [edit cells in an existing spreadsheet](/docs/sheets), [restructure a doc in place](/docs/docs), [build slides onto a deck](/docs/slides), [create and update calendar events](/docs/calendar), manage [contacts](/docs/contacts) and [tasks](/docs/tasks), [file and update Jira issues](/docs/jira), [edit Confluence pages](/docs/confluence), and [write Notion pages and database rows](/docs/notion). Every change goes through an approval step, so you see what is about to happen before it does. The hub pages list every action: [Google Workspace](/docs/google-workspace), [Atlassian](/docs/atlassian) and [Notion](/docs/notion).",
          },
          BUILT_IN_DIFFERENCE_FAQ,
          {
            q: "Claude already connects to Gmail, Calendar and Drive. Why would I need this?",
            // Rewritten on November 25, 2026. This answer listed limits of
            // the built-in connectors from our own enumeration (a beta label,
            // an empty Slides deck, one Google account at a time), and
            // Anthropic's help page said otherwise or said nothing. It now
            // leads with what DataToRAG adds and says about the built-in
            // connectors only the shared, dated sentence. The comparison
            // posts are linked by subject, with no claim in the link text.
            a: `For what DataToRAG adds to them. ${BUILT_IN_DIFFERENCE.oursAdds} It also works from any MCP client, not only Claude. ${THEIRS} ${BUILT_IN_DIFFERENCE.close} Our comparison posts each carry the date they were checked: [Gmail](/blog/claude-gmail-connector-vs-datatorag-send-reply), [Drive and Docs](/blog/claude-google-drive-vs-datatorag-editing), [Calendar](/blog/claude-google-calendar-vs-datatorag-multi-account), and [the full map of your options](/blog/claude-google-workspace-mcp-alternatives).`,
          },
          {
            q: "Can it work across multiple accounts?",
            a: "Yes. Connect your work account, your personal account, and any others under one endpoint, then say which one you mean in the prompt, or search across all of them at once. Switching accounts does not mean disconnecting and reconnecting. [One prompt, two inboxes](/blog/one-prompt-two-inboxes-multi-account-mcp) shows what that looks like in practice.",
          },
          {
            q: "Can it edit existing files, not just create new ones?",
            a: "Yes. DataToRAG makes cell level edits in Sheets, in place edits in Docs and Slides, and replies inside existing email threads, and each change waits for your approval.",
          },
        ],
      },
      {
        title: "Safety",
        faqs: [
          {
            q: "Is giving an AI write access safe?",
            a: "Our answer has structure behind it, not confidence. Reads flow, writes wait: before anything that changes your data runs, you see it and approve or deny it. The gate fails closed, so a tool we don't positively recognize as a read is treated as a write and asks first. And there is no shell and no arbitrary code execution anywhere in the gateway, so there is no path for a prompt injection to reach one. The [write access research post](/blog/reddit-mcp-write-access-research) walks through the whole design and the skepticism that shaped it.",
          },
          {
            q: "Is this Google verified?",
            a: "Yes. DataToRAG passed Google's CASA Tier 2 security assessment, which is what the restricted Workspace scopes require. You will not see an unverified app warning when you connect. Here is [what the verification involved](/blog/casa-tier-2-verified) and [what that warning means](/blog/unverified-app-warning-and-casa-tier-2) on apps that have not done it.",
          },
          {
            q: "What happens to my data and tokens?",
            a: "Your OAuth tokens are stored server side so the connection keeps working, and you can revoke access at any time from your dashboard or from your Google account settings. We do not train on your data. See the [privacy policy](/privacy) for the full picture.",
          },
          {
            q: "How do I disconnect?",
            a: "From your [Connections page](/dashboard/connections), disconnect the account. From Google's side, you can also revoke DataToRAG's access at myaccount.google.com under third party access. Either one ends our ability to touch that account.",
          },
        ],
      },
      {
        title: "Account",
        faqs: [
          {
            q: "What does it cost?",
            a: `Nothing to start, and no card: the free tier includes ${FREE_CALLS} tool calls and ${FREE_RUNS} agent runs a month. Pro raises that to ${PRO_CALLS} tool calls and ${PRO_RUNS} agent runs a month, and Enterprise is a quote for committed volume. Every tier gets every connector, and the [pricing page](/pricing) has the current prices.`,
          },
          {
            q: "Where do I get help?",
            a: "The [contact form](/contact) reaches us directly, and the [docs](/docs) cover setup per service. If something looks broken, tell us what you asked your client to do and what happened instead, and we will chase it.",
          },
        ],
      },
    ],
  },
  {
    route: "/",
    groups: [
      {
        title: "Questions people ask first",
        faqs: [
          {
            q: "Can my AI agent actually edit my files, or only read them?",
            // Rewritten on November 25, 2026. This answer said the built-in
            // Docs and Sheets connectors were in beta and listed things
            // "nothing built in" does. Anthropic's help page has no beta
            // label and is silent on most of that list, and a page being
            // silent is not a limit. Our half says what our own docs prove
            // (docs/sheets, docs/docs, docs/slides, docs/file-references);
            // their half is the shared, dated sentence.
            a: `Edit them, with your approval on every write. DataToRAG changes cells in a sheet you already have, writes into an existing doc, builds slides onto a deck, runs a query over a sheet, and moves an email's attachment into Drive or onto a Jira issue. ${BUILT_IN_DIFFERENCE.oursAdds} It gives the same tools to any MCP client, your own application included. ${THEIRS} ${BUILT_IN_DIFFERENCE.close}`,
          },
          {
            q: "Which AI clients can connect to it?",
            a: `Any client that speaks MCP. ${PUBLIC_CLIENTS_TEXT} have step-by-step setup in the dashboard, and any other MCP client, your own application included, connects the same way, with one URL covering every service you have connected and OAuth sign-in handling the rest. The gateway is hosted, so the same connection works from another machine without setting anything up again.`,
          },
          {
            q: "Can my agent attach a file from my computer?",
            a: `Yes. Ask your agent for an upload link, send the file through it, and DataToRAG puts the file in Drive, on a Jira issue, on a Notion page, or in an email. ${FILE_MOVES.limits} ${FILE_MOVES.receipt} [Moving files between services](${FILE_MOVES.docsHref}) has the limits and the steps.`,
          },
          {
            q: "What does DataToRAG connect to?",
            a: `${PUBLIC_CONNECTORS_TEXT}. ${PUBLIC_SERVICES_TEXT}, all behind one endpoint: connect once and every tool is available to your agent rather than one integration at a time. The [docs](/docs) list every action per service.`,
          },
          {
            q: "Can you add a service that is not listed?",
            a: `Yes, on request: we build integrations for your own services. ${INTEGRATION_ASK} on the [request form](${CUSTOM_INTEGRATION.from.faq}).`,
          },
          {
            q: "What stops it doing something I did not want?",
            a: "An approval step in front of every write. Reads flow, and anything that changes your data is shown to you and waits. The gate fails closed, so a tool DataToRAG does not positively recognize as a read is treated as a write and asks first, and there is no shell or arbitrary code execution anywhere in the gateway for a prompt injection to reach.",
          },
          {
            q: "Is it safe to connect a hosted gateway to my Google account?",
            a: `It is the right question to ask of anything asking for Workspace access. DataToRAG has been Google-verified since June 2026 and passed the CASA Tier 2 security assessment that the restricted Workspace scopes require, so you will not see an unverified app warning when you connect. You can also read exactly what the gateway does, because its code is public. ${SELF_HOSTING} Here is [what the verification involved](/blog/casa-tier-2-verified).`,
          },
          {
            q: "What does it cost to start?",
            a: `Nothing, and no card. The free tier includes ${FREE_CALLS} tool calls and ${FREE_RUNS} agent runs a month with every connector available, and paid plans buy a bigger allowance rather than unlocking features. [Pricing](/pricing) has the current numbers.`,
          },
        ],
      },
    ],
  },
  {
    route: "/pricing",
    groups: [
      {
        title: "Questions about the plans",
        faqs: [
          {
            q: "What happens when I use up the free allowance?",
            a: `The next tool call is refused, not billed. The free cap is checked before a call runs, and the refusal tells you the allowance resets at the start of your next period and that Pro is available from your dashboard. Free carries two allowances, ${FREE_CALLS} tool calls and ${FREE_RUNS} agent runs a month, and the runs are usually what you reach first, because one agent run normally makes several tool calls. There is no card on file either way, so nothing arrives as a bill.`,
          },
          {
            q: "Which tool calls count against the allowance?",
            a: "The ones that reached the API. A successful call counts, and so does a request that came back with a legitimate no, because it ran. Server errors are not metered: if the DataToRAG gateway is down, a plugin crashes, or an upstream API returns a 5xx, that call is not counted against you. Your [usage dashboard](/docs/usage) shows what ran.",
          },
          {
            q: "I pay for Pro, so why are my calls counting on the free plan?",
            a: "You most likely have two DataToRAG accounts. DataToRAG makes one account per sign-in email, and each AI app asks you to sign in to DataToRAG once, when you add the connector. Pick a different Google login in one app and that app is on a second account, usually a free one, and its calls count there. Nothing errors until the free limit. To fix it, remove the DataToRAG connector in that app, add it back, and sign in with the email that holds your plan. Disconnecting the Google account under the other login removes it only for that login, so the one you keep is not affected. The [Usage docs](/docs/usage) have the steps for each app.",
          },
          {
            q: "Is any connector or feature behind the paid tier?",
            a: "No. Every tier gets every connector and every tool, several accounts side by side, and the approval gate on writes. What Pro and Enterprise buy is a larger monthly allowance, not a larger feature set, which is why there is no per-connector upsell anywhere on this page.",
          },
          {
            q: "Can I run the gateway myself instead?",
            a: `Yes, with work on your side. ${SELF_HOSTING} Enterprise is a committed-volume rate either way, hosted by us or run by you.`,
          },
          {
            q: "How do I get an Enterprise quote?",
            a: "Tell us what you are running and a person answers. The [contact form](/contact?from=pricing) reaches us directly, Enterprise includes everything in Pro, and the rate is negotiated against committed volume rather than published as a tier.",
          },
        ],
      },
    ],
  },
  {
    route: "/hosted-google-workspace-mcp",
    groups: [
      {
        title: "Questions about the hosted endpoint",
        faqs: [
          BUILT_IN_DIFFERENCE_FAQ,
          {
            q: "Do I need a Google Cloud project to use a hosted Google Workspace MCP?",
            a: "Not for this one. You add one endpoint and sign in with Google, and there is no Cloud project, no OAuth client of your own and no per-product endpoint to wire up. Google's own official MCP servers are the other route and they do ask for that setup: a Cloud project, sixteen service enablements and your own OAuth client when we checked on 24 August 2026.",
          },
          {
            q: "Which Google products does the one endpoint cover?",
            a: "Gmail, Drive, Sheets, Docs, Slides, Calendar, Contacts and Tasks, with Jira, Confluence and Notion on the same endpoint. The gap worth naming is Google Chat: DataToRAG has no Chat tools, and Google has an official Chat MCP if that is the job.",
          },
          {
            q: "Can it change a file, or only create new ones?",
            a: `Change them. DataToRAG updates cells in an existing sheet, writes into an existing doc, and puts content on the slides of an existing deck, and each write asks you first. Editing is not what separates it from Claude's built-in connectors. ${THEIRS} What DataToRAG adds is elsewhere. ${BUILT_IN_DIFFERENCE.oursAdds}`,
          },
          {
            q: "When are Claude's native connectors the better answer?",
            a: `When you do not need what DataToRAG adds. ${BUILT_IN_DIFFERENCE.oursAdds} ${THEIRS} The same page says the Gmail, Google Calendar, and Google Drive connectors are available for all users on Claude and Claude Desktop. ${BUILT_IN_DIFFERENCE.close}`,
          },
          {
            q: "What if having a third party in the path is not acceptable?",
            a: `Then running it yourself is the answer, and it takes work. ${SELF_HOSTING}`,
          },
        ],
      },
    ],
  },
];

/** The groups one route publishes, or none. A route with no entry renders no FAQ
 * block and emits no FAQPage node, rather than an empty one. */
export function siteFaqGroups(route: string): SiteFaqGroup[] {
  return SITE_FAQ_PAGES.find((p) => p.route === route)?.groups ?? [];
}

/** One route's answers, flattened out of their groups. What the FAQPage node
 * takes, and what the guard walks. */
export function siteFaqs(route: string): ContentFaq[] {
  return siteFaqGroups(route).flatMap((g) => g.faqs);
}

/** Every landing page that publishes FAQs, in the `{ slug, faqs }` shape the
 * guard registry reads every other source in. The guard is then identical for
 * markdown collections and for this module, which is the property that let the
 * rules be written before this file existed. */
export function siteFaqPages(): { slug: string; faqs: ContentFaq[] }[] {
  return SITE_FAQ_PAGES.map((p) => ({
    slug: p.route,
    faqs: p.groups.flatMap((g) => g.faqs),
  }));
}
