# 14 · Unresolved product-owner decisions

These cannot be answered from the repository. Grouped by urgency for the autonomous-system design.

## A. Required before any autonomous system runs

1. **Supabase token:** Is the `SUPABASE_ACCESS_TOKEN` in `.env.local` the previously exposed one? Will you revoke it and issue a scoped token for automation (dev project only)?
2. **Autonomy level:** Which of these may agents do without you: open PRs · merge to the integration branch after CI + review · apply migrations to dev · deploy previews · promote to production (documented answer today: production needs your written go-ahead)?
3. **Branch model:** Should `main` become production (it currently has unrelated history), with `dev` as integration? Who may merge to each?
4. **Budget:** Maximum monthly spend on Claude (subscription vs API), and per-run / per-day caps. Are paid CI minutes or runners acceptable?
5. **Where agents run:** Your PC (desktop app scheduled tasks), Claude Code on the web/cloud sessions, GitHub Actions, or a dedicated server? Must work continue when your PC is off?
6. **Execution frequency:** Continuous, nightly, or on demand only?
7. **Notification channel:** App push, email, Slack, GitHub notifications? What wakes you up (failed production deploy only, or more)?
8. **Approved external services:** GitHub Actions, a GitHub app/token for agents, Netlify API token, Sentry, Upstash, Resend, Playwright cloud, any new paid tools?
9. **Preferred models** per role (e.g. strongest model for security/DB review, cheaper for docs).

## B. Product decisions that gate the backlog

10. **Next roadmap item:** launch-readiness blockers first, or careers/employer profiles (next documented roadmap item)? Fix the roadmap numbering?
11. **Launch region and languages:** Quebec only? Full French UI before launch?
12. **Minors:** may under-18 students join? Message adults? Be mentored?
13. **Invite-only launch** or open sign-up?
14. **Business model:** free, freemium, employer-paid, institution-paid?
15. **Professional verification method** (licences, employers) and whether any provider contract (SheerID) should proceed.
16. **Anonymity vs safety:** disclosure policy and retention for `forum_identity`; who may ever access it.
17. **Moderation staffing:** who staffs `/admin`, response times, escalation, crisis resources by region.
18. **Retention periods** for messages, ended mentorships, verification evidence, audit logs.
19. **Legal review timing** and budget; named privacy officer; privacy contact mailbox.
20. **Production infrastructure:** Supabase plan (backups/PITR), production project creation, domain and DNS provider.

## C. Engineering policy decisions

21. Tolerance for automatic code integration without human review on low-risk changes (docs, tests, copy fixes)?
22. Which files are human-only (suggested: legal pages, `DraftNotice`, `src/lib/auth/**`, `private` schema helpers, anonymity and verification RPCs, `netlify.toml` production context)?
23. Should agents be allowed to add npm dependencies? Plugins/skills/MCP servers?
24. Should the irrelevant Vercel and video skills be removed from agent environments?
25. Is `.claude/` meant to stay git-ignored (machine-local) or be versioned so agent configuration is shared?
26. Accept Playwright as the E2E tool? Coverage thresholds?
27. Security approval: who signs off on RLS/auth changes, and is an external pen test budgeted?
