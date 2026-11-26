# Engineering roadmap (epics)

Replaces reused phase numbers with stable epic ids. Historical labels ("Phase 6", "Phase 7") stay in commit messages and older docs as history only: the shipped "Phase 6" was communities/forums and the shipped "Phase 7" was messaging/mentorship, while the original `CLAUDE.md` roadmap used those numbers for careers and events, which are **not** built. Task state lives in `engineering/backlog.json`.

Status words: live-verified (checked on the dev project or live site), unit-verified (automated tests only), partial, placeholder, planned, blocked, unknown.

## Built

| Epic | Scope | Status | Historical label |
| --- | --- | --- | --- |
| EPIC-FOUNDATION | Welcome page, info pages, legal drafts (DraftNotice) | live-verified (pages); legal drafts pending counsel | Phase 1 |
| EPIC-AUTH | Email/password auth, onboarding, session proxy | live-verified on dev | Phase 2 |
| EPIC-PROFILES | Profiles, education, experience, skills, images | live-verified on dev | Phase 3 |
| EPIC-FEED | Posts, likes, comments, categories, pagination | live-verified on dev | Phase 4 |
| EPIC-NETWORK | Directory, connections, follows, blocks, mutes, saved, notifications | partly live-verified (directory, connections, saved); rest unit-verified | Phase 4b |
| EPIC-TRUST | 2FA email code (unconfigured), reporting, admin moderation (closed until 2FA), privacy settings, export, deletion requests, consent, retention function | unit-verified | Phase 4A |
| EPIC-COMMUNITIES | Communities, forums, anonymity, educational framing | unit-verified (seeded on dev) | Phase 6 (shipped) |
| EPIC-CONNECT | Messaging, mentorship | unit-verified (seeded on dev) | Phase 7 (shipped) |
| EPIC-VERIFY-STUDENT | Manual student verification, badge; provider/SSO/document layers simulator-only | unit-verified; providers not connected | — |
| EPIC-ENGINEERING | Autonomous engineering system (this work) | locally validated; not activated | — |

## Planned (approved roadmap, needs stories and owner decisions)

| Epic | Backlog | Blocked on |
| --- | --- | --- |
| EPIC-CAREERS | FEAT-010 careers and job listings | Business rules, employer verification |
| EPIC-ORGS | FEAT-011 employer and organisation profiles | Verification method |
| EPIC-VERIFY-PRO | FEAT-012 professional verification | Verification method decision |
| EPIC-KNOWLEDGE | FEAT-013 articles/research, FEAT-014 stories | Moderation capacity |
| EPIC-LOCAL | FEAT-015 nearby communities and events | Location and safety rules |
| EPIC-SUPPORT | FEAT-016 peer-support spaces | Moderation staffing, crisis resources, legal review |

## Engineering priorities (from the founder's instruction of 2026-11-25)

- **P0 safety:** SEC-001 token rotation, ENG-003 CI activation, OPS-001 branch remediation, OPS-002 Netlify/database clarity, OPS-003 agent GitHub access and Issues migration, OPS-004 branch protection, DB-001 migration parity.
- **P1 launch readiness:** FEAT-001 stale copy (trial), DOC-002 docs from evidence, QA-001/003/004 browser testing, SEC-003 CSP report-only, SEC-004 email/2FA preparation, OPS-005 scheduled jobs design, OPS-006 monitoring preparation, ENG-006 activation.
- **P2:** OPS-007 production project, OPS-008 backups, DB-003 type generation, DB-004 search indexes, SEC-005 advisories, FEAT-002 comment-removal UI, QA-005 accessibility, ENG-004 localisation proposal, ENG-005 coverage.
- **P3:** EPIC-CAREERS … EPIC-SUPPORT.
- **Blocked by humans/vendors:** legal review, minors policy, moderation staffing, crisis resources, verification provider contracts, university agreements, AV scanning vendor, AI/OCR vendor, privacy impact assessment, production credentials, business model.
