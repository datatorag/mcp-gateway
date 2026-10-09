import { posthogState } from "@/lib/posthog-server";

/** The `/health` body (SCRUM-228): `status` as before, plus the analytics
 * state with its reason, so a production box that went quiet is a readable
 * "off" rather than an absence in the analytics project. The smoke suite
 * asserts `analytics: "on"` against production.
 *
 * `plugins` (SCRUM-390) is each active plugin with `up` or `down`, where
 * `down` means the manager has stopped starting it. `status` stays `ok` and
 * the route stays 200 with a plugin down, on purpose: the container's health
 * check and the deploy's health wait read only that, and a plugin that cannot
 * start must not make the gateway itself look dead. A person reads the field. */
export function healthBody(plugins: Record<string, "up" | "down">): {
  status: "ok";
  analytics: "on" | "off";
  analytics_reason: string;
  plugins: Record<string, "up" | "down">;
} {
  return { status: "ok", ...posthogState(), plugins };
}
