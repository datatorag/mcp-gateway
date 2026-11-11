import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { envSchema } from "@datatorag-mcp/config";

/* SCRUM-76: the production compose file lists the container's environment
 * one name at a time, so a setting the config schema declares and the file
 * leaves out never reaches the process. The deploy still succeeds and the
 * health check stays green: the salt was missing that way for months, and
 * every salted key in production was null.
 *
 * So every name the schema declares is either passed through, or named
 * below with the reason it is not. A new setting fails here until someone
 * decides which. */
const NOT_PASSED: Record<string, string> = {
  GATEWAY_SHA: "baked into the image at build time (Dockerfile ENV)",
  GATEWAY_PORT: "set to 80 in the file itself",
  NODE_ENV: "set to production in the file itself",
  TEST_RUNNER_ENVIRONMENT: "set to prod in the file itself",
  CRON_SECRET: "read by nothing",
  SKILLS_DENYLIST: "read only by a test, on a laptop",
  PLUGIN_MCP_URLS: "read only by a test, on a laptop",
  DOCKER_HOST_OVERRIDE: "development against remote plugins only",
  POSTHOG_ALLOW_NONPRODUCTION: "lets a non-production process send analytics; production sends without it",
  STRIPE_METER_ID: "metered billing, not built",
  STRIPE_METER_EVENT_NAME: "metered billing, not built",
  STRIPE_PAYG_PRICE_ID: "metered billing, not built",
  LEADS_CONFIRMATION_FROM:
    "the schema's default is the production sender; an empty pass-through would replace it with nothing, so it is added only with a value",
};

const compose = readFileSync(path.resolve(process.cwd(), "../../docker/docker-compose.prod.yml"), "utf8");
/** The value the file gives a name in the gateway's `environment`. */
const passed = (name: string) => compose.match(new RegExp(`^      ${name}: (.+)$`, "m"))?.[1];

describe("the production compose file passes the config through (SCRUM-76)", () => {
  it.each(Object.keys(envSchema.shape))("%s is passed through, or excluded with a reason", (name) => {
    if (name in NOT_PASSED) return;
    expect(passed(name), `${name} is declared by the config schema and missing from docker-compose.prod.yml`).toBeDefined();
  });

  it("names nothing as excluded that the schema no longer declares", () => {
    for (const name of Object.keys(NOT_PASSED)) expect(envSchema.shape).toHaveProperty(name);
  });

  it("passes the salt from the host with no fallback value", () => {
    expect(passed("LEADS_IP_SALT")).toBe("${LEADS_IP_SALT:-}");
  });

  it("falls back to the gateway's own base URL for the links in emails, never the localhost default", () => {
    expect(passed("PUBLIC_APP_URL")).toBe("${PUBLIC_APP_URL:-${GATEWAY_BASE_URL:-http://localhost}}");
  });
});
