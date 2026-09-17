import type { ContentFaq } from "./content-collection";
import { FREE_MONTHLY_CAP } from "@/gateway/billing/plans";
import { VERIFIED_ON } from "./connector-verification";

/** Numbers and dates are IMPORTED, never retyped.
 *
 * An answer is the most quotable surface we publish, so a hand-written copy of
 * a figure is the copy that outlives the change to it. The free allowance comes
 * from the constant the gateway enforces, and the comparison date from the
 * table that was actually retested, so neither can say one thing here and
 * another where it is decided. Dollar amounts are deliberately absent for the
 * same reason in reverse: they are hand-written on the pricing page today and
 * live in no constant, so quoting one here would add a fourth copy in the one
 * format a machine repeats verbatim. Link to the page instead. */
const FREE_CALLS = FREE_MONTHLY_CAP.toLocaleString("en-US");

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

export const SITE_FAQ_PAGES: SiteFaqPage[] = [
  {
    route: "/faq",
    groups: [
      {
        title: "Getting started",
        faqs: [
          {
            q: "What is DataToRAG?",
            a: "One hosted MCP server that connects Claude and other AI clients to your Google Workspace and Atlassian tools, with the write actions the native connectors stopped short of when we last checked their tool lists on August 7, 2026. You connect your accounts once, paste one URL into your client, and your AI can read and change things in Gmail, Drive, Docs, Sheets, Slides, Calendar, Contacts, Tasks, Jira and Confluence, with your approval on every write. [Getting started](/docs/getting-started) has the two minute version.",
          },
          {
            q: "How do I set it up?",
            a: "Three steps, and the order matters. First sign up and connect at least one Google account. Then copy your MCP config from the dashboard. Then paste it into your client. If you copy the config before connecting an account, the config has nothing to authenticate against and your client will connect to an empty account, so connect first. The [setup guide](/docs/getting-started) walks you through it.",
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
            a: "Read and search across your connected services, and change things: [send and reply to email](/docs/gmail), [edit cells in an existing spreadsheet](/docs/sheets), [restructure a doc in place](/docs/docs), [build slides onto a deck](/docs/slides), [create and update calendar events](/docs/calendar), manage [contacts](/docs/contacts) and [tasks](/docs/tasks), [file and update Jira issues](/docs/jira), and [edit Confluence pages](/docs/confluence). Every change goes through an approval step, so you see what is about to happen before it does. The hub pages list every action: [Google Workspace](/docs/google-workspace) and [Atlassian](/docs/atlassian).",
          },
          {
            q: "Claude already connects to Gmail, Calendar and Drive. Why would I need this?",
            a: "For reading, you often don't. The difference is changing things. As of our last check of the native connectors' tool lists (August 7, 2026): the native Gmail connector creates drafts it can neither send nor delete, and now labels and archives, but still has no send, reply or forward. The native Drive connector can create a Slides deck, but the deck arrives empty and nothing in the native surface can put a slide or a word into it, and it cannot edit a file you already have. Native Calendar is genuinely strong, with full create, update and delete, and if calendars on one account are your whole job the native connector is the answer. We publish claim by claim comparisons and re-test them when the connectors change: [Gmail](/blog/claude-gmail-connector-vs-datatorag-send-reply), [Drive and Docs](/blog/claude-google-drive-vs-datatorag-editing), [Calendar](/blog/claude-google-calendar-vs-datatorag-multi-account), and [the full map of your options](/blog/claude-google-workspace-mcp-alternatives).",
          },
          {
            q: "Can it work across multiple accounts?",
            a: "Yes. Connect your work account, your personal account, and any others under one endpoint, then say which one you mean in the prompt, or search across all of them at once. Switching accounts does not mean disconnecting and reconnecting. [One prompt, two inboxes](/blog/one-prompt-two-inboxes-multi-account-mcp) shows what that looks like in practice.",
          },
          {
            q: "Can it edit existing files, not just create new ones?",
            a: "Yes. Cell level edits in Sheets, in place edits in Docs and Slides, replies inside existing email threads. Creating a new file is the easy half; changing the one you already have is the half we built this for.",
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
            a: "From your [dashboard](/dashboard), disconnect the account. From Google's side, you can also revoke DataToRAG's access at myaccount.google.com under third party access. Either one ends our ability to touch that account.",
          },
        ],
      },
      {
        title: "Account",
        faqs: [
          {
            q: "What does it cost?",
            a: "It is free to get started today. Paid plans are coming and the [pricing page](/pricing) carries the current state. We would rather the page be honest than exciting.",
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
            q: "Can my AI assistant actually edit my files, or only read them?",
            a: `Edit them, and that is the whole difference. The built-in connectors read well and stop at the point of change: through DataToRAG your assistant appends rows to a spreadsheet you already have, replies inside an existing email thread, puts content into a deck it just made, and updates a Jira issue, with your approval on every one. The capability table on this page was built by enumerating each connector's tool surface on ${VERIFIED_ON}, not by reading documentation.`,
          },
          {
            q: "Which AI clients can connect to it?",
            a: "Any client that speaks MCP. Claude Desktop, Cursor, Windsurf and your own application all connect the same way, with one URL covering every service you have connected and OAuth sign-in handling the rest. The gateway is hosted, so the same connection works from another machine without setting anything up again.",
          },
          {
            q: "What does DataToRAG connect to?",
            a: "Google Workspace and Atlassian. Gmail, Drive, Docs, Sheets, Slides, Calendar, Contacts and Tasks, plus Jira and Confluence, all behind one endpoint: connect once and every tool is available to your assistant rather than one integration at a time. The [docs](/docs) list every action per service.",
          },
          {
            q: "What stops it doing something I did not want?",
            a: "An approval step in front of every write. Reads flow, and anything that changes your data is shown to you and waits. The gate fails closed, so a tool DataToRAG does not positively recognise as a read is treated as a write and asks first, and there is no shell or arbitrary code execution anywhere in the gateway for a prompt injection to reach.",
          },
          {
            q: "Is it safe to connect a hosted gateway to my Google account?",
            a: "It is the right question to ask of anything asking for Workspace access. DataToRAG has been Google-verified since June 2026 and passed the CASA Tier 2 security assessment that the restricted Workspace scopes require, so you will not see an unverified app warning when you connect. The gateway is also open source: you can read exactly what it does, and run it yourself instead. Here is [what the verification involved](/blog/casa-tier-2-verified).",
          },
          {
            q: "What does it cost to start?",
            a: `Nothing, and no card. The free tier includes ${FREE_CALLS} tool calls a month with every connector available, and paid plans buy a bigger allowance rather than unlocking features. [Pricing](/pricing) has the current numbers.`,
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
            a: `The next tool call is refused, not billed. The free cap is checked before a call runs, and the refusal tells you the allowance resets at the start of your next period and that Pro is available from your dashboard. Free is ${FREE_CALLS} tool calls a month with no card on file, so there is nothing to surprise you at the end of it.`,
          },
          {
            q: "Which tool calls count against the allowance?",
            a: "The ones that reached the API. A successful call counts, and so does a request that came back with a legitimate no, because it ran. Server errors are not metered: if the DataToRAG gateway is down, a plugin crashes, or an upstream API returns a 5xx, that call is not counted against you. Your [usage dashboard](/docs/usage) shows what ran.",
          },
          {
            q: "Is any connector or feature behind the paid tier?",
            a: "No. Every tier gets every connector and every tool, several accounts side by side, and the approval gate on writes. What Pro and Enterprise buy is a larger monthly allowance, not a larger feature set, which is why there is no per-connector upsell anywhere on this page.",
          },
          {
            q: "Can I run the gateway myself instead?",
            a: "Yes. The DataToRAG gateway is open source and you can self-host it, which is also the Enterprise choice: hosted by us, or run by you, at a committed-volume rate either way.",
          },
          {
            q: "How do I get an Enterprise quote?",
            a: "Tell us what you are running and a person answers. The [contact form](/contact?from=pricing) reaches us directly, Enterprise includes everything in Pro, and the rate is negotiated against committed volume rather than published as a tier.",
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
