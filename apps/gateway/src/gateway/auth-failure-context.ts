import { createHash } from "node:crypto";
import { isIP } from "node:net";
import type { Request } from "express";
import type { McpAuthState } from "./bearer-auth";
import { requestClientIp } from "./client-ip";
import { cleanClientName, cleanUserAgent } from "./untrusted-text";

/**
 * What a refused /mcp request says about its caller (SCRUM-464), for the
 * `mcp_auth_failed` event: enough to tell a scanner from a misconfigured
 * client from a real user with an expired token, and nothing that is a
 * credential or a person.
 *
 * Never a token, a token hash or an email. The peer is never stored raw: it
 * is a salted hash (to count and group distinct callers) and its network
 * prefix (to tell one range from another). The hash is only as private as
 * its salt: an unsalted hash of an IPv4 address reverses by brute force, in
 * at most 256 tries once the /24 is known, so with no salt configured there
 * is no hash at all, only the prefix.
 */
export type AuthFailureDetail =
  | "no_header"
  | "malformed"
  | "unknown_prefix"
  | "expired"
  | "revoked"
  | "wrong_token_kind";

export type AuthFailureContext = {
  path: string;
  user_agent: string | null;
  client_name: string | null;
  client_version: string | null;
  reason_detail: AuthFailureDetail;
  bearer_present: boolean;
  /** Null when no salt is configured: see the module comment. */
  peer_hash: string | null;
  peer_prefix: string | null;
};

/** The path without its query string, which can carry anything. */
function pathOf(req: Pick<Request, "originalUrl" | "path">): string {
  const raw = (req.originalUrl ?? req.path ?? "").split("?")[0] ?? "";
  return raw.slice(0, 120);
}

/** IPv4 to its /24, IPv6 to its /48; null for anything else. */
export function networkPrefix(ip: string): string | null {
  const v = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  if (isIP(v) === 4) return `${v.split(".").slice(0, 3).join(".")}.0/24`;
  if (isIP(v) === 6) {
    const [head] = v.split("::");
    const groups = head.split(":").filter(Boolean);
    while (groups.length < 3) groups.push("0");
    return `${groups.slice(0, 3).join(":")}::/48`;
  }
  return null;
}

/** A salted hash of the peer, short: for counting, not for finding anyone.
 * Null without a salt, because an unsalted one is the IP in disguise. */
export function peerHash(ip: string, salt: string): string | null {
  if (salt.trim() === "") return null;
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex").slice(0, 16);
}

function detailOf(state: McpAuthState): AuthFailureDetail {
  if (state.header === "missing") return state.authorization === "absent" ? "no_header" : "malformed";
  if (state.emptyToken) return "malformed";
  if (state.auth.ok) throw new Error("detailOf called on an accepted bearer");
  switch (state.auth.reason) {
    case "expired":
      return "expired";
    case "revoked":
      return "revoked";
    case "wrong_token_kind":
      return "wrong_token_kind";
    default:
      // A bearer that matches no token this gateway issued.
      return "unknown_prefix";
  }
}

export function authFailureContext(
  req: Request,
  state: McpAuthState,
  clientInfo: { name?: string; version?: string },
  salt: string
): AuthFailureContext {
  const ip = requestClientIp(req);
  return {
    path: pathOf(req),
    user_agent: cleanUserAgent(req.headers["user-agent"]),
    client_name: cleanClientName(clientInfo.name),
    client_version: cleanClientName(clientInfo.version),
    reason_detail: detailOf(state),
    bearer_present: state.header === "present" && !state.emptyToken,
    peer_hash: peerHash(ip, salt),
    peer_prefix: networkPrefix(ip),
  };
}
