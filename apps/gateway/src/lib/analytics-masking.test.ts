// @vitest-environment jsdom

/**
 * What analytics may read off the page (SCRUM-414): one rule for recordings
 * and click events, tested against the real SDK's own event builder.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  beforeSendInteraction,
  interactionRevealed,
  isRevealed,
  maskRecordedNetworkRequest,
  maskRecordedText,
  RECORDING_MASKING,
} from "./analytics-masking";

/** The SDK's function that turns a clicked element into event properties,
 * loaded from the installed package rather than imitated. */
const require = createRequire(import.meta.url);
const sdkRoot = dirname(require.resolve("posthog-js/package.json", { paths: [process.cwd()] }));
const { autocapturePropertiesForElement } = require(join(sdkRoot, "lib/src/autocapture.js")) as {
  autocapturePropertiesForElement: (
    target: Element,
    opts: Record<string, unknown>
  ) => { props: Record<string, unknown> };
};

const EMAIL = "someone@example.com";
const SUBJECT = "the offer letter";

/** A page shaped like ours: the public root shown, the dashboard hidden, its
 * rail shown, the user's own menu hidden again inside the rail. */
function page(): void {
  document.body.setAttribute("data-ph-unmask", "");
  document.body.innerHTML = `
    <a id="public-cta" href="/pricing">See pricing</a>
    <div id="shell" data-ph-mask="">
      <aside id="rail" data-ph-unmask="">
        <a id="rail-link" href="/dashboard/agent">Agent</a>
        <div id="user-menu" data-ph-mask="">
          <button id="user-button" title="${EMAIL}">${EMAIL}</button>
        </div>
      </aside>
      <main>
        <div class="thread" title="Re: ${SUBJECT}">
          <p id="message">From: ${EMAIL} Subject: ${SUBJECT}</p>
          <p><a id="file-link" href="https://docs.google.com/document/d/secret-doc-id/edit">${SUBJECT}</a></p>
          <p id="tricky" title="Shared\\">Q3 budget; send to ${EMAIL}</p>
          <button id="thread-title"><span>${SUBJECT}</span></button>
        </div>
        <div data-ph-unmask=""><button id="new-chat">New chat</button></div>
      </main>
    </div>`;
}

const byId = (id: string) => document.getElementById(id)!;
const sdkProps = (id: string, elementsChainAsString: boolean) =>
  autocapturePropertiesForElement(byId(id), {
    e: new MouseEvent("click", { bubbles: true }),
    maskAllElementAttributes: false,
    maskAllText: false,
    elementAttributeIgnoreList: undefined,
    elementsChainAsString,
  }).props;
const sendClick = (id: string, chainAsString: boolean, event = "$autocapture") =>
  beforeSendInteraction({
    event,
    properties: { $current_url: "https://datatorag.com/dashboard/agent", ...sdkProps(id, chainAsString) } as Record<string, unknown>,
  })!;

beforeEach(page);

describe("the marks decide, the nearer one first", () => {
  it("shows the public site, hides the dashboard, shows its chrome, hides the user's own menu", () => {
    expect(isRevealed(byId("public-cta"))).toBe(true);
    expect(isRevealed(byId("rail-link"))).toBe(true);
    expect(isRevealed(byId("user-button"))).toBe(false);
    expect(isRevealed(byId("message"))).toBe(false);
    expect(isRevealed(byId("thread-title"))).toBe(false);
    expect(isRevealed(byId("new-chat"))).toBe(true);
  });

  it("hides anything with no mark at all", () => {
    const orphan = document.createElement("p");
    expect(isRevealed(orphan)).toBe(false);
    expect(isRevealed(null)).toBe(false);
    expect(isRevealed(undefined)).toBe(false);
  });
});

describe("session recordings", () => {
  it("mask every input, and send every text node through the hook", () => {
    expect(RECORDING_MASKING.maskAllInputs).toBe(true);
    expect(RECORDING_MASKING.maskTextSelector).toBe("*");
    expect(RECORDING_MASKING.maskTextFn).toBe(maskRecordedText);
  });

  it("keep chrome readable and turn account data into its own shape in asterisks", () => {
    expect(maskRecordedText("Agent", byId("rail-link"))).toBe("Agent");
    const hidden = maskRecordedText(`From: ${EMAIL}`, byId("message"));
    expect(hidden).toBe("***** *******************");
    expect(maskRecordedText(EMAIL, byId("user-button"))).not.toContain("@");
    // The recorder may hand over no element: hidden.
    expect(maskRecordedText("text", null)).toBe("****");
  });

  it("never keep a request's body or headers, or its query string", () => {
    expect(RECORDING_MASKING.maskCapturedNetworkRequestFn).toBe(maskRecordedNetworkRequest);
    const kept = maskRecordedNetworkRequest({
      name: "https://datatorag.com/api/playground/threads/abc?x=1#y",
      method: "POST",
      status: 200,
      requestHeaders: { cookie: "dtrmcp_session=secret" },
      requestBody: JSON.stringify({ messages: [{ text: EMAIL }] }),
      responseHeaders: { "set-cookie": "a=b" },
      responseBody: SUBJECT,
    });
    expect(kept).toEqual({
      name: "https://datatorag.com/api/playground/threads/abc",
      method: "POST",
      status: 200,
      requestHeaders: undefined,
      requestBody: undefined,
      responseHeaders: undefined,
      responseBody: undefined,
    });
    expect(maskRecordedNetworkRequest({ name: "/dashboard/agent?thread=t1" }).name).toBe("/dashboard/agent");
    expect(maskRecordedNetworkRequest({} as { name?: string }).name).toBe("");
  });

  it("are configured by the provider", () => {
    const provider = readFileSync(join(__dirname, "../components/posthog-provider.tsx"), "utf8");
    expect(provider).toMatch(/session_recording: RECORDING_MASKING,/);
  });
});

describe.each([
  ["element list", false],
  ["chain string", true],
])("click events, as the SDK builds them (%s)", (_mode, chainAsString) => {
  it("a click on a message sends nothing that was written there", () => {
    for (const event of ["$autocapture", "$rageclick", "$dead_click", "$dead_swipe"]) {
      const wire = JSON.stringify(sendClick("message", chainAsString, event));
      expect(wire, event).not.toContain(EMAIL);
      expect(wire, event).not.toContain(SUBJECT);
    }
  });

  it("a click on a conversation title (text in a nested span) sends nothing of it", () => {
    const wire = JSON.stringify(sendClick("thread-title", chainAsString));
    expect(wire).not.toContain(SUBJECT);
  });

  it("a click on the user's own menu sends neither the label nor the title attribute", () => {
    const wire = JSON.stringify(sendClick("user-button", chainAsString));
    expect(wire).not.toContain(EMAIL);
  });

  it("a click on marked chrome is sent as the SDK built it, when the event says so in its element list", () => {
    const raw = { event: "$autocapture", properties: sdkProps("new-chat", chainAsString) };
    const rail = { event: "$autocapture", properties: sdkProps("rail-link", chainAsString) };
    if (!chainAsString) {
      expect(beforeSendInteraction(raw)).toBe(raw);
      expect(JSON.stringify(raw)).toContain("New chat");
      expect(beforeSendInteraction(rail)).toBe(rail);
    } else {
      // The chain string alone is never trusted to say "shown": fail closed.
      expect(JSON.stringify(beforeSendInteraction(raw))).not.toContain("New chat");
    }
  });

  it("a click on a link in a message sends neither its address nor its text", () => {
    const wire = JSON.stringify(sendClick("file-link", chainAsString));
    expect(wire).not.toContain("secret-doc-id");
    expect(wire).not.toContain("docs.google.com");
    expect(wire).not.toContain(SUBJECT);
  });

  it("a value ending in a backslash, next to a separator in the text, cannot leave anything behind", () => {
    const wire = JSON.stringify(sendClick("tricky", chainAsString));
    expect(wire).not.toContain(EMAIL);
    expect(wire).not.toContain("Q3 budget");
    expect(wire).not.toContain("Shared");
  });

  it("content that spells out the mark does not make a hidden click look shown", () => {
    // A title, a label and a line of text each ending in the characters of
    // the mark, as a crafted email subject or conversation title could.
    const bait = 'attr__data-ph-unmask=';
    const message = byId("message");
    message.textContent = `From: ${EMAIL} ${bait}`;
    message.setAttribute("title", `Re: ${SUBJECT} ${bait}`);
    message.setAttribute("aria-label", `${SUBJECT} ${bait}\\`);
    const wire = JSON.stringify(sendClick("message", chainAsString));
    expect(wire).not.toContain(EMAIL);
    expect(wire).not.toContain(SUBJECT);
  });

  it("keeps the structure of a hidden click, so it is still a click somewhere", () => {
    const sent = sendClick("message", chainAsString);
    expect(sent.properties!.$current_url).toBe("https://datatorag.com/dashboard/agent");
    const props = sent.properties as Record<string, unknown>;
    if (!chainAsString) {
      // The list keeps its structure, and the summary is rebuilt from it.
      expect(JSON.stringify(props.$elements)).toContain("thread");
      expect(props.$elements_chain).toMatch(/^p(\.[^;:]*)?(:[^;]*)?;div\.thread/);
    } else {
      // A summary string alone is never edited: it is dropped.
      expect(props).not.toHaveProperty("$elements_chain");
    }
  });
});

describe("account data in attributes, which recordings copy as they are", () => {
  /**
   * The recorder copies every attribute verbatim and has no hook to mask
   * them, so a dynamic title, aria-label, alt or placeholder in the
   * dashboard is either ours (a label we wrote) or sits on an element that
   * carries ph-no-capture. Every one is listed here with which it is; a new
   * one fails until somebody decides.
   */
  const OURS = "ours: a label, route or address we wrote";
  const LEFT_OUT = "account data: the element carries ph-no-capture";
  const REVIEWED: Record<string, string> = {
    // Account data, left out whole.
    "app/dashboard/agent-meter.tsx title={c.emails}": LEFT_OUT,
    "app/dashboard/layout.tsx aria-label={compact ? (user.name ?? user.email) : undefined}": LEFT_OUT,
    "app/dashboard/layout.tsx title={compact ? (user.name ?? user.email) : undefined}": LEFT_OUT,
    "app/dashboard/layout.tsx src={user.avatarUrl}": LEFT_OUT + " (on the button around the picture)",
    "app/dashboard/agent/thread-list.tsx aria-label={`Delete ${thread.title}`}": LEFT_OUT,
    "app/dashboard/agent/thread-list.tsx title={`Delete ${thread.title}`}": LEFT_OUT,
    "app/dashboard/billing/billing-view.tsx href={invoice.pdfUrl}": LEFT_OUT + " (a link that opens without signing in)",
    // Ids and slugs: opaque thread ids that need a session to use, and skill
    // slugs, which are already sent as an event property.
    "app/dashboard/skills/skills-client.tsx href={`/dashboard/agent?thread=${run.threadId}`}": "an opaque thread id",
    "app/dashboard/usage/usage-client.tsx href={`/dashboard/agent?thread=${encodeURIComponent(s.threadId)}`}": "an opaque thread id",
    "app/dashboard/skills/skills-client.tsx href={`/skills/${skill.slug}`}": "a skill slug, already an event property",
    "app/dashboard/skills/skills-client.tsx href={skillDeepLink(skill.slug)}": "a skill slug, already an event property",
    "components/run-skill-cta.tsx href={user ? skillDeepLink(slug) : signInAndRunHref(slug)}": "a published skill slug",
    "components/skill-card.tsx href={`/skills/${skill.slug}`}": "a published skill slug",
    "app/dashboard/admin/tests/runs-panel.tsx href={`/dashboard/admin/tests/${run.run_id}`}": "an opaque test run id, admin only",
    "app/dashboard/usage/usage-client.tsx href={`/dashboard/usage/${r.toolName}`}": "a tool name, ours",
    // Ours.
    "app/dashboard/admin/tests/runs-panel.tsx title={scope === \"all\" ? undefined : SCENARIOS.find((s) => s.key === scope)?.title}": OURS,
    "app/dashboard/agent-parts.tsx href={withReturn(href)}": OURS,
    "app/dashboard/billing/billing-view.tsx aria-label={label}": OURS,
    "app/dashboard/connect-outcome-notice.tsx href={google.connectUrl}": OURS,
    "app/dashboard/connections/[service]/client.tsx href={connectUrl}": OURS,
    "app/dashboard/connections/[service]/client.tsx placeholder={schema.description ?? `Enter JSON`}": OURS + " (a tool schema)",
    'app/dashboard/connections/[service]/client.tsx placeholder={schema.description ?? ""}': OURS + " (a tool schema)",
    "app/dashboard/connections/grant-panel.tsx href={href}": OURS,
    "app/dashboard/dashboard-client.tsx href={`/dashboard/connections/${service.id}`}": OURS,
    "app/dashboard/dashboard-client.tsx href={service.connectUrl}": OURS,
    'app/dashboard/dashboard-client.tsx title={hasConnectedAccount ? PROMPT_CARD_RUN_LABEL : "Connect an account to run this"}': OURS,
    "app/dashboard/layout.tsx href={item.href}": OURS,
    "app/dashboard/layout.tsx aria-label={item.label}": OURS,
    "app/dashboard/layout.tsx title={railExpanded ? undefined : item.label}": OURS,
    'app/dashboard/layout.tsx aria-label={railExpanded ? "Collapse navigation" : "Expand navigation"}': OURS,
    'app/dashboard/layout.tsx title={railExpanded ? undefined : "Expand navigation"}': OURS,
    "app/dashboard/playground-presentation.tsx title={display}": OURS + " (a tool's display name)",
    "app/dashboard/playground.tsx title={locked ? LOCKED_PROMPT_TITLE : undefined}": OURS,
    "app/dashboard/playground.tsx placeholder={placeholder}": OURS,
    "components/ai-elements/prompt-input.tsx placeholder={placeholder}": OURS,
    'components/ai-elements/prompt-input.tsx aria-label={isGenerating ? "Stop" : "Submit"}': OURS,
    "components/contact-page.tsx href={signInHref()}": OURS,
    "components/cta-link.tsx href={href}": OURS,
    "components/demo/demo-bento.tsx href={ctaHref}": OURS,
    "components/demo/demo-section.tsx href={promptHref}": OURS,
    "components/faq-section.tsx href={`#${anchor}`}": OURS,
    "components/faq-section.tsx aria-label={`Link to: ${faq.q}`}": OURS,
    "components/google-ads.tsx src={`https://www.googletagmanager.com/gtag/js?id=${GOOGLE_ADS_ID}`}": OURS,
    'components/hero-video.tsx aria-label={soundOn ? "Turn off narration" : "Play the video with narration, from the start"}': OURS,
    "components/integration-catalog.tsx href={`/docs/${integration.slug}`}": OURS,
    "components/navbar.tsx href={item.href}": OURS,
    "components/navbar.tsx href={ctaHref}": OURS,
    "components/promo-banner.tsx href={promoPricingHref()}": OURS,
    "components/service-icon.tsx src={`/icons/services/${service}.svg`}": OURS,
    "components/zoomable-image.tsx src={src}": OURS + " (docs images)",
    "components/zoomable-image.tsx alt={alt}": OURS + " (docs images)",
  };

  /** Every `attr={...}` with one of these names, the expression read to its
   * matching brace however many lines it spans. Literals and SCREAMING
   * constants are skipped: they cannot carry account data. */
  function dynamicAttributes(): string[] {
    const SRC = join(__dirname, "..");
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return walk(path);
        return name.endsWith(".tsx") && !name.includes(".test.") ? [path] : [];
      });
    const found: string[] = [];
    for (const file of [...walk(join(SRC, "app/dashboard")), ...walk(join(SRC, "components"))]) {
      const source = readFileSync(file, "utf8");
      const attr = /\b(title|aria-label|alt|placeholder|href|src)=\{/g;
      for (let m = attr.exec(source); m; m = attr.exec(source)) {
        let depth = 1;
        let i = m.index + m[0].length;
        for (; i < source.length && depth > 0; i++) {
          if (source[i] === "{") depth++;
          else if (source[i] === "}") depth--;
        }
        const expression = source.slice(m.index + m[0].length, i - 1).replace(/\s+/g, " ").trim();
        if (/^"[^"]*"$/.test(expression) || /^[A-Z_][A-Z0-9_]{2,}$/.test(expression) || expression === "undefined") continue;
        found.push(`${relative(SRC, file)} ${m[1]}={${expression}}`);
      }
    }
    return found;
  }

  it("every dynamic title, aria-label, alt, placeholder, href and src has been classified", () => {
    const found = dynamicAttributes();
    expect(found.length).toBeGreaterThan(40);
    expect([...new Set(found.filter((entry) => !(entry in REVIEWED)))]).toEqual([]);
  });

  it("reads an attribute that spans lines", () => {
    // dashboard-client's prompt-card title is written over three lines.
    expect(dynamicAttributes()).toContain(
      'app/dashboard/dashboard-client.tsx title={hasConnectedAccount ? PROMPT_CARD_RUN_LABEL : "Connect an account to run this"}'
    );
  });

  it("the elements marked as leaving account data in attributes really are left out", () => {
    const read = (file: string) => readFileSync(join(__dirname, "..", file), "utf8");
    expect(read("app/dashboard/agent-meter.tsx")).toMatch(/className="ph-no-capture" key=\{c\.key\} title=\{c\.emails\}/);
    expect(read("app/dashboard/agent/thread-list.tsx")).toMatch(/className="ph-no-capture shrink-0[^"]*"[\s\S]{0,200}title=\{`Delete \$\{thread\.title\}`\}/);
    expect(read("app/dashboard/layout.tsx")).toMatch(/title=\{compact \? \(user\.name \?\? user\.email\) : undefined\}[\s\S]{0,400}"ph-no-capture",/);
    expect(read("app/dashboard/billing/billing-view.tsx")).toMatch(/href=\{invoice\.pdfUrl\}[^>]*className="ph-no-capture /);
    expect(read("app/dashboard/playground-presentation.tsx")).toMatch(/className=\{`ph-no-capture \$\{bodyClass\}`\}/);
  });

  it("while a dashboard page is on screen, the body is hidden too, so portals are", () => {
    const layout = readFileSync(join(__dirname, "../app/dashboard/layout.tsx"), "utf8");
    expect(layout).toMatch(/body\.removeAttribute\(UNMASK_ATTR\);\s*body\.setAttribute\(MASK_ATTR, ""\);/);
    expect(layout).toMatch(/if \(wasShown\) body\.setAttribute\(UNMASK_ATTR, ""\);/);
  });

  it("recordings never capture request bodies or headers, on the client side either", () => {
    expect(RECORDING_MASKING.recordHeaders).toBe(false);
    expect(RECORDING_MASKING.recordBody).toBe(false);
  });
});

describe("the click filter's edges", () => {
  it("fails closed with no element information at all, and on a chain string alone", () => {
    expect(interactionRevealed({})).toBe(false);
    expect(interactionRevealed({ $elements: [] })).toBe(false);
    expect(interactionRevealed({ $elements_chain: "" })).toBe(false);
    expect(interactionRevealed({ $elements_chain: 'button:attr__data-ph-unmask=""text="New chat"' })).toBe(false);
  });

  it("keeps only allowed keys on each element, and drops every element-derived top-level key", () => {
    const sent = beforeSendInteraction({
      event: "$autocapture",
      properties: {
        $current_url: "https://datatorag.com/dashboard",
        $el_text: "SECRET-text",
        $el_aria_label: "SECRET-top",
        $elements: [{ tag_name: "p", nth_child: 1, $el_title: "SECRET-el", future_key: "SECRET-new", "attr__data-x": "SECRET-attr", attr__class: "thread" }],
      },
    })!;
    const wire = JSON.stringify(sent);
    expect(wire).not.toContain("SECRET");
    expect(sent.properties!.$current_url).toBe("https://datatorag.com/dashboard");
    expect((sent.properties!.$elements as unknown[])[0]).toEqual({ tag_name: "p", nth_child: 1, attr__class: "thread" });
  });

  it("drops an enclosing link's address from a hidden click", () => {
    const sent = beforeSendInteraction({
      event: "$autocapture",
      properties: { $external_click_url: "https://mail.example/thread/123", $elements: [{ tag_name: "p" }] },
    })!;
    expect(sent.properties).not.toHaveProperty("$external_click_url");
  });

  it("leaves every other event alone", () => {
    const pageview = { event: "$pageview", properties: { $el_text: "x" } };
    expect(beforeSendInteraction(pageview)).toBe(pageview);
    expect(beforeSendInteraction(null)).toBeNull();
  });
});

describe("nothing in the app can route around the rule", () => {
  it("no element uses the SDK's capture-attribute escape hatch", () => {
    // `data-ph-capture-attribute-*` turns an attribute into a top-level
    // property, which no filter on the element list would see.
    const { execSync } = require("node:child_process") as typeof import("node:child_process");
    const hits = execSync("grep -rl 'data-ph-capture-attribute' src || true", { cwd: join(__dirname, "../..") })
      .toString()
      .split("\n")
      .filter((f) => f && !f.endsWith("analytics-masking.test.ts") && !f.endsWith("analytics-masking.ts"));
    expect(hits).toEqual([]);
  });

  it("the public root is shown and the dashboard root is hidden", () => {
    const root = readFileSync(join(__dirname, "../app/layout.tsx"), "utf8");
    expect(root).toMatch(/<body[\s\S]*?data-ph-unmask=""[\s\S]*?>/);
    const dashboard = readFileSync(join(__dirname, "../app/dashboard/layout.tsx"), "utf8");
    expect(dashboard).toMatch(/ref=\{shell\}[\s\S]{0,400}\{\.\.\.MASK\}/);
    expect(dashboard).toMatch(/className="relative" \{\.\.\.MASK\}/);
  });
});
