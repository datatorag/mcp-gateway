/**
 * `requireAdminPage` (SCRUM-302): who it refuses, and how.
 *
 * "How" is the load-bearing half. It throws Next's not-found rather than
 * redirecting or returning anything, so the refusal renders the app's own 404
 * page — the same page a URL with no route gets, because it is the same code
 * path.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionUserId = vi.fn();
vi.mock("@/lib/session", () => ({ getSessionUserId: () => getSessionUserId() }));

const isAdmin = vi.fn();
vi.mock("./admin", () => ({ isAdmin: (...a: unknown[]) => isAdmin(...a) }));

vi.mock("@/lib/db", () => ({ db: {} }));

import { requireAdminPage } from "./admin-page";

const NOT_FOUND_DIGEST = "NEXT_HTTP_ERROR_FALLBACK;404";

beforeEach(() => {
  getSessionUserId.mockReset();
  isAdmin.mockReset();
});

describe("requireAdminPage", () => {
  it("returns the user id for an admin, so the page need not read the session twice", async () => {
    getSessionUserId.mockResolvedValue("admin-user");
    isAdmin.mockResolvedValue(true);
    await expect(requireAdminPage()).resolves.toBe("admin-user");
  });

  it("throws Next's not-found for a signed-in non-admin", async () => {
    getSessionUserId.mockResolvedValue("ordinary-user");
    isAdmin.mockResolvedValue(false);
    await expect(requireAdminPage()).rejects.toMatchObject({ digest: NOT_FOUND_DIGEST });
  });

  it("throws the SAME not-found when there is no session, never a redirect", async () => {
    // Unreachable in production, because the middleware bounces an anonymous
    // request to login before the page renders. It is here because "the
    // middleware will have handled it" is exactly the assumption that stops
    // being true when someone adds a route group, so the page guard must not
    // depend on it. A redirect here would also be the one shape that differs.
    getSessionUserId.mockResolvedValue(null);
    await expect(requireAdminPage()).rejects.toMatchObject({ digest: NOT_FOUND_DIGEST });
    expect(isAdmin).not.toHaveBeenCalled();
  });
});
