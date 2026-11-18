# Student SSO test plan and results

Run: `npx vitest run supabase/tests/student-sso.test.ts src/features/verification`, then lint, typecheck, full tests and build.

| Area | Where | Real or simulated |
| --- | --- | --- |
| Registry, approval constraints, member visibility | `supabase/tests/student-sso.test.ts` | real SQL in PGlite |
| Start, single use, replay, expiry, subject-to-account binding, 30-day cap, no badge from SSO | same | real SQL, simulated outcomes |
| Document analysis, authenticity gate, inspection gate, exact program, identity reference, own-request block | same | real SQL |
| ID token validation (nonce, issuer, audience, expiry, signature, future iat), student vs staff, alumni, login-only and wrong scope, account swap, replay, unapproved or production-mock connection, missing secret | `src/features/verification/sso/sso.test.ts` | real `jose` validation, **simulated issuer** |
| Program matching FR/EN, biomedical vs medicine, keyword-only, institution mismatch, name comparison, prompt injection, analyzer failure, decision matrix | `src/features/verification/documents/documents.test.ts` | pure code |

**Not covered:** real universities, SAML (and signature wrapping: no SAML code exists), popup and `postMessage`, document upload/OCR/AI/malware scan, browser behavior, concurrent callbacks, any real issuer response. Mandatory scenarios about those remain open.
