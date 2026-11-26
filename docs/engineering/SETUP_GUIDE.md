# One-time setup (founder)

Everything here needs the repository owner. Agents prepared it; none of it has been done.

## 1. Credentials

- Supabase → Account → Access Tokens: revoke the token stored in `.env.local` (do not paste it anywhere). Create a token limited to the development project for `dev-migration.yml` only.
- GitHub → Settings → Environments: create `autonomy`, `dev-database`, `production`, each with you as required reviewer.
  - `autonomy` secrets: `ANTHROPIC_API_KEY` (set a Console spend limit) **or** `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`).
  - `dev-database` secrets: `DEV_SUPABASE_URL`, `DEV_SUPABASE_PUBLISHABLE_KEY`, `DEV_SUPABASE_SCOPED_TOKEN`; variables `DEV_PROJECT_REF`, `PROTECTED_PROJECT_REFS`.
- Repository variables: `MEDYRA_AUTONOMY_PAUSED=false`, `MEDYRA_AUTONOMY_ENABLED=false` (true at activation), `MEDYRA_HOSTED_DEV_MIGRATIONS=false`, `MEDYRA_PRODUCTION_RELEASE_ENABLED=false`, optional `MEDYRA_RUN_BUDGET_USD=5`, `MEDYRA_PREVIEW_HOSTS`.

## 2. Push and CI

```bash
git push origin <bootstrap branch>
```
Open a PR to `dev`; confirm the `ci` workflow's three jobs pass. Then add `ci / lint, typecheck, tests, policy gates`, `ci / production build` and `ci / dependency advisories` as required status checks.

## 3. Branch protection (dev and main)

Require a pull request, 1 approval, review from code owners, the CI checks above, linear history optional; block force pushes and deletions; do not allow bypass for the agent credential.

## 4. CODEOWNERS (agents are blocked from writing this file)

Create `.github/CODEOWNERS`:

```
/.github/                         @shuridbiswas
/.claude/settings.json            @shuridbiswas
/.claude/hooks/                   @shuridbiswas
/engineering/control.json         @shuridbiswas
/engineering/approvals.json       @shuridbiswas
/engineering/policy.json          @shuridbiswas
/scripts/engineering/             @shuridbiswas
/supabase/migrations/             @shuridbiswas
/src/lib/auth/                    @shuridbiswas
/src/proxy.ts                     @shuridbiswas
/src/app/privacy/                 @shuridbiswas
/src/app/terms/                   @shuridbiswas
/src/app/community-guidelines/    @shuridbiswas
/src/lib/legal.ts                 @shuridbiswas
/netlify.toml                     @shuridbiswas
/package.json                     @shuridbiswas
/package-lock.json                @shuridbiswas
```

## 5. Agent GitHub access (choose one)

- **GitHub App (recommended):** permissions Contents RW, Pull requests RW, Issues RW, Actions RW (to dispatch CI); install on this repository only; store its credentials in the `autonomy` environment and switch the workflow's `github_token` to an app token step.
- **Fine-grained token:** same permissions, this repository only, expiry ≤ 90 days.

Tokens created by `GITHUB_TOKEN` do not trigger other workflows; the execute job therefore dispatches `ci.yml` explicitly on the task branch.

## 6. Owner sessions on this machine

The guard hook blocks agents from owner-only files and destructive scripts. To run them yourself through Claude, start Claude with `MEDYRA_OWNER_MODE=1` in the environment; secrets stay blocked even then. Running scripts in your own terminal is unaffected.

## 7. OneDrive

The repository lives in OneDrive. For parallel worktrees or heavy builds, use a clone outside OneDrive (for example `C:\dev\Medyra`) or the GitHub runner; OneDrive sync can lock or duplicate files under `.claude/worktrees` and `.next`. Do not move the existing folder without deciding to.

## 8. Email and two-step sign-in (SEC-004)

Resend with a verified domain → `RESEND_API_KEY`, `EMAIL_FROM`; generate `TWO_FACTOR_SECRET` (`node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`); set them in Netlify for the relevant context; confirm `/api/health` shows `"twoFactorEmail":true`; `MFA_ENFORCEMENT=off` is the emergency switch.
