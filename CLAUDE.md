# datatorag-mcp

This repository is **public**. Everything committed here — code, docs,
skills, agent definitions, commit messages — is visible to the world.

## Security gate (mandatory)

Before every `git push` and before every production deploy:

1. Run the `security-reviewer` agent (`.claude/agents/security-reviewer.md`)
   on the outgoing diff (`origin/main...HEAD`, or the staged/working-tree
   changes if pushing amends).
2. Only push/deploy on `VERDICT: PASS`.
3. On `VERDICT: BLOCK`, fix the findings first. If a secret is in any
   commit of the unpushed range, rewrite the range's history (amend or
   rebase) — deleting it in a follow-up commit is not enough. If a secret
   was already pushed, treat it as compromised: rotate it, then purge
   history.

## Repo rules

- Never commit secrets, rendered `.env` content, or credentials of any
  kind. Production secrets live in AWS SSM Parameter Store and are
  rendered at deploy time (see `.env.example` header and the deploy
  skill).
- Never commit internal company documents, compliance evidence, or
  customer/lead personal data. Internal material belongs in the private
  company repo, not here.
- Package manager is pnpm. Tests: `pnpm vitest run` in `apps/gateway`;
  typecheck: `pnpm exec tsc --noEmit`; production build: `pnpm build`.
- Before pushing, verify the active GitHub account is the org account
  (`gh auth status`), not a personal one.

## Skills & agents

Codebase knowledge lives in `.claude/skills/` — load these instead of
re-reading the source:

- `codebase-map` — architecture, flows, decisions, where-things-live. Load first.
- `gateway-dev` — recipes for gateway changes + test patterns + ship ritual.
- `site-content` — blog/changelog/docs systems and page conventions.
- `services-integrations` — Brevo/Slack/Stripe/PostHog/event-pipeline patterns.
- `ops-debugging` — prod runbook (placeholder form; live values in memory).
- `gws-mcp-dev` — developing the gws-mcp plugin repo + its ship tail.
- `product-capture` — Remotion project at `tools/capture` for product screenshots/recordings; imports real gateway components so captures can't drift.
- `parent-updates` — keeping the `datatorag-hq` parent session current. It cannot see this session, so an update not sent did not happen.
- `outbound-copy` — anything a person outside the company reads: transactional/lifecycle email, in-product strings, form and error copy. Load it (and `manuel-voice`) before drafting a line.
- Plus: `blog-writing`, `db-query`, `deploy`, `humanizer`, `marketing-video` (brand explainers only), `product-promo-video` (superseded).

Agents in `.claude/agents/`: `engineer` implements, `qa-engineer` verifies,
`content-marketer` keeps changelog/blog covering what shipped,
`security-reviewer` gates every push/deploy.

**Freshness rule:** any change that alters a pattern documented in a
`.claude/skills/` skill updates that skill in the same commit/PR.
