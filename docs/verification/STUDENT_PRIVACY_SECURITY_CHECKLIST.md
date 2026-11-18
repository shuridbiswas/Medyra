# Student verification: privacy and security checklist

Open items before any real member uses SSO or document upload:

- [ ] Quebec Law 25 privacy impact assessment, consent text (identity/affiliation and, separately, AI-assisted analysis) and a non-AI path; counsel review.
- [ ] AI/OCR vendor: data location, retention, no training on member data, cross-border assessment, DPA. None is configured.
- [ ] Malware scanning before any processing (none wired; `EVIDENCE_AV_REQUIRED=true` keeps files closed). No document text or student IDs in logs, Sentry, Pinecone or ProductBridge (the analysis table stores no names or text).
- [ ] Retention schedule and deletion jobs (evidence retention exists; analysis rows cascade with the evidence).
- [ ] The anonymous writer functions have no lockout against key guessing (the key is 32+ random characters; rotate by revoking the hash row).
- [ ] Institution agreements and attribute-release terms; rate limits tuned; reviewer SOP and access audit.
- [x] No school passwords collected; redirects only to administrator-approved issuers; state single-use and bound to the member; ID tokens validated by `jose`; provisional status private, short and never a badge; mock IdP disabled and unapprovable in production; no service key.
