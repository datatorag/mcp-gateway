import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  beforeSendAnalytics,
  beforeSendException,
  EXCEPTION_CAPTURE,
  MAX_EXCEPTION_MESSAGE,
  trimExceptionMessage,
} from "./analytics-exceptions";
import {
  REPORT_WINDOW_MS,
  REPORTS_PER_ROUTE,
  reportRequestError,
  resetRequestErrorLimit,
  trimmedError,
} from "./request-error-report";

const exception = (entries: unknown[]) => ({ event: "$exception", properties: { $exception_list: entries, page: "/x" } });
const frame = { filename: "https://datatorag.com/_next/static/chunks/a.js", function: "render", lineno: 1 };

describe("what the browser reports as an exception (SCRUM-407)", () => {
  it("captures uncaught errors and unhandled rejections, and NOT console errors", () => {
    // Console capture off is what keeps one crash to one event: an error one
    // of our boundaries caught is reported by the boundary, and the
    // framework also writes it to the console.
    expect(EXCEPTION_CAPTURE).toEqual({
      capture_unhandled_errors: true,
      capture_unhandled_rejections: true,
      capture_console_errors: false,
    });
  });

  it("the provider turns both captures on and installs the filter", () => {
    const provider = readFileSync(join(__dirname, "../components/posthog-provider.tsx"), "utf8");
    expect(provider).toMatch(/capture_exceptions: EXCEPTION_CAPTURE,/);
    expect(provider).toMatch(/capture_dead_clicks: true,/);
    // Dead clicks are never on without the filter that strips their text.
    expect(provider).toMatch(/before_send: beforeSendAnalytics,/);
  });

  it("lets every other event through untouched", () => {
    const click = { event: "$autocapture", properties: { $el_text: "Send" } };
    expect(beforeSendException(click)).toBe(click);
    expect(beforeSendException(null)).toBeNull();
    const odd = { event: "$exception", properties: { $exception_list: "nope" } };
    expect(beforeSendException(odd)).toBe(odd);
  });

  it("drops the opaque cross-origin report, which names nothing", () => {
    expect(beforeSendException(exception([{ type: "Error", value: "Script error." }]))).toBeNull();
    expect(beforeSendException(exception([{ type: "Error", value: "script error", stacktrace: { frames: [] } }]))).toBeNull();
  });

  it("keeps a script error that does have a stack, and one beside a real error", () => {
    expect(
      beforeSendException(exception([{ type: "Error", value: "Script error.", stacktrace: { frames: [frame] } }]))
    ).not.toBeNull();
    expect(
      beforeSendException(exception([{ value: "Script error." }, { type: "TypeError", value: "x is undefined", stacktrace: { frames: [frame] } }]))
    ).not.toBeNull();
  });

  it("trims each message and leaves the rest of the event alone", () => {
    const sent = beforeSendException(
      exception([{ type: "Error", value: "x".repeat(900), stacktrace: { frames: [frame] }, mechanism: { handled: false } }])
    )!;
    const [entry] = sent.properties!.$exception_list as Array<Record<string, unknown>>;
    expect((entry!.value as string).length).toBe(MAX_EXCEPTION_MESSAGE);
    expect(entry!.stacktrace).toEqual({ frames: [frame] });
    expect(entry!.mechanism).toEqual({ handled: false });
    expect(sent.properties!.page).toBe("/x");
  });
});

describe("click events through the installed hook", () => {
  // The rule itself is tested in analytics-masking.test.ts (SCRUM-414). Here:
  // the hook the provider installs applies it, to dead clicks too.
  it("strips the text of a dead click on content", () => {
    const sent = beforeSendAnalytics({
      event: "$dead_click",
      properties: { $el_text: "From: someone@example.com", $elements: [{ tag_name: "p", $el_text: "From: someone@example.com" }] },
    });
    expect(JSON.stringify(sent)).not.toContain("someone@example.com");
  });

  it("leaves a click on chrome marked as shown alone", () => {
    const click = { event: "$autocapture", properties: { $el_text: "New chat", $elements: [{ tag_name: "button", $el_text: "New chat", "attr__data-ph-unmask": "" }] } };
    expect(beforeSendAnalytics(click)).toBe(click);
    expect(beforeSendAnalytics(null)).toBeNull();
  });
});

describe("the exception filter on odd input", () => {
  it("does not throw on an empty entry in the list", () => {
    const event = exception([null, { type: "Error", value: "real", stacktrace: { frames: [frame] } }]);
    expect(() => beforeSendException(event)).not.toThrow();
    expect(beforeSendException(event)).not.toBeNull();
  });
});

describe("trimExceptionMessage", () => {
  it("cuts the bound values a database driver appends", () => {
    const message =
      'Failed query: select "id" from "users" where "email" = $1\nparams: someone@example.com,42';
    const trimmed = trimExceptionMessage(message);
    expect(trimmed).toBe('Failed query: select "id" from "users" where "email" = $1');
    expect(trimmed).not.toContain("someone@example.com");
  });

  it("caps the length and survives a non-string", () => {
    expect(trimExceptionMessage("y".repeat(1000)).length).toBe(MAX_EXCEPTION_MESSAGE);
    expect(trimExceptionMessage("short")).toBe("short");
    for (const value of [undefined, null, 3, {}]) expect(trimExceptionMessage(value)).toBe("");
  });
});

describe("a server render error, as reported", () => {
  beforeEach(() => resetRequestErrorLimit());

  const thrown = () => {
    const error = new TypeError("Cannot read properties of undefined (reading 'amount')\nparams: a@example.com") as Error & { digest?: string };
    error.stack = `TypeError: ${error.message}\n    at PlanCards (plan-cards.tsx:193:71)\n    at Array.map (<anonymous>)`;
    error.digest = "1234567890";
    return error;
  };

  it("sends the name, the trimmed message, our stack frames, the digest and the route pattern", () => {
    const captureException = vi.fn();
    reportRequestError({ captureException }, thrown(), { method: "GET" }, {
      routerKind: "App Router",
      routePath: "/dashboard/billing",
      routeType: "render",
      renderSource: "react-server-components",
    });
    expect(captureException).toHaveBeenCalledTimes(1);
    const [error, distinctId, properties] = captureException.mock.calls[0]!;
    expect((error as Error).name).toBe("TypeError");
    expect((error as Error).message).toBe("Cannot read properties of undefined (reading 'amount')");
    expect((error as Error).stack).toBe(
      "TypeError: Cannot read properties of undefined (reading 'amount')\n    at PlanCards (plan-cards.tsx:193:71)\n    at Array.map (<anonymous>)"
    );
    // Nobody is named: no user, and the route as a pattern.
    expect(distinctId).toBeUndefined();
    expect(properties).toEqual({
      source: "server",
      route: "/dashboard/billing",
      route_type: "render",
      render_source: "react-server-components",
      method: "GET",
      digest: "1234567890",
    });
    expect(JSON.stringify([(error as Error).message, (error as Error).stack, properties])).not.toContain("example.com");
  });

  it("never sends the request's own path or headers, even when handed them", () => {
    const captureException = vi.fn();
    reportRequestError(
      { captureException },
      new Error("boom"),
      { method: "GET", path: "/dashboard/agent?thread=secret-id", headers: { cookie: "dtrmcp_session=abc" } } as never,
      { routePath: "/dashboard/agent" }
    );
    const sent = JSON.stringify(captureException.mock.calls[0]);
    expect(sent).not.toContain("secret-id");
    expect(sent).not.toContain("dtrmcp_session");
  });

  it("stops reporting a route that keeps failing, and starts again in the next window", () => {
    resetRequestErrorLimit();
    const captureException = vi.fn();
    const report = (route: string, at: number) =>
      reportRequestError({ captureException }, new Error("boom"), {}, { routePath: route }, at);
    for (let i = 0; i < REPORTS_PER_ROUTE + 25; i++) report("/dashboard/billing", 1000 + i);
    expect(captureException).toHaveBeenCalledTimes(REPORTS_PER_ROUTE);
    // Another route is counted on its own.
    report("/dashboard/usage", 2000);
    expect(captureException).toHaveBeenCalledTimes(REPORTS_PER_ROUTE + 1);
    // And the first route reports again once the window has passed.
    report("/dashboard/billing", 1000 + REPORT_WINDOW_MS);
    expect(captureException).toHaveBeenCalledTimes(REPORTS_PER_ROUTE + 2);
  });

  it("does nothing with analytics off, and never throws", () => {
    expect(() => reportRequestError(null, new Error("x"), {}, {})).not.toThrow();
    const failing = { captureException: () => { throw new Error("client down"); } };
    expect(() => reportRequestError(failing, new Error("x"), {}, {})).not.toThrow();
    const captureException = vi.fn();
    reportRequestError({ captureException }, "a string was thrown", {}, {});
    expect((captureException.mock.calls[0]![0] as Error).message).toBe("a string was thrown");
  });

  it("trims a message in the stack's first line too", () => {
    const error = trimmedError(thrown());
    expect(error.stack!.split("\n")[0]).toBe("TypeError: Cannot read properties of undefined (reading 'amount')");
  });
});
