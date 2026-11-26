# Emergency stop

## Pause everything (fastest first)

1. **Repository variable:** GitHub → Settings → Secrets and variables → Actions → Variables → `MEDYRA_AUTONOMY_PAUSED` = `true`. Every autonomous, maintenance and dev-migration job checks it at start-up; the engine also checks it (`MEDYRA_AUTONOMY_PAUSED` env) before claims and transitions.
2. **Cancel running workflows:** Actions tab → running `autonomous-development` → Cancel. Cancelling stops further steps; it does **not** undo a push, PR or migration that already happened.
3. **Disable workflows:** Actions → workflow → "…" → Disable workflow.
4. **Owner file:** set `"paused": true` and a `pauseReason` in `engineering/control.json` (agents cannot edit it).
5. **Revoke access:** remove `ANTHROPIC_API_KEY` / `CLAUDE_CODE_OAUTH_TOKEN` from the `autonomy` environment; revoke the GitHub App installation or token; revoke the scoped Supabase token in Supabase → Account → Access Tokens.
6. **Prevent deploys:** Netlify → Site configuration → Build & deploy → Stop builds (or lock published deploy).

## Where the pause is enforced

Workflow start (`if: vars.MEDYRA_AUTONOMY_PAUSED != 'true'`) · `preflight` before new AI execution · `claim` and `transition` (except moves to BLOCKED/FAILED) · `dev-migration.yml` before hosted operations · integration requires approvals regardless.

## Resume

1. Find what was in flight: `npm run eng -- status` and the latest `engineering-state` commit.
2. `npm run eng -- recover` (expired leases return to READY with a retry counted).
3. Review open PRs and any partial branches; delete nothing automatically.
4. Set `MEDYRA_AUTONOMY_PAUSED=false` (and `paused: false`), then run `autonomous-development` in `dry-run` before `manual`.

Agents cannot remove or bypass these controls: the variable and environments are GitHub settings, and `control.json`, `settings.json` and the hook are owner-only.
