---
title: "MCP Isn't Dead. You're Just Building for Yourself."
excerpt: "The 'just use CLIs' crowd has a point. But it only holds if every user of your tool is a developer with a terminal open."
date: "2026-04-02"
updated: "2026-11-17"
updatedNote: "November 17, 2026: the post said Google Workspace has no CLI. Google publishes one, gws; it needs a Cloud project and local credentials."
author: "Manuel Yang"
category: "Opinion"
coverImage: "/blog/mcp-vs-cli.png"
tags: ["mcp", "oauth", "architecture"]
---

There's a take going around that MCP is dead. That CLIs and skills make it redundant. That the protocol overhead isn't worth it when you can just pipe shell commands into your agent.

For developers building tools for themselves, this is a reasonable position. I don't think it's wrong. I think it's incomplete.

## The CLI argument, and why it's half right

A CLI tool call is 10-32x more token-efficient than an MCP tool call. No schema negotiation, no JSON-RPC framing, no capability exchange. You describe the command, the model runs it, you get stdout. For a developer sitting in a terminal with credentials already configured, this is genuinely better for many tasks.

If you're a solo dev who wants Claude to run `git log` or `kubectl get pods`, you don't need MCP. You need a shell.

Skills (system prompts that teach the AI how to use specific tools) are similarly good for developer workflows. They're lightweight, version-controllable, and composable. A skill that teaches Claude how to query your internal API is often simpler than wrapping that API in an MCP server.

So why does MCP still exist?

## Not everyone has a terminal

Your marketing director doesn't have `gcloud` installed. Your account manager has never seen a command line. Your CEO uses a Chromebook.

72% of knowledge workers in a typical company are non-technical. They use Google Workspace, Salesforce, Jira, and Slack through web interfaces. They interact with AI through chat UIs like Claude.ai or Microsoft Copilot. There is no shell. There is no local environment.

MCP with StreamableHTTP gives these users authenticated access to enterprise tools through a web interface. They click "Connect Google Workspace," go through an OAuth flow they already understand from every other web app, and they're done. No install, no config files, no PATH variables.

## OAuth isn't just for convenience

The "just use CLIs" argument assumes that the person running the tool has appropriate credentials on their machine. For a developer with their own API keys, sure. For a company with 200 employees? That model breaks fast.

MCP servers handle per-user OAuth. Each user authenticates with their own account. Permissions are scoped to what that user can access. When someone leaves the company, revoking their OAuth token is one API call. Rate limiting, audit logging, and access control happen at the server level, not on each person's laptop.

CLIs run with whatever credentials exist on the machine. That might be a personal access token with admin scope that someone created six months ago and forgot about. In a team setting, this is a security problem that gets worse the more people use it.

## Remote hosting changes the equation

A CLI requires a local runtime. Python, Node, Go, whatever the tool is built in. It requires dependencies. It requires the right OS (plenty of CLI tools have Linux-only features or Windows-specific bugs).

StreamableHTTP MCP servers run remotely. The client is a web browser or a chat interface. Mac, Windows, Chromebook, iPad. Doesn't matter. No local dependencies, no version conflicts, no "works on my machine."

This also means updates are instant. When we add a new tool to the Google Workspace MCP, every connected user gets it immediately. No `brew upgrade`, no `pip install --upgrade`, no "please pull the latest and rebuild."

## Some services don't have CLIs

Google Workspace has a CLI, `gws`, but it is a developer tool that needs a Cloud project and local credentials, which is the point of this post. `gcloud` is for GCP infrastructure. Notion's API is REST-only. Figma has no CLI. Salesforce has SFDX, but it's for developers managing metadata, not for an account exec pulling pipeline numbers.

For these services, the choice isn't "MCP vs CLI." It's "MCP vs nothing."

## Skills are complementary, not competing

This is the part of the debate that frustrates me most. Skills and MCP aren't the same layer.

Skills teach the AI *how* to use tools well. "When reading a Google Doc, use text mode first. Only use index mode if you need to make edits." That's a skill. It makes the MCP tool call better.

MCP gives the AI *access* to the tools. Without MCP (or something like it), the skill has nothing to call.

Saying "skills replace MCP" is like saying "recipes replace kitchens." You need both.

## The actual question

The debate shouldn't be MCP vs CLI vs skills. It should be: who are you building for?

If the answer is "myself and a handful of developers on my team," CLIs and skills might be all you need. Genuinely.

If the answer includes anyone who doesn't live in a terminal, if it includes non-technical users, if it includes teams that need access control, if it includes users on managed devices or Chromebooks, then you need something that runs remotely, authenticates per-user, and works through a web interface.

That's what MCP does. It's not dead. It's just not for you, specifically, if you're the kind of person who's comfortable running shell commands. And that's fine. But don't mistake your use case for the whole market.
