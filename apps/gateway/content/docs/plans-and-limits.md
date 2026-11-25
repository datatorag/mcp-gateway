---
title: "Plans and limits"
searchTitle: "Free and Pro Plan Limits for MCP Tool Calls | DataToRAG"
description: "What the DataToRAG Free and Pro plans include, what happens when you reach a tool-call or agent-run limit, and when the allowance resets."
order: 5.5
section: "general"
faqs:
  - q: How many tool calls does the DataToRAG free plan include?
    a: >-
      The Free plan of DataToRAG includes {{plan.free.calls}} tool calls and
      {{plan.free.runs}} agent and skill runs per period. A period is one
      month. Pro includes {{plan.pro.calls}} tool calls and {{plan.pro.runs}}
      runs.
  - q: What happens when I reach the free tool-call limit?
    a: >-
      The next call to a Google Workspace, Atlassian, or Notion tool is refused
      before it runs. The answer says
      the monthly free-plan limit is reached and that the allowance resets at
      the start of your next period. DataToRAG does not count the refused call,
      and the call never reaches Google, Atlassian, or Notion.
  - q: Does Pro stop when I pass the included tool calls?
    a: >-
      No. Pro has no stop on tool calls. The {{plan.pro.calls}} calls are what
      the DataToRAG Pro plan includes and where the Billing page draws the line
      on its meter. Agent and skill runs are different. They stop at the plan's
      number on both Free and Pro.
  - q: When does my allowance reset?
    a: >-
      One month after the period started. The first period starts when your
      DataToRAG account is created, so the reset is not tied to the calendar
      month. The Billing page in the DataToRAG dashboard shows the date.
  - q: Do tool calls from my own client use up agent runs?
    a: >-
      No. Agent runs are used only by the dashboard Agent and by skill runs in the
      DataToRAG dashboard. A call from Claude, ChatGPT, Cursor, or another MCP
      client counts as a tool call only.
---

DataToRAG is an MCP server that connects your agent to Google Workspace, Atlassian, and Notion. This page lists what the Free and Pro plans include and says what happens when you reach each limit. Every number on this page is filled in from the code that enforces it.

## What each plan includes

| | Free | Pro |
|---|---|---|
| Tool calls per period | {{plan.free.calls}} | {{plan.pro.calls}} included |
| When you reach that number | Tool calls are refused until the allowance resets | Nothing is refused |
| Agent and skill runs per period | {{plan.free.runs}} | {{plan.pro.runs}} |
| When you reach that number | No new run starts until the allowance resets | No new run starts until the allowance resets |
| More than one account per service | Yes | Yes |

A period is one month. Prices are on the [Pricing](/pricing) page. Your current plan and what you have used are on the [Billing](https://datatorag.com/dashboard/billing) page of the dashboard.

There are two separate allowances. Tool calls are counted wherever they come from. Agent and skill runs are used only in the dashboard.

## What counts as a tool call

A call to a Google Workspace, Atlassian, or Notion tool counts when it succeeds, and when the service answers with an error about the request itself. It does not count when the failure is on our side or the provider's side. [Usage & Metrics](/docs/usage) has the full rule.

Calls from the dashboard Agent count the same way as calls from your own client.

Built-in tools, the ones the DataToRAG MCP server answers itself, do not count. These include `list_connected_accounts`, `connect`, and the `skills_*` tools. The two file link tools, `file_download_link` and `file_upload_link`, are the exception and do count.

## When Free reaches its tool-call limit

The check happens before a call runs. Once you have used {{plan.free.calls}} tool calls in the period, the next call to a Google Workspace, Atlassian, or Notion tool is refused with this message:

> Monthly free-plan limit reached ({{plan.free.calls}} tool calls). Your allowance resets at the start of your next period, or upgrade to Pro from the dashboard for a higher allowance.

- The refused call is not sent to the provider and is not counted.
- The built-in tools that do not count, such as `list_connected_accounts`, keep answering. The two file link tools count, so they are refused as well.
- The plan is read on every call. After you upgrade, the next call is checked against Pro.

## When Pro passes its included tool calls

Nothing is refused. {{plan.pro.calls}} is the number the plan includes and where the Billing page draws the line on its meter. Calls past it run as before.

## When you run out of agent and skill runs

A run is one message you send to the [dashboard Agent](https://datatorag.com/dashboard/agent), or one skill run started there. Approving a change the dashboard Agent paused on does not use another run.

Free includes {{plan.free.runs}} runs per period and Pro includes {{plan.pro.runs}}. At that number, on either plan, a new run does not start until the allowance resets. A run that is already going is not cut off.

A run that fails before it produces anything is given back to your allowance. A run you stop yourself is not.

Runs are a dashboard allowance only. Work your agent does in Claude, ChatGPT, Cursor, or another MCP client uses tool calls and no runs. [Skills](/docs/skills) explains how a skill run counts in each place.

## Limits on a single run

Two limits apply to each run in the dashboard, on every plan.

- **Steps.** A step is one call to the model, and one step can make several tool calls. A message to the dashboard Agent can take up to {{run.steps.chat}} steps and a skill run up to {{run.steps.skill}}. At the limit the run stops and says it reached its step limit.
- **Size.** A run also has a size limit, which is the same on every plan. The step that reaches it finishes normally, and the run stops before the next step starts. The dashboard Agent says the run reached its size limit.

In both cases, everything the run already finished is saved. Nothing is cut off in the middle of a step.

## When the allowance resets

- Tool calls and runs share one period, and both counts go back to zero together.
- A period lasts one month. The first one starts when your DataToRAG account is created. It does not follow the calendar month.
- A new period starts the first time you use DataToRAG after the month is over. If you were away for longer than a month, it starts when you come back.
- The Billing page shows the date as "Resets", or "Your allowance resets on your next call." when the month is already over.
- Unused calls and runs do not carry over.

## Related pages

- [Pricing](/pricing): what each plan costs.
- [Usage & Metrics](/docs/usage): what was called, and the Billing page.
- [Using several accounts](/docs/multiple-accounts): every plan allows more than one account per service.
- [Skills](/docs/skills): running a skill and what it counts as.
