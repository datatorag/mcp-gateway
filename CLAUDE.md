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
