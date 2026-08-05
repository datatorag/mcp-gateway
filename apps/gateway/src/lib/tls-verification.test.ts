import { describe, expect, it } from "vitest";

/**
 * Fails when TLS certificate verification is disabled for this process.
 *
 * `NODE_TLS_REJECT_UNAUTHORIZED=0` turns off certificate verification for
 * every TLS connection Node makes — including the ones this app uses to reach
 * its database and third-party APIs. A process running that way will accept
 * any certificate presented to it.
 *
 * This is not a defect in this repository. The setting is not in any file
 * here; it is inherited from the shell environment. Nothing in this project
 * needs it: with the variable removed the full suite passes, the production
 * build succeeds, and every host this app talks to validates normally.
 *
 * TO GET PAST IT RIGHT NOW, for one command:
 *
 *     env -u NODE_TLS_REJECT_UNAUTHORIZED pnpm vitest run
 *
 * That is a workaround, not a fix. The variable is inherited from a stale
 * process environment rather than set by any config file, so restarting the
 * terminal session clears it.
 *
 * DO NOT delete this test to make the suite green. It fails only when
 * verification is genuinely off and passes the moment the variable is unset,
 * so a failure here is always a true report about the machine it ran on.
 */

/** Node treats exactly "0" as off. Anything else, including unset, leaves
 * verification on, so this cannot fire on a merely unusual value. */
function verificationDisabled(value: string | undefined): boolean {
  return value === "0";
}

describe("TLS certificate verification", () => {
  it("is enabled for this process", () => {
    const value = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    expect(
      verificationDisabled(value),
      "NODE_TLS_REJECT_UNAUTHORIZED=0 is set, so this process accepts ANY " +
        "TLS certificate, including for its database and API connections.\n\n" +
        "This is not a bug in this repo — the setting is not in any file " +
        "here, and nothing in this project needs it.\n\n" +
        "Unblock this command:  env -u NODE_TLS_REJECT_UNAUTHORIZED pnpm vitest run\n" +
        "Actually fix it:       restart the terminal session — it is inherited\n" +
        "                       from a stale process environment, not set by a config file."
    ).toBe(false);
  });

  /** Guards the guard. A predicate that stopped recognising the dangerous
   * value would go green and read as protection — the failure mode a pattern
   * check has that a behavioural one does not. */
  it("still recognises the dangerous value", () => {
    expect(verificationDisabled("0")).toBe(true);
    expect(verificationDisabled("1")).toBe(false);
    expect(verificationDisabled(undefined)).toBe(false);
    expect(verificationDisabled("")).toBe(false);
  });
});
