import { describe, expect, it } from "vitest";
import { CASES } from "@/gateway/tests/cases";
import { FIXTURE_KEYS } from "@/gateway/tests/types";
import { PUBLIC_TITLES } from "./public-titles";
import { GATE_CASE_ID } from "./read-model";
import { ADMIN_AUDIENCE_PLUGIN_SLUGS } from "@/app/dashboard/connections/service-registry";

/** A case about an admin-only service (Brevo, SCRUM-468; Slack, SCRUM-454)
 * exercises only that plugin's tools. The status page never shows it, so it
 * needs no public title. Brevo's carry approved ones for when its audience
 * lifts; Slack's carry none: public copy nobody reads is copy nobody
 * reviewed. */
const adminOnlyCase = (covers: string[]) =>
  covers.length > 0 && covers.every((t) => ADMIN_AUDIENCE_PLUGIN_SLUGS.some((slug) => t.startsWith(`${slug}__`)));

/** Public titles are public copy (SCRUM-431): every case has one, and none
 * carries anything a status page must not say. */
describe("public titles", () => {
  it("exist for every registered case and the runner's gate row, and for nothing else", () => {
    const shown = CASES.filter((c) => !adminOnlyCase(c.covers)).map((c) => c.id);
    for (const id of [...shown, GATE_CASE_ID]) expect(PUBLIC_TITLES[id], id).toBeDefined();
    const known = new Set([...CASES.map((c) => c.id), GATE_CASE_ID]);
    for (const id of Object.keys(PUBLIC_TITLES)) expect(known.has(id), id).toBe(true);
  });

  it("are not required of an admin-only service's cases, and Slack's have none (SCRUM-454)", () => {
    const adminOnly = CASES.filter((c) => adminOnlyCase(c.covers)).map((c) => c.id);
    const slack = ["SL1", "SL10", "SL2", "SL3", "SL4", "SL5", "SL6", "SL7", "SL8", "SL9"];
    expect(adminOnly.filter((id) => id.startsWith("SL")).sort()).toEqual(slack);
    for (const id of slack) expect(PUBLIC_TITLES[id], id).toBeUndefined();
  });

  it.each(Object.entries(PUBLIC_TITLES))("%s carries no ticket id, email, em dash, fixture key or tool count", (_id, title) => {
    expect(title.trim()).not.toBe("");
    expect(title).not.toMatch(/\b[A-Z]+-\d+\b/);
    expect(title).not.toMatch(/@/);
    expect(title).not.toContain(String.fromCharCode(0x2014));
    // Fixture keys are camelCase names (smokeMessage, querySheet). The plain
    // words some of them also are (doc, folder) are allowed.
    for (const key of FIXTURE_KEYS.filter((k) => /[a-z][A-Z]/.test(k))) expect(title).not.toContain(key);
    expect(title).not.toMatch(/\b\d+\+?\s+tools?\b/i);
  });
});
