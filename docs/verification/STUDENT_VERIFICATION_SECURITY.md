# Student verification: security

## Controls

- **Authorization is in the database.** RLS lets owners and administrators read; nobody writes tables directly. Status, credentials, audit rows and checklists change only inside `security definer` functions that check the caller, the state and ownership. `private` helper functions are not executable by clients (re-granted list in the migration).
- **No forged status.** The app never sends a status or a credential; `approve_verification` computes them. A trigger rejects invalid transitions even from the table owner and refuses re-assigning owner, institution, claim, program or method.
- **Concurrency.** Decisions lock the request row; identity reuse is serialized with an advisory lock; unique indexes forbid two open requests for one claim and two active credentials of one scope.
- **School-email step.** Codes are 6 digits, keyed-HMAC hashed (never stored plain), single use, 15 minutes, 5 wrong tries, 5 codes per hour, 60 s cooldown, previous codes invalidated, and one school address can confirm only one account per institution. The address is stored only as a keyed hash plus its domain. The code goes only to a domain the database confirmed for the institution. It cannot yield a badge.
- **Evidence.** Private bucket, 5 MB, PDF/JPEG/PNG, random names, owner-or-assigned-reviewer read, 60-second signed URLs, owner upload only while evidence is open. Real-byte signature check; PDFs with scripts, launch actions, embedded files, XFA or encryption are refused; ZIPs and renamed files are refused. A file is unopenable until a reviewer-triggered server inspection passes. Pasted share links are stored as text and never fetched. Evidence is not sent to Sentry, Pinecone, ProductBridge or analytics, and file contents and signed URLs are not logged.
- **Rate limits.** `verification` policy (Upstash, fail-open) on member and reviewer actions, plus the database limits above.
- **Admin.** `/admin/student-verifications` calls `requireAdmin()` (404 for others, confirmed emailed-code sign-in). Reviewers cannot review or approve their own request, and cannot approve one assigned to someone else.
- **Errors.** `reportError` receives operation names and codes only. Member-facing errors show our own database sentences or one generic line.

## Tested

`supabase/tests/student-verification.test.ts` (42 tests, real migrations in PGlite) covers: no direct writes; no reading others' requests or documents; a member cannot approve, impersonate staff or change `user_id`; replayed, expired, wrong and locked codes; email-only gives no badge; forged or quarantined documents are never auto-approved; incomplete checklists, mismatched identity and unconfirmed programs are refused; expired and revoked credentials stop being badges immediately; duplicate identities and renewals; storage policies; retention; account deletion with append-only logs. `src/features/student-verification/*.test.*` covers inspection, hashing, action behavior, the audit-before-effect ordering and the badge component.

## Known gaps and blockers

1. **No antivirus.** Static inspection is not malware scanning. Set `EVIDENCE_AV_REQUIRED=true` in production and wire a scanner that sets `av_clean` before launch; until then reviewers cannot open files in that mode.
2. **Hash secret.** `VERIFICATION_SECRET` (or `TWO_FACTOR_SECRET`) is required for the email step and identity references. Without it those features refuse to run.
3. **Migration not applied anywhere.** Nothing has run against a live Supabase project, Storage, Resend or pg_cron.
4. **Admins can read member emails** of requests they decide (`verification_notice_recipient`) to send the notice. Counsel should approve this.
5. **Evidence rows are visible to all administrators** at the table level; the Storage policy limits file access to the assigned reviewer, but metadata and checklists are not per-reviewer.
6. **No scheduled email** for expiry or reminders (needs a trusted job runner); in-app notices only.
7. Legal text, retention and consent wording are drafts. Minors, multi-jurisdiction privacy law (Quebec Law 25) and breach procedure need counsel.
