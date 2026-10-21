/**
 * SCRUM-366: the service detail page carries a Connect control, so a service
 * whose plugin has not launched has no page: the same not-found as a service
 * that does not exist. Google and Atlassian render as before.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ getSessionUserId: vi.fn(async () => "user-1") }));
vi.mock("@/lib/db", () => ({ db: { marker: "db" } }));
const isServiceLaunched = vi.fn();
vi.mock("@/gateway/service-launch", () => ({
  isServiceLaunched: (...args: unknown[]) => isServiceLaunched(...args),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  },
}));
vi.mock("./client", () => ({ ConnectionDetailClient: () => null }));

const { default: ConnectionDetailPage } = await import("./page");

const render = (service: string) =>
  ConnectionDetailPage({ params: Promise.resolve({ service }) });

describe("/dashboard/connections/[service] and the launch gate", () => {
  beforeEach(() => isServiceLaunched.mockReset());

  it("is not found for Notion while it has not launched", async () => {
    isServiceLaunched.mockResolvedValue(false);
    await expect(render("notion")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(isServiceLaunched).toHaveBeenCalledWith({ marker: "db" }, "notion");
  });

  it("renders Notion once launched", async () => {
    isServiceLaunched.mockResolvedValue(true);
    await expect(render("notion")).resolves.toBeTruthy();
  });

  it("renders Google Workspace and Atlassian through the same check, which answers them true", async () => {
    const { isServiceLaunched: real } = await vi.importActual<
      typeof import("@/gateway/service-launch")
    >("@/gateway/service-launch");
    isServiceLaunched.mockImplementation(real);
    // A db that would fail the test if it were read.
    await expect(render("google-workspace")).resolves.toBeTruthy();
    await expect(render("atlassian")).resolves.toBeTruthy();
  });

  it("is not found for a service that does not exist, before any launch check", async () => {
    await expect(render("dropbox")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(isServiceLaunched).not.toHaveBeenCalled();
  });
});
