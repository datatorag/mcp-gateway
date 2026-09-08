import {
  getAllSkills,
  getSkillBySlug,
  servicesFor,
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
    situation: skill.situation,
    produces: skill.produces,
    tools: skill.tools,
    needs,
    runnable: needs.every((n) => n.connected),
  };
}

/** Case-insensitive substring search over title, situation, produces, slug
 * and tool names. An empty query is the whole catalogue, in authored order. */
export function searchSkills(query: string | undefined | null): Skill[] {
  const all = getAllSkills();
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
  const lines: string[] = [];
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
  return `${lines.join("\n")}\n\n${skillRunMessage(skill)}`;
}

export function findSkill(slug: unknown): Skill | null {
  return typeof slug === "string" ? getSkillBySlug(slug) : null;
}
