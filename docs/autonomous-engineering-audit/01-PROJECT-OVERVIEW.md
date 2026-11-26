# 01 · Project overview

Audit date: 2026-11-25. Repository state: branch `dev`, commit `008e754` (2026-11-18). Discovery only: no code, schema, package or configuration was changed.

Legend used in every report: **Verified** = observed in code and exercised by an automated check or a documented live check · **Unverified** = present in code, never exercised live · **Partial** · **Placeholder** · **Planned** (documented intent, no code) · **Unknown**.

## 1. Identity

| Item | Finding | Source |
| --- | --- | --- |
| Product name | **Medyra** (renamed from "Medoras"; repo folder and early commits still use Medoras; `medoras` is a reserved username) | `CLAUDE.md`, `README.md`, commit `6095b8f` |
| Tagline | "Connect. Learn. Grow. Belong." / "More than a career. A community that cares." | `CLAUDE.md` |
| Package | `medyra@0.1.0`, private | `package.json` |
| Repository | `https://github.com/shuridbiswas/Medyra.git` (GitHub, owner `shuridbiswas`) | `git remote -v` |
| Description | Professional and social network exclusively for the healthcare and social-services ecosystem (students, graduates, professionals, educators, researchers, mentors, employers, organisations) | `CLAUDE.md` "Product vision" |
| Positioning | "A long-term startup product, not a demo." | `CLAUDE.md` |

## 2. Vision, objective and audience

- **Primary objective:** a trusted community where nobody navigates education, career or personal challenges alone. Combines LinkedIn-style identity, Reddit-style communities/forums, student-to-professional mentorship, research sharing, careers, personal stories, local communities and peer emotional support (`CLAUDE.md`).
- **Audience:** nursing, medicine, psychology, social work, pharmacy, physiotherapy, occupational therapy, speech-language pathology, audiology, public health and related fields, every career stage. Field list in code: `src/features/onboarding/options.ts` (`FIELDS`, `MEMBER_TYPES`, `CAREER_STAGES`).
- **Product principles (approved, `CLAUDE.md`):** trust first (verification, moderation, zero harassment tolerance); privacy by design (anonymity, coarse optional location, de-identified cases only); honest limits stated in the UI (not medical care, not therapy, moderation is not guaranteed); success should inspire, not breed competition.
- **Brand:** white and rose neutrals, maroon primary (`maroon-50..900` tokens in `src/app/globals.css`), Plus Jakarta Sans + Inter, no glassmorphism, no stock medical imagery; illustrative UI must be labelled.

## 3. Markets, regions, languages

| Item | Finding | Status |
| --- | --- | --- |
| Target region | Quebec / Montréal first. Seed data is Quebec (Montréal, Laval, Longueuil…); student verification targets Quebec universities and CEGEPs (`docs/verification/QUEBEC_INSTITUTION_SOURCES.md`) | Implied by code and docs; launch region formally **undecided** (`CLAUDE.md` open questions) |
| Languages | UI is **English only** (`<html lang="en">`, `src/app/layout.tsx:56`). Only student-verification copy has EN/FR (`src/features/student-verification/content.ts`, `?lang=fr`). Seed content is 70% French. | Partial |
| Regulatory | Quebec Law 25 (privacy), Canadian privacy law, French-language obligations, minors, data location, provider contracts — all flagged for legal review; legal pages are drafts with `DraftNotice` | Planned (counsel needed) |

## 4. Business model and value proposition

- **Value proposition:** a field-specific, trust-centred alternative to general networks: verified student status, safe anonymous Q&A for clinical-education questions, mentorship, communities.
- **Business model:** **Unknown.** No pricing, subscription, ads, payments or employer billing exists in code or docs. Careers/employers are planned but unbuilt.
- **Scalability expectation:** not specified. Docs anticipate growth limits: member search uses `ilike` (needs `pg_trgm` indexes, `PRODUCTION_READINESS.md` §1/§6.12); `listConversations` unread counts are approximate for long backlogs.

## 5. Maturity and phase

| Item | Finding |
| --- | --- |
| Maturity | **Pre-launch / alpha.** Feature-rich codebase (~30k lines TS, 15 migrations, 67 tables) running against one **development** Supabase project with fictional seed data. No production database, no real members, legal pages are drafts. |
| Phases done (per `CLAUDE.md`) | 1 (welcome), 2 (auth/onboarding), 3 (profiles), 4 (feed), 4b (network, saved, notifications), 4A (security/safety/privacy), 6 (communities/forums), 7 (messaging/mentorship), student verification (manual review), external provider + university SSO scaffolding (simulator only) |
| Roadmap conflict | `CLAUDE.md` "Roadmap" still lists Phase 6 = careers/articles/stories and Phase 7 = events/peer support, while the "Current scope" section calls the shipped communities/forums work "Phase 6" and messaging/mentorship "Phase 7". Phase numbering is reused; see `04-ROADMAP-AND-BACKLOG.md`. |
| Launch strategy | Documented intent only: Netlify previews on the dev Supabase project; separate production Supabase project; no production domain without the owner's written go-ahead (`DEPLOYMENT.md` §6); consider invite-only sign-up (`PRODUCTION_READINESS.md` blocker 11). |

## 6. Requirement and planning sources

| File | Role | Currency |
| --- | --- | --- |
| `CLAUDE.md` (34 KB) | Canonical vision, architecture rules per phase, roadmap, open questions | Current (2026-11-17) but roadmap section stale |
| `README.md` | Setup, per-phase feature summary, routes, "What is verified" | Mostly current; "What is verified" cites 348 tests (old) |
| `ARCHITECTURE.md` | Infrastructure decisions (Netlify, Sentry, Upstash, Resend, ProductBridge, Pinecone), auth architecture, risks | Oct 29; predates Phase 6+ |
| `PRODUCTION_READINESS.md` | Phase 4A readiness, 14 production blockers, Phase 6/7 addenda | Oct 31 + addenda; verification work not added |
| `DEPLOYMENT.md`, `DNS_SETUP.md`, `EMAIL_SETUP.md`, `OBSERVABILITY.md` | Ops runbooks | Oct 29-30 |
| `TESTING.md` | Manual test procedures §0-16 | Through Phase 7 |
| `SEEDING.md`, `TEST_ACCOUNTS.md`, `TEST_DATA_REPORT.md`, `DATA_VALIDATION_REPORT.md`, `DATABASE_AUDIT.md`, `DATABASE_RESET_REPORT.md` | Dev-data tooling and live dev-DB snapshots | 2026-11-08/09 |
| `docs/verification/*.md` (15 files) | Student verification, providers, SSO, policies, test plans | 2026-11-17 |
| `AGENTS.md` | Auto-generated Next.js agent rule (read bundled docs) | Generated by `next dev` |
| Prior "phase prompts" | Pasted by the owner in chat; not stored in repo | Not in repo |

No issue tracker, PRD folder, user-story file or ADR directory exists. Requirements live in `CLAUDE.md` and in chat history.

## 7. Unique features

Anonymous forum posting with identity held only in a private table and moderation that never reveals the writer; educational "second opinion" framing with de-identification confirmation; student credential verification with reviewer checklist and keyed hashes; mentorship with self-declared, explicitly unaccredited mentors; honest-limits copy throughout.
