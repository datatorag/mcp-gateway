import {
  getAllSkills,
  getSkillBySlug,
  servicesFor,
  runAccountsFrom,
  skillRunMessage,
  type Skill,
} from "@/lib/skills";

/**
 * The published skill catalogue as the MCP surface answers it (SCRUM-224).
 *
 * ONE CATALOGUE. Everything here reads `lib/skills.ts`, the same collection
 * the public pages and the dashboard read, and composes nothing that is not
 * a catalogue field, a fixed sentence, or a service or account name. The
 * boundary test over every published skill therefore covers what the wire
 * carries, and the prompt and the tool hand a model the same bytes.
 *
 * Pure: the connection state is passed in, so every answer here is testable
 * without a database and cannot disagree between the prompt path and the
 * tool path.
 */

const SERVICE_NAMES: Record<string, string> = {
  "google-workspace": "Google Workspace",
  atlassian: "Atlassian",
};

export function serviceName(id: string): string {
  return SERVICE_NAMES[id] ?? id;
}

export type ConnectedAccountLite = {
  connectorType: string;
  accountEmail: string;
  isDefault: boolean;
};

export type SkillNeed = { service: string; name: string; connected: boolean };

export type SkillSummary = {
  slug: string;
  title: string;
  /** "published" or "yours" (SCRUM-226). */
  layer: Skill["layer"];
  situation: string;
  produces: string;
  tools: string[];
  needs: SkillNeed[];
  /** Every service the skill needs is connected for this user. */
  runnable: boolean;
};

export function skillNeeds(skill: Skill, connected: ReadonlySet<string>): SkillNeed[] {
  return servicesFor(skill).map((service) => ({
    service,
    name: serviceName(service),
    connected: connected.has(service),
  }));
}

export function skillSummary(skill: Skill, connected: ReadonlySet<string>): SkillSummary {
  const needs = skillNeeds(skill, connected);
  return {
    slug: skill.slug,
    title: skill.title,
    layer: skill.layer,
    situation: skill.situation,
    produces: skill.produces,
    tools: skill.tools,
    needs,
    runnable: needs.every((n) => n.connected),
  };
}

/** Case-insensitive substring search over title, situation, produces, slug
 * and tool names. An empty query is the whole catalogue, in authored order. */
export async function searchSkills(viewer: string | null, query: string | undefined | null): Promise<Skill[]> {
  const all = await getAllSkills(viewer);
  const q = (query ?? "").trim().toLowerCase();
  if (!q) return all;
  return all.filter((skill) =>
    [skill.slug, skill.title, skill.situation, skill.produces, ...skill.tools]
      .join(" ")
      .toLowerCase()
      .includes(q)
  );
}

/**
 * The text that puts a skill in front of a model's session, with the
 * connection preface first (SCRUM-224): which of the skill's services this
 * user has, where to connect a missing one, and WHICH ACCOUNT the run will
 * use. The account line is the ruling: a single-account answer to a
 * multi-account user is the documented failure shape, so the text names the
 * account rather than leaving it implicit. Then `skillRunMessage(skill)`,
 * byte for byte, which is the same string the dashboard run submits.
 */
export function skillApplyText(
  skill: Skill,
  opts: {
    connected: ReadonlySet<string>;
    accounts: ConnectedAccountLite[];
    /** The account the client asked for, if any. Honoured only when it is
     * one of the user's connected accounts. */
    account?: string | null;
    connectionsUrl: string;
  }
): string {
  // Which layer is running, said first (per HQ decision): a fork shadows
  // the published skill for its owner, and every surface names which one.
  const lines: string[] = [
    skill.layer === "yours"
      ? `This is your version of the skill${skill.forkedFrom ? ", forked from the published one" : ""}.`
      : "This is the published skill.",
  ];
  for (const need of skillNeeds(skill, opts.connected)) {
    if (!need.connected) {
      lines.push(
        `This skill needs ${need.name}, which is not connected. Connect it at ${opts.connectionsUrl} and ask for the skill again.`
      );
      continue;
    }
    const forService = opts.accounts.filter((a) => a.connectorType === need.service);
    const requested = opts.account
      ? forService.find((a) => a.accountEmail.toLowerCase() === opts.account!.trim().toLowerCase())
      : undefined;
    const chosen = requested ?? forService.find((a) => a.isDefault) ?? forService[0];
    if (chosen) {
      const others = forService.length - 1;
      lines.push(
        `${need.name} is connected. This run will use ${chosen.accountEmail}` +
          (others > 0
            ? `; you also have ${others} other ${need.name} account${others === 1 ? "" : "s"} connected, so pass account explicitly where the skill says to.`
            : ".")
      );
    } else {
      lines.push(`${need.name} is connected.`);
    }
  }
  const runAccounts = runAccountsFrom(
    opts.accounts.map((a) => ({
      connectorType: a.connectorType,
      accountEmail: a.accountEmail,
      isDefault: a.isDefault,
    }))
  );
  return `${lines.join("\n")}\n\n${skillRunMessage(skill, runAccounts)}`;
}

/** The one place a request value is ever reflected back to the requester
 * (an unknown prompt name, tool name, server slug or skill slug). A caller must never get an
 * arbitrary-length string of their own choosing echoed, and never a control
 * character, so: strings only, control characters removed, capped at 64
 * with the cut marked. Anything else reflects as nothing. */
export const ECHO_MAX = 64;
export function echoName(value: unknown): string {
  if (typeof value !== "string") return "";
  // eslint-disable-next-line no-control-regex
  // Control (Cc) and format (Cf) characters: ASCII and C1 controls, and the
  // bidi overrides that can make a reflected string read backwards.
  const printable = value.replace(/[\p{Cc}\p{Cf}]/gu, "");
  return printable.length > ECHO_MAX ? printable.slice(0, ECHO_MAX) + "..." : printable;
}

/** What kind of skill led the results. Every skill is a published one today;
 * the value exists so the event keeps its shape when user-owned skills join
 * the catalogue. */
export function topResultKind(matches: readonly Skill[]): "published" | null {
  return matches.length > 0 ? "published" : null;
}

export async function findSkill(viewer: string | null, slug: unknown): Promise<Skill | null> {
  return typeof slug === "string" ? getSkillBySlug(slug, viewer) : null;
}
