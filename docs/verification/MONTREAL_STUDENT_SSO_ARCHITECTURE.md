# Montréal student SSO and document verification: architecture

Status: **built and tested against a local simulator only.** No university connection is approved, no real login has ever happened, no OCR or AI provider is configured, and the new migration (`20261109000001`) is not applied to the development Supabase project.

## Two stages, one badge

1. **University login (provisional).** `startUniversitySso` creates a single-use attempt (random `state`, stored hashed; nonce and PKCE verifier derived from it with a server secret) and sends the browser to the issuer of an administrator-approved connection (`institution_sso_connections`). The destination never comes from member input. The browser returns to `/api/verification/student/return`, which requires the same signed-in member who started the attempt, validates the ID token with `jose` (signature, issuer, audience, exp, nbf, iat, nonce, subject), and only an exact `eduPersonScopedAffiliation = student@<approved scope>` counts. Result: `provisional` (private, 14 days, capped at 30 in the database), `sso_confirmed_only`, `review_required` (the same university identity already belongs to another Medyra account), or `failed`. **It never issues the public badge** and is not read by `verified_badges`.
2. **Document.** An analyzer (model or person) returns a strict, key-checked structure; the program is matched by exact normalized name against the reviewed catalogue (French and English names); `decideDocument` encodes the decision matrix. The database stores only a minimal analysis row (no names, no text). A reviewer must set authenticity (`ISSUER_VALIDATED`, `DIGITAL_SIGNATURE_VALIDATED`, `REGISTRAR_CONFIRMED`); only then can `apply_document_analysis_to_review` copy the result into the checklist (it also requires a current term, a matched name, the same institution, the exact requested program, a passed file inspection, and an identity reference). The existing `approve_verification` then issues the credential and the existing badge reads it. Model confidence never counts.

## Trust model

No service key. Writes that depend on server-side validation (SSO completion, document analysis) use the same keyed trusted writer as provider results (`VERIFICATION_WRITER_KEY`, hash in `verification_writer_keys`). A mock-IdP subject is never accepted as an identity reference, and the mock IdP refuses to run, and cannot be approved, in production.

## Not built

SAML adapter (needs a maintained SAML library and CAF metadata; never hand-written); popup tab with `postMessage` and the status screen; upload-init/submit/status routes for documents; PDF text extraction, OCR, malware scanning and the AI analyzer (all need provider and privacy approval); automatic approval (every credential still needs a reviewer); admin screens for authenticity and applying the analysis; appeals UI. The member and admin screens have no SSO buttons yet: only the server actions exist.
