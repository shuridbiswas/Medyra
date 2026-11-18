# University connector setup (all manual, nothing done)

1. Apply for CANARIE CAF service-provider participation and get the institution's written agreement to release `eduPersonScopedAffiliation` (student) to Medyra. Record it in `INSTITUTION_SSO_APPROVAL_MATRIX.md`.
2. For an OIDC-capable issuer, obtain: the issuer URL (https), a client id, a client secret if required, the exact redirect URI `https://<host>/api/verification/student/return` registered at the issuer, and the affiliation scope(s) it releases.
3. In the **development** database (as owner), fill the row, for example: `update institution_sso_connections set protocol='oidc', issuer='https://...', client_id='...', affiliation_scopes='{udem.ca}', approval_state='sandbox_approved' where institution_id=(select id from academic_institutions where slug='udem');`. Never paste real values into chat or commits.
4. Environment (names only): `VERIFICATION_SECRET` (state derivation and subject hashing), `VERIFICATION_WRITER_KEY` (and its hash row, see `SHEERID_CONNECTION_SETUP.md`), `STUDENT_SSO_CLIENT_SECRET` (if the issuer needs one), `NEXT_PUBLIC_SITE_URL`, `VERIFICATION_ENV`.
5. Test in the issuer's sandbox with consenting test accounts. Only then consider `production_approved`, which also needs the privacy checklist, counsel review and your explicit approval.
6. SAML issuers need a maintained SAML library and CAF metadata; that adapter does not exist yet.
