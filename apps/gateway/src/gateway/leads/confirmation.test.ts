import { describe, expect, it, vi, beforeEach } from "vitest";

// vi.hoisted, not a bare const: the vi.mock factory is hoisted above module
// initialisation, so it cannot close over a top-level binding directly.
const { sendBrevoEmail } = vi.hoisted(() => ({ sendBrevoEmail: vi.fn() }));
vi.mock("@/lib/brevo", () => ({ sendBrevoEmail }));

import {
  CONFIRMATION_BOOKING_URL,
  CONFIRMATION_CTA_URL,
  confirmationHtml,
  confirmationSubject,
  confirmationText,
  firstNameOf,
  sendLeadConfirmation,
} from "./confirmation";

/** This is the only copy we send to a stranger automatically, in our name,
 * with nobody reading it first. The claim rules that govern every page govern
 * it too — and unlike a page, nobody will ever look at it again. */
describe("lead confirmation copy", () => {
  const bodies = [confirmationText("Ada Lovelace"), confirmationHtml("Ada Lovelace")];

  it.each(bodies.map((b, i) => [i === 0 ? "text" : "html", b] as const))(
    "%s part uses the canonical CASA wording",
    (_part, body) => {
      // Google-specific assessment. Any looser phrasing invites reading it as
      // SOC 2 or a general audit we have not had.
      expect(body).toContain(
        "Google-verified app, CASA Tier 2 security approved (June 2026)"
      );
    }
  );

  it.each(bodies.map((b, i) => [i === 0 ? "text" : "html", b] as const))(
    "%s part claims no capability we do not ship",
    (_part, body) => {
      // These are claims about the PRODUCT, which is the axis that matters:
      // we do not support shared or delegated mailboxes, and CASA is a
      // Google-specific assessment that must never read as a broad audit.
      //
      // Deliberately NOT banned: call/meeting wording. The product has no
      // telephony surface, but the company does book meetings and the email
      // now links a real appointment schedule — so banning that phrasing here
      // would assert something false. The banned list covers capability
      // claims, not the fact that a human will talk to you.
      //
      // A match is a candidate to check, not proof of a bug.
      for (const banned of [
        "shared inbox",
        "team inbox",
        "shared mailbox",
        "SOC 2",
        "ISO 27001",
        "fully automated",
      ]) {
        expect(body.toLowerCase()).not.toContain(banned.toLowerCase());
      }
    }
  );

  it("carries both links, each distinguishable in the click data", () => {
    // Keeping the link set small and distinct is what makes a click legible:
    // it tells us which path someone took rather than only that they moved.
    const urls = confirmationText("Ada Lovelace").match(/https?:\/\/\S+/g) ?? [];
    expect(urls).toEqual([CONFIRMATION_BOOKING_URL, CONFIRMATION_CTA_URL]);
    expect(new Set(urls).size).toBe(urls.length);
    // Only the on-domain link can carry UTMs PostHog will see; the booking
    // link is off-domain and instrumented by Brevo's per-link count alone.
    expect(CONFIRMATION_CTA_URL).toContain("utm_medium=lead_confirmation");

    const hrefs = confirmationHtml("Ada Lovelace").match(/href="([^"]+)"/g) ?? [];
    expect(hrefs).toHaveLength(2);
  });

  it.each(bodies.map((b, i) => [i === 0 ? "text" : "html", b] as const))(
    "%s part uses no em-dashes",
    (_part, body) => {
      // House style: Manuel writes comma-chains, not em-dashes. In something
      // signed with his name, one is the first thing a reader notices.
      expect(body).not.toContain("—");
      expect(body).not.toContain("&mdash;");
    }
  );

  it("subject is lowercase, the way he writes them", () => {
    // A capitalised subject reads as a system notification. This email's whole
    // job is to read like a person, because the primary ask is a reply.
    const subject = confirmationSubject("Ada Lovelace");
    expect(subject[0]).toBe(subject[0].toLowerCase());
    expect(subject).not.toContain("—");
  });

  it("escapes the submitted name in the HTML part", () => {
    // `name` is unauthenticated form input on a public endpoint. It reaches
    // an HTML body, so it is an injection sink like any other.
    const html = confirmationHtml('<img src=x onerror="alert(1)"> Smith');
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("greets by first name, and stays sane without one", () => {
    expect(firstNameOf("Ada Lovelace")).toBe("Ada");
    expect(confirmationSubject("Ada Lovelace")).toContain("Ada");
    expect(confirmationSubject("")).toBe("got your message");
    expect(confirmationText("")).toContain("Hey,");
  });
});

describe("sendLeadConfirmation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sends with reply-to pointing at the sender inbox", async () => {
    sendBrevoEmail.mockResolvedValue(true);
    await sendLeadConfirmation({
      name: "Ada Lovelace",
      email: "ada@example.com",
      senderEmail: "sender@example.com",
    });
    // Replying is the email's primary ask, so a no-reply sender would make
    // the copy dishonest rather than merely unhelpful.
    expect(sendBrevoEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "ada@example.com",
        senderEmail: "sender@example.com",
        replyTo: "sender@example.com",
      })
    );
  });

  it("resolves false instead of throwing when the send blows up", async () => {
    sendBrevoEmail.mockRejectedValue(new Error("brevo down"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // The route calls this as `void ...`, so a rejection here would surface
    // as an unhandled rejection rather than a failed email.
    await expect(
      sendLeadConfirmation({
        name: "Ada",
        email: "ada@example.com",
        senderEmail: "sender@example.com",
      })
    ).resolves.toBe(false);
    warn.mockRestore();
  });
});
