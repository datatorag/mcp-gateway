import type { TestCase } from "../types";
import { resultJson } from "../result-json";

type Link = { id?: string; type?: string; relation?: string; issue?: { key?: string } };
type LinkType = { name?: string; inward?: string; outward?: string };
type Links = { links?: Link[]; link_types?: LinkType[] };

/**
 * JR12 (Jira scenario, SCRUM-428): a link made with `jira_link_issues` reads
 * the right way round from BOTH issues, through `jira_list_issue_links`.
 *
 * The direction is the point. Jira's issueLink resource names its two ends
 * the opposite way from the link type's phrases, so a handler that sent them
 * the other way round would still make a link and still answer. Only reading
 * each side shows it: A must say the outward phrase of B, and B the inward
 * phrase of A. The type is the site's Blocks type when it has one, because
 * its two phrases differ; a type whose phrases are the same (Relates) could
 * not tell the two directions apart.
 *
 * Two issues made here and deleted here; deleting them removes the link.
 */
export const jr12JiraLinks: TestCase = {
  id: "JR12",
  title: "a link between two issues reads the right way round from each of them",
  covers: [
    "atlassian-mcp__jira_create_issue",
    "atlassian-mcp__jira_link_issues",
    "atlassian-mcp__jira_list_issue_links",
    "atlassian-mcp__jira_delete_issue",
  ],
  accounts: ["atlassian"],
  fixtures: ["jiraProject"],
  timeoutMs: 150_000,
  run: async (ctx) => {
    const keys: string[] = [];
    for (const label of ["A", "B"]) {
      const key = resultJson<{ key?: string }>(
        "jira_create_issue",
        await ctx.call(
          "atlassian-mcp__jira_create_issue",
          { project_key: ctx.fixture("jiraProject"), summary: `[smoke] JR12 ${label} ${ctx.stamp}` },
          { as: "atlassian" }
        )
      ).key;
      if (!key) throw new Error(`jira_create_issue answered without a key for issue ${label}`);
      keys.push(key);
      ctx.defer(`delete issue ${label}`, async () => {
        const gone = await ctx.call("atlassian-mcp__jira_delete_issue", { issue_key: key }, { as: "atlassian" });
        if (gone.isError) ctx.evidence(`RESIDUE: issue ${label} could not be deleted and is still on the board`);
      });
    }
    const [a, b] = keys;

    const linksOf = async (issue_key: string) =>
      resultJson<Links>("jira_list_issue_links", await ctx.call("atlassian-mcp__jira_list_issue_links", { issue_key }, { as: "atlassian" }));

    const start = await linksOf(a);
    if (!Array.isArray(start.links) || start.links.length !== 0) throw new Error("a new issue already carries links, or its links could not be read");
    const types = start.link_types ?? [];
    const type = types.find((t) => t.name === "Blocks") ?? types.find((t) => t.inward && t.outward && t.inward !== t.outward);
    if (!type?.name || !type.inward || !type.outward) throw new Error("the site lists no link type whose two phrases differ, so a direction cannot be checked");
    ctx.evidence(`linking with ${type.name}: "${type.outward}" / "${type.inward}"`);

    const made = resultJson<{ linked?: Link[] }>(
      "jira_link_issues",
      await ctx.call("atlassian-mcp__jira_link_issues", { issue_key: a, other_issue_key: b, link_type: type.outward }, { as: "atlassian" })
    );
    if ((made.linked ?? []).length !== 1) throw new Error(`jira_link_issues reports ${(made.linked ?? []).length} matching link(s), not one`);

    const fromA = (await linksOf(a)).links ?? [];
    const fromB = (await linksOf(b)).links ?? [];
    ctx.evidence(`A reads "${fromA[0]?.relation} ${fromA[0]?.issue?.key}"; B reads "${fromB[0]?.relation} ${fromB[0]?.issue?.key}"`);
    if (fromA.length !== 1 || fromA[0].issue?.key !== b || fromA[0].relation !== type.outward) {
      throw new Error(`issue A should read "${type.outward} ${b}" and reads ${JSON.stringify(fromA)}`);
    }
    if (fromB.length !== 1 || fromB[0].issue?.key !== a || fromB[0].relation !== type.inward) {
      throw new Error(`issue B should read "${type.inward} ${a}" and reads ${JSON.stringify(fromB)}`);
    }
  },
};
