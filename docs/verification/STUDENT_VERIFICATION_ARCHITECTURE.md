# Student verification: architecture

Quebec student credentials (universities and CEGEPs). Migration `supabase/migrations/20261105000001_student_verification.sql`; code in `src/features/student-verification/`.

## Auth and authorization

Medyra uses Supabase Auth, so `auth.uid()` is the identity everywhere. Members call the database as themselves (publishable key only). There is no service-role key in the app. Privileged work is done by `security definer` functions that call `private.is_admin()` (a row in `staff_roles`) before doing anything, and administrators also pass `requireAdmin()` (confirmed emailed-code sign-in) in the app.

## Data model

| Table | Purpose | Who can read |
| --- | --- | --- |
| `academic_institutions` | Registry (23 seeded). Names, kind, city, website, confirmed `email_domains`, registrar and documents URLs, instructions EN/FR, `integration_status`, `source_checked_at`. | members; admins edit |
| `institution_verification_methods` | Per institution and method: `documented`, `requires_permission` or `unverified`, with source URL. | members |
| `program_categories` | 16 normalized health and social-services categories, EN/FR. | members |
| `academic_programs` | Official program per institution (code, level, catalogue URL, classification). Hidden from members until `source_reviewed_at` is set. None are seeded. | members (reviewed only) |
| `student_verification_requests` | One request per claim. State machine below. | owner, admins |
| `student_verification_evidence` | Metadata for files (private bucket path) or pasted share references; `scan_status`, `validation_status`, `retention_delete_at`. | owner, admins |
| `verification_review_details` | Reviewer checklist, notes, identity-binding hash. | admins only |
| `student_verified_credentials` | Issued credentials. `binding_hash` column is not granted to members. | owner, admins; public projection via `verified_badges()` |
| `verification_review_events` | Status history shown to the owner. Append-only. | owner, admins |
| `verification_audit_log` | Privileged actions, ids and decisions only. Append-only. | admins |
| `institutional_email_challenges` | School-email codes as keyed hashes. No grants, no policy. | nobody (functions only) |
| `verification_policy` | One row: max lifespan 365 d, unknown-term window 90 d, reminder 14 d, evidence retention 90 d, consent version. | members read, admins update |

Both append-only logs allow an account deletion to blank the actor and cascade rows away (`private.protect_verification_log`).

## State machine

`DRAFT -> AWAITING_EMAIL_VERIFICATION -> AWAITING_EVIDENCE -> SUBMITTED -> UNDER_REVIEW -> APPROVED | REJECTED | MORE_INFORMATION_REQUIRED`, plus `DRAFT -> AWAITING_EVIDENCE` (email step skipped), `MORE_INFORMATION_REQUIRED -> SUBMITTED`, `APPROVED -> EXPIRED | REVOKED`, and `WITHDRAWN` from any open state. `private.can_transition()` is the rule; a trigger on the table refuses anything else (even from the table owner) and refuses changing owner, institution, claim, program or method. `machine.ts` mirrors it and a test compares every pair.

Members have no insert, update or delete grant on requests. Every change goes through a function: `start_student_verification`, `skip_email_step`, `create_email_challenge`, `verify_email_challenge`, `add_verification_evidence`, `submit_student_verification`, `withdraw_student_verification`. Reviewers use `claim_student_verification`, `record_verification_checks`, `set_evidence_scan`, `review_evidence`, `request_more_information`, `reject_verification`, `approve_verification`, `revoke_student_credential`, `set_credential_expiry`, `expire_student_credentials`.

## Approval (one transaction)

`approve_verification` locks the request row (`for update`), then requires: caller is an admin; request is `UNDER_REVIEW` and assigned to the caller; caller is not the request owner; method is not email-only or federated; checklist complete (issuer verified, identity `matched`, current enrolment confirmed, identity reference recorded); at least one validated evidence item or a `confirmed` registrar response; a program claim only if it was requested and `program_confirmed` is true; term not already ended. Expiry is the earlier of the confirmed term end + 1 day, the maximum lifespan, and an optional reviewer date; with no confirmed term it is the conservative 90-day window. An advisory lock on the identity reference stops two reviewers verifying one real student on two accounts. It then supersedes an earlier credential of the same scope, inserts the credential, moves the request to `APPROVED`, notifies the member and writes the audit row. A second concurrent decision fails because the status is no longer `UNDER_REVIEW`; unique indexes are the backstop (`svc_one_active_scope`, `svr_one_open`).

## Badge

`verified_badges(uuid[])` returns only credentials that are not revoked, not ended and have `expires_at > now()`, evaluated at call time. `getBadges()` calls it on every request (no cache), and any failure means "Not Verified". The single `VerificationChip` component renders blue Verified (details in a native `<details>`) or grey Not Verified. It is wired to profiles, posts, comments, member cards (directory, connections, requests), mentors, community members and named forum authors. Anonymous forum content has no author object, so it never gets a badge.

## Evidence

Private bucket `student-verification-evidence`, 5 MB, PDF/JPEG/PNG only, path `<member>/<request>/<random>.<ext>`. Upload goes through a server action that inspects the real bytes (`evidence.ts`) and registers the file through the database function. Because a member could upload directly to Storage, a file only becomes openable after a reviewer-triggered server inspection (`inspectEvidenceFile`) records `static_ok`; `EVIDENCE_AV_REQUIRED=true` additionally requires `av_clean`, which nothing sets yet, so files stay closed (fail closed). Reviewers get 60-second signed URLs and only for requests assigned to them (Storage policy). Pasted share references are plain text and are never fetched.

## Expiry

`private.expire_credentials_job()` ends elapsed credentials, moves `APPROVED -> EXPIRED`, and sends one in-app reminder per credential before expiry. It is scheduled hourly with `pg_cron` when the extension exists (Supabase), and an administrator can run it from the Audit tab. Badges never depend on it running.

## Email

Request received and school-email confirmed go to the member through `sendToMember`. Decisions (more information, rejected, approved, revoked) go through `verification_notice_recipient()`, which returns the request owner's address to an administrator, then `sendToAddress`. The school-email code goes to a domain the database has confirmed for that institution. Emails are bilingual, short and only point to `/verification/student/status`. Expiry and reminder emails are not sent (a scheduled job cannot read addresses without a service key); members get in-app notifications.
