/**
 * Analytics is OFF outside production unless someone says otherwise
 * (SCRUM-228). One pure rule for both clients, the server one in
 * `posthog-server.ts` and the browser one in `posthog-provider.tsx`, so
 * they cannot disagree; no env import here, because the browser reads
 * `process.env` inlined by Next and the server reads the validated config.
 *
 * The answer carries its reason so `/health` can show it: a guard that can
 * turn analytics off is a guard that can turn it off by accident (a
 * production box with NODE_ENV unset), and the only symptom of that would
 * be an absence nobody notices. Readable state is the fix.
 */

/** The server-side flag, spelled the way the env file spells it. The
 * browser reads the same name with the `NEXT_PUBLIC_` prefix. */
export const POSTHOG_ALLOW_FLAG = "POSTHOG_ALLOW_NONPRODUCTION";

export type PosthogPolicy = { on: boolean; reason: string };

export function posthogPolicy(input: {
  nodeEnv: string | undefined;
  allow: string | undefined;
  hasKey: boolean;
}): PosthogPolicy {
  const env = input.nodeEnv || "unset";
  if (!input.hasKey) return { on: false, reason: `no key (NODE_ENV=${env})` };
  if (input.nodeEnv === "production") return { on: true, reason: "production" };
  if (input.allow === "1") return { on: true, reason: `${env}, allowed by ${POSTHOG_ALLOW_FLAG}=1` };
  return {
    on: false,
    reason: `outside production (NODE_ENV=${env}); set ${POSTHOG_ALLOW_FLAG}=1 to send`,
  };
}
