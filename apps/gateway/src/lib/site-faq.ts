import type { ContentFaq } from "./content-collection";

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
