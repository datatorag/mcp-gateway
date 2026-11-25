---
title: "Skills"
searchTitle: "Skills for MCP Clients: Find, Run, and Edit | DataToRAG"
description: "Find a DataToRAG skill in the public catalog, run it from the dashboard or your own client, make your own version, and see how a run counts."
order: 2
section: "general"
faqs:
  - q: What is a DataToRAG skill?
    a: >-
      A skill is a written routine that tells an agent which DataToRAG tools to
      use on your connected accounts, and in what order. The published ones are
      listed in the [skill catalog](/skills). You can run one from the DataToRAG
      dashboard, load one into your own client, or save a version of your own.
  - q: Does a skill run ask before it changes something?
    a: >-
      Not when you run it from the Skills page of the DataToRAG dashboard. An
      ordinary conversation with the dashboard Agent pauses before a change and
      waits for your approval. A skill run does not pause, so clicking Run is
      the approval. Of the Google Workspace, Atlassian, and Notion tools, the run can call
      only the ones its skill names.
      In your own client, the client's approval settings apply.
  - q: What does a skill run count as against my plan?
    a: >-
      A run from the DataToRAG dashboard counts as one agent run, and each
      call it makes to a Google Workspace, Atlassian, or Notion tool counts as
      a tool call. A skill you load into
      your own client uses no agent run, only the tool calls it makes.
      [Plans and limits](/docs/plans-and-limits) has the numbers for each plan.
  - q: Can I edit a published skill?
    a: >-
      Not directly. Fork it first. A fork is your own copy with the same slug,
      and DataToRAG runs your version in its place for you only. Every save of
      your version is a new version, and deleting your version brings the
      published skill back.
  - q: Can other people see a skill I wrote?
    a: >-
      No. A skill you save is private to your DataToRAG account. Only the
      published skills are in the public catalog.
---

DataToRAG is an MCP server that gives your agent tools for Google Workspace, Atlassian, and Notion. A skill is a written routine that tells the agent which of those tools to use and in what order. This page covers where to find skills, how to run one, how to make your own version, and what a run counts as against your plan.

## Find a skill in the public catalog

The catalog is at [datatorag.com/skills](/skills). Each skill has its own page with the situation it is for, what it produces, the tools it uses, and the skill file itself with a copy button. The [morning brief](/skills/morning-brief) is one example.

You do not need an account to read the catalog. To use a skill, you need DataToRAG connected to the accounts the skill works on. [Getting Started](/docs/getting-started) covers that.

## Run a skill from the dashboard

1. Sign in and open [Skills](https://datatorag.com/dashboard/skills) in the dashboard. It lists the published skills and your own.
2. Each card shows the services the skill needs and whether you have them connected.
3. Click **Run**. The Agent page opens and the run starts. If a service is missing, the button reads **Connect and run**, and you connect the service before the run starts.

A run from this page differs from an ordinary dashboard Agent conversation in three ways:

- **It does not pause for approval.** In an ordinary conversation the dashboard Agent stops before anything that changes your data and waits for you. A skill run does not, so read what the skill does before you click Run.
- **It gets a short list of tools.** The run can call the Google Workspace, Atlassian, and Notion tools its skill names and the read-only built-in tools. It cannot create download or upload links, and it cannot create, change, or delete skills.
- **It has its own step limit.** A skill run can take up to {{run.steps.skill}} steps. [Plans and limits](/docs/plans-and-limits) explains the limits on a single run.

Some skills work on several accounts. They still make one call per account. [Using several accounts](/docs/multiple-accounts) explains how a call picks its account.

## Run a skill from your own client

A skill also works in Claude, ChatGPT, Cursor, or any MCP client that has DataToRAG added.

- **As a prompt.** DataToRAG serves each skill as an MCP prompt named by its slug, with an optional `account` argument. In a client that shows MCP prompts, pick the skill from its prompt list.
- **As a tool call.** Ask your agent to find and load a skill. It calls `skills_search`, then `skills_get`, and follows the skill file that comes back.
- **By copying.** Copy the skill file from its catalog page into your conversation.

In your own client, your client's model does the work and your client's approval settings apply.

## Make your own version of a skill

On the dashboard Skills page:

- **Fork** copies a published skill into your own skills and keeps its slug. Your version then runs in its place, for you only. The card is labeled **Your version**.
- **Edit** changes your version. Every save is a new version, and the previous one is kept.
- **Delete** removes your version. If it was a fork, the published skill comes back.
- **New skill** saves a skill you write yourself. It is private to you.

There is a limit on how many skills of your own you can keep. The dashboard tells you when you reach it.

## The skills tools

Your agent can do the same from a conversation. DataToRAG serves six skills tools.

| Tool | What it does |
|---|---|
| `skills_search` | Searches the skill catalog. Returns each matching skill's slug, title, the situation it is for, what it produces, the tools it uses, the services it needs, and whether you have them connected. Omit the search text to list every skill. |
| `skills_get` | Loads one skill into the session. Returns the skill file to follow, with a preface that says which of its services you have connected and which account the run will use. Pass `account` to choose the account. Otherwise the default account is used. |
| `skills_create` | Saves a new skill of your own, private to you. Takes the title, the situation it is for, what it produces, the skill file as markdown, the tools it uses, and whether it runs on a single account or several. Answers with the slug and version. |
| `skills_update` | Saves a new version of one of your own skills. The previous version is kept. A published skill cannot be edited. Fork it first. |
| `skills_fork` | Copies a published skill into your own skills and keeps its slug, so your version runs in its place for you. Records which published version it came from. |
| `skills_delete` | Deletes one of your own skills. If it was your version of a published skill, the published one is available to you again. |

`skills_search` and `skills_get` only read. The other four change your saved skills, so the dashboard Agent asks for your approval before it runs one of them.

## What a skill run counts as

- **A run from the dashboard** counts as one agent run. Free includes {{plan.free.runs}} agent and skill runs per period and Pro includes {{plan.pro.runs}}. Each call the run makes to a Google Workspace, Atlassian, or Notion tool also counts as a tool call.
- **A skill in your own client** uses no agent run. The calls it makes to Google Workspace, Atlassian, and Notion tools count as tool calls, like any other.
- **The skills tools themselves** do not count as tool calls.

When you have no runs left, a new run does not start until the allowance resets. [Plans and limits](/docs/plans-and-limits) says when that is.

## Related pages

- [Skill catalog](/skills) and the [morning brief](/skills/morning-brief).
- [Skills are live](/blog/skills-are-live): the announcement.
- [Usage & Metrics](/docs/usage): where runs and tool calls are shown.
