// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/components/navbar", () => ({ Navbar: () => null }));
vi.mock("@/components/add-to-agent", () => ({ AddToAgent: () => <div data-add-to-agent="" /> }));
vi.mock("posthog-js", () => ({ default: { capture: vi.fn() } }));

import UseCasesPage, { metadata as listMetadata } from "./page";
import UseCasePage, { generateMetadata, generateStaticParams } from "./[slug]/page";
import { DESCRIPTION_MAX, DESCRIPTION_MIN, USE_CASE_SERVICES, getAllUseCases, shortTool } from "@/lib/use-cases";

const useCases = getAllUseCases();
const dom = (html: string) => {
  const host = document.createElement("div");
  host.innerHTML = html;
  return host;
};
const nodes = (host: HTMLElement) =>
  [...host.querySelectorAll('script[type="application/ld+json"]')].flatMap((s) => JSON.parse(s.textContent ?? "[]") as Record<string, unknown>[]);

describe("the use case list", () => {
  const host = dom(renderToStaticMarkup(<UseCasesPage />));

  it("has a card for every record: its title, its sentence, its services, its flow diagram, and a link to its page", () => {
    const cards = [...host.querySelectorAll<HTMLElement>("[data-use-case]")];
    expect(cards.map((c) => c.dataset.useCase).sort()).toEqual(useCases.map((u) => u.slug).sort());
    for (const u of useCases) {
      const card = cards.find((c) => c.dataset.useCase === u.slug)!;
      expect(card.textContent).toContain(u.title);
      expect(card.textContent).toContain(u.outcome);
      expect(card.querySelector("a")!.getAttribute("href")).toBe(`/use-cases/${u.slug}`);
      expect(card.dataset.services).toBe(u.services.join(" "));
      // The diagram: a mark per service, and one more when it spans accounts.
      const marks = [...card.querySelectorAll("[data-playing] img")].map((i) => i.getAttribute("src")).filter((s) => s?.includes("/icons/services/"));
      expect(marks.length).toBe(u.services.length + (u.accounts === "multiple" ? 1 : 0));
      // It rests until it is on screen, and is not read out.
      expect(card.querySelector("[data-playing]")!.getAttribute("data-playing")).toBe("false");
      expect(card.querySelector('[data-playing] [aria-hidden="true"]')).not.toBeNull();
    }
  });

  it("hides no card in the served page, and filters with real links, one per service in use", () => {
    expect([...host.querySelectorAll("[data-use-case]")].some((c) => c.hasAttribute("hidden"))).toBe(false);
    const links = [...host.querySelectorAll('nav[aria-label="Filter use cases by service"] a')].map((a) => a.getAttribute("href"));
    const used = [...new Set(useCases.flatMap((u) => u.services))];
    expect(links[0]).toBe("/use-cases");
    expect(links.slice(1).sort()).toEqual(used.map((s) => `/use-cases?service=${s}`).sort());
  });

  it("has one heading, its own description, and a canonical address", () => {
    expect(host.querySelectorAll("h1").length).toBe(1);
    expect(String(listMetadata.description).length).toBeGreaterThanOrEqual(DESCRIPTION_MIN);
    expect(String(listMetadata.description).length).toBeLessThanOrEqual(DESCRIPTION_MAX);
    expect(listMetadata.alternates?.canonical).toBe("https://datatorag.com/use-cases");
    expect(nodes(host).map((n) => n["@type"])).toEqual(["BreadcrumbList"]);
  });
});

describe("a use case's page", () => {
  it("is generated for every record", () => {
    expect(generateStaticParams().map((p) => p.slug).sort()).toEqual(useCases.map((u) => u.slug).sort());
  });

  it.each(useCases.map((u) => [u.slug, u] as const))("%s renders from its record", async (slug, u) => {
    const host = dom(renderToStaticMarkup(await UseCasePage({ params: Promise.resolve({ slug }) })));

    // One heading: the task.
    expect([...host.querySelectorAll("h1")].map((h) => h.textContent)).toEqual([u.title]);
    // The passage stands alone.
    const passage = host.querySelector("h1 + p")!.textContent ?? "";
    for (const word of ["DataToRAG", "Claude", USE_CASE_SERVICES[u.services[0]].label]) expect(passage, word).toContain(word);
    // The replay, and under it the same content as plain text.
    expect(host.querySelector("[data-use-case-replay]")).not.toBeNull();
    const article = host.querySelector("article")!;
    const outside = article.cloneNode(true) as HTMLElement;
    outside.querySelector("[data-use-case-replay]")!.remove();
    expect(outside.textContent).toContain(u.prompt);
    const listed = [...outside.querySelectorAll("ol li")].map((li) => li.textContent ?? "");
    expect(listed.length).toBe(u.steps.length);
    u.steps.forEach((step, i) => {
      expect(listed[i]).toContain(step.label);
      expect(listed[i]).toContain(shortTool(step.tool));
    });
    expect(outside.textContent).toContain(u.answer);
    // A shown date that is the record's.
    expect(host.querySelector("time")!.getAttribute("datetime")).toBe(u.date);
    // Try it, the docs for each service, and related use cases.
    expect(host.querySelector("[data-add-to-agent]")).not.toBeNull();
    const hrefs = [...article.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    for (const s of u.services) expect(hrefs).toContain(`/docs/${USE_CASE_SERVICES[s].docs}`);
    if (u.skill) expect(hrefs).toContain(`/skills/${u.skill}`);
    const related = [...article.querySelectorAll<HTMLElement>("[data-use-case]")].map((c) => c.dataset.useCase);
    expect(related.length).toBe(Math.min(3, useCases.length - 1));
    expect(related).not.toContain(slug);
    // No image stands in for words.
    for (const img of article.querySelectorAll("img")) expect(img.getAttribute("alt")).toBe("");

    // Structured data: the trail and the steps, with the record's date.
    const data = nodes(host);
    expect(data.map((n) => n["@type"])).toEqual(["BreadcrumbList", "HowTo"]);
    const howTo = data[1] as { step: { name: string }[]; dateModified: string; url: string };
    expect(howTo.step.map((s) => s.name)).toEqual(u.steps.map((s) => s.label));
    expect(howTo.dateModified).toBe(u.date);
    expect(howTo.url).toBe(`https://datatorag.com/use-cases/${slug}`);

    // Its own title, description, and canonical address.
    const meta = await generateMetadata({ params: Promise.resolve({ slug }) });
    expect(String(meta.title)).toContain(u.title);
    expect(String(meta.title)).toContain(USE_CASE_SERVICES[u.services[0]].label);
    expect(String(meta.title)).toMatch(/MCP \| DataToRAG$/);
    expect(meta.description).toBe(u.description);
    expect(meta.alternates?.canonical).toBe(`https://datatorag.com/use-cases/${slug}`);
  });

  it("is not found for a slug with no record", async () => {
    await expect(UseCasePage({ params: Promise.resolve({ slug: "no-such-use-case" }) })).rejects.toThrow();
    expect(await generateMetadata({ params: Promise.resolve({ slug: "no-such-use-case" }) })).toEqual({});
  });
});
