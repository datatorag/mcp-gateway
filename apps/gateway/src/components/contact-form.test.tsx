// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

/* The contact form and its custom integration variant post to the same
 * leads route and fire the same lead_submitted event, told apart by `form`
 * and, for the variant, by the source and service it sends. */

const capture = vi.hoisted(() => vi.fn());
vi.mock("posthog-js", () => ({ default: { capture } }));
vi.mock("@/components/google-ads", () => ({ reportLeadConversion: vi.fn() }));

import { ContactForm } from "./contact-form";

let container: HTMLDivElement;
let root: Root;
const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockClear();
  capture.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function type(id: string, value: string) {
  const el = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#${id}`)!;
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

async function submit() {
  await act(async () => {
    container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

const sentBody = () => JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);

describe("the custom integration request form", () => {
  it("asks for the service, sends it with its source, and names the form in lead_submitted", async () => {
    act(() => root.render(<ContactForm utm={{}} kind="custom_integration" />));
    expect(container.querySelector("#service")?.hasAttribute("required")).toBe(true);
    expect(container.querySelector("#teamSize")).toBeNull();
    expect(container.querySelector("button[type=submit]")?.textContent).toBe("Request an integration");

    type("name", "Ada Lovelace");
    type("email", "ada@example.com");
    type("company", "Analytical Engines");
    type("service", "Linear");
    type("useCase", "file issues from email");
    await submit();

    expect(sentBody()).toMatchObject({
      source: "custom_integration",
      service: "Linear",
      useCase: "file issues from email",
      name: "Ada Lovelace",
      company: "Analytical Engines",
    });
    expect(capture).toHaveBeenCalledWith("lead_submitted", expect.objectContaining({ form: "custom_integration" }));
    expect(container.textContent).toContain("We will reply by email");
  });

  it("the contact form sends no source and names itself contact", async () => {
    act(() => root.render(<ContactForm utm={{}} />));
    expect(container.querySelector("#service")).toBeNull();
    type("name", "Ada Lovelace");
    type("email", "ada@example.com");
    type("company", "Analytical Engines");
    await submit();
    expect(sentBody()).not.toHaveProperty("source");
    expect(sentBody()).not.toHaveProperty("service");
    expect(capture).toHaveBeenCalledWith("lead_submitted", expect.objectContaining({ form: "contact" }));
  });
});
