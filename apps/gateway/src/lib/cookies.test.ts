import { describe, expect, it } from "vitest";
import { oneShotCookie, SESSION_COOKIE } from "./cookies";

describe("cookies", () => {
  it("keeps the session cookie's name: a rename signs every browser out", () => {
    expect(SESSION_COOKIE).toBe("dtrmcp_session");
  });

  it("a one-shot cookie is httpOnly, Lax, site-wide and ten minutes long", () => {
    expect(oneShotCookie(true)).toEqual({ httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 600_000 });
    expect(oneShotCookie(false, "/auth/x/connect")).toMatchObject({ secure: false, path: "/auth/x/connect" });
  });
});
