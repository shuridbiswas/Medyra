# Student verification: product policy

Draft for counsel and the product owner. It describes what the software does, not legal advice.

## Claims

- **Current student**: official evidence, linked to this member, shows current enrolment at the stated institution.
- **Current program student**: the above, and official evidence shows enrolment in the exact program claimed.

A degree, graduation document, historical enrolment, acceptance letter, student email or student card alone never establishes either claim. A program credential is not authorization to practise a regulated profession; the badge says "student status, not professional licensure". A pre-professional or general health program is never described as a professional one. Unverified members keep their profiles and posts and may stay unverified indefinitely.

## What can be approved

A reviewer may approve only what was requested and what the evidence supports. If the institution confirms only general enrolment, only the student credential can be granted. Email ownership alone never grants anything. An unvalidated upload never grants anything.

## Identity linkage

A real student's document does not prove this member is that student. Approval requires a reviewer to record that the document's holder matches the member, plus a keyed hash of an identifier from the document so one real student cannot hold two accounts. Mismatch or ambiguity blocks approval. If identity cannot be linked, no badge is issued. Government ID is not required and Medyra does not ask for a SIN, RAMQ card, institutional password, patient information or full transcripts.

## Validity

Credentials are time-limited. Expiry is the confirmed term end (+1 day), capped at the maximum lifespan (365 days, configurable). When no term end is confirmed, Medyra applies a conservative 90-day window rather than inventing a date. These numbers are Medyra's own policy, not a legal requirement. Reviewers can shorten an expiry. On expiry or revocation the badge disappears immediately everywhere.

## Retention and consent

The member sees what is collected, why, who can review it and how long it is kept before submitting, and must accept the consent text (`verification_policy.consent_version`, currently a draft). Evidence is deleted after `evidence_retention_days` (default 90, pending legal review) by an administrator action that removes the file from Storage and clears the record. Reviewer notes and the identity hash stay with the request. Dates of birth are not collected.

## Appeals and retries

A rejected, expired or revoked member can start a new request; there is no separate appeal tool yet. Reviewers' notes shown to members are short and never include sensitive detail.
