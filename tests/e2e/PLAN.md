# End-to-end test plan (Playwright, pending approval)

Status: **not implemented.** Adding `@playwright/test` is a new dependency and needs the owner's approval (task QA-001, decision D-07). Until then browser gates are recorded as `NOT_EXECUTED`, and `npm run eng:smoke -- <url>` covers HTTP-level checks of deployed sites.

## Environment rules
- Run against `npm run build && npm run start` on the CI runner, connected to a **synthetic-data** Supabase environment (decision D-08: a dedicated test project, or the dev project with dedicated synthetic accounts). Never production, never the retained real account in dev, never the founder's browser.
- Credentials for synthetic accounts come from CI secrets of that environment only.
- `trace: "retain-on-failure"`, `video: "off"` for signed-in flows; screenshots only on failure; artifacts expire in 7 days.
- Two-step sign-in: run with `MFA_ENFORCEMENT=off` in the test environment, plus one dedicated test proving the code page appears when enforcement is on (no real inbox needed: assert the page, not the email).

## Priority 1 (smoke, every PR)
1. `/welcome` renders; signed-out `/` → `/welcome`; protected routes → `/login?next=…`.
2. Sign up → onboarding → home feed (synthetic account, email confirmation off in the test project).
3. Login with invalid credentials shows an error; valid login reaches `/`.
4. Create, edit, delete own post; comment; like.

## Priority 2 (nightly)
- Profiles: edit, privacy (connections-only), directory listing, restricted profile view by a non-connection.
- Network: connect, follow, block (blocked user cannot comment or message), mute, saved items, notifications.
- Communities: public join; private request → approve; non-member cannot read private posts; moderator remove post.
- Forums: ask, answer, reply, accept; anonymous question shows no author anywhere in the DOM, search results or notifications of another user.
- Messaging: direct message, message request accept/decline, blocked user cannot send, group permissions.
- Mentorship: listing, request with goals, accept within capacity, capacity refusal, complete, private feedback.
- Verification: manual review submission, pending state, simulator labelled TEST ONLY and unavailable outside development, upload validation rejects wrong file types, another member cannot open evidence, badge shows only after approval.
- Admin and privacy: non-admin gets 404 on `/admin`; data export downloads own data; deletion request shows the date.

## Priority 3 (weekly)
- Responsive: 375, 768, 1280 widths for home, forum question, conversation, community.
- Accessibility: `@axe-core/playwright` (also needs approval) on key pages; keyboard-only path through sign-in, composer and messaging; visible focus; labelled fields; accessible error text.
