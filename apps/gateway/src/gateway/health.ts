import { posthogState } from "@/lib/posthog-server";

/** The `/health` body (SCRUM-228): `status` as before, plus the analytics
 * state with its reason, so a production box that went quiet is a readable
 * "off" rather than an absence in the analytics project. The smoke suite
 * asserts `analytics: "on"` against production. */
export function healthBody(): {
  status: "ok";
  analytics: "on" | "off";
  analytics_reason: string;
} {
  return { status: "ok", ...posthogState() };
}
