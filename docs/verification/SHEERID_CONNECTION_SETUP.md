# SheerID connection setup

Nothing here has been done: no SheerID account, program, token or webhook exists yet, and no call to SheerID has ever been made. SheerID is `ADAPTER_IMPLEMENTED` and `AWAITING_CONTRACT`. Do not enable it until SheerID confirms in writing that a renewable badge on a community network is an allowed use (questions: see the research file).

## What SheerID documents (checked 2026-11-17)

- Create: `POST https://services.sheerid.com/rest/v2/verification`, `Authorization: Bearer <token>`, body `{"programId": "..."}`; the response has `verificationId`, `currentStep`, `submissionUrl`.
- Hosted form: `https://services.sheerid.com/verify/<programId>/?verificationId=<id>`.
- Webhook: header `X-SheerID-Signature`, lowercase hex HMAC-SHA256 of the **raw body** with the account Secret Token; payload `{"verificationId", "notifierEventType"}` (no PII, no outcome). Retries after 1 h, 3 h, 7 h on any non-2xx.
- Static access tokens stop working on 2027-01-31: use the dynamic OAuth/Application credential SheerID issues.
- **Not confirmed from public docs:** the exact shape of the Verification Details response (`currentStep` values such as `success`, `error`, `rejected`, `docUpload`, `pending` are what the code maps; anything else is treated as "still pending", never as success) and whether it contains `programId`. Confirm both in the SheerID sandbox before relying on them.

## Steps (all manual)

1. Get SheerID's written approval, a program in Test Mode, API Access Control (`requireToken`), and an OAuth/Application token.
2. Create a long random writer key (never reuse another secret), e.g. `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Keep it only in your environment.
3. In the **development** Supabase SQL editor, store only its hash (replace the placeholder with your key; do not paste the key into chat or commit it):

   ```sql
   insert into public.verification_writer_keys (key_hash, label)
   values (encode(sha256(convert_to('<YOUR_WRITER_KEY>', 'UTF8')), 'hex'), 'dev webhook');
   ```
4. Mark SheerID as sandbox-approved (after SheerID approves test use):

   ```sql
   update public.verification_provider_configs
   set contract_state = 'sandbox', enabled = true, environment = 'development', reviewed_at = now()
   where provider = 'sheerid';
   ```
5. Set environment variables (local `.env.local`; Netlify: Site configuration > Environment variables, scope **Deploy previews / branch deploys** only until production is approved). Names only; never commit values:

   | Variable | Purpose |
   | --- | --- |
   | `VERIFICATION_ENV` | `development`, `staging` or `production` |
   | `VERIFICATION_LIVE_PROVIDERS_ENABLED` | `true` to allow real providers (default `false`) |
   | `SHEERID_ENABLED` | `true` to allow SheerID |
   | `SHEERID_PROGRAM_ID` | the program id |
   | `SHEERID_ACCESS_TOKEN` | server-side OAuth/application token |
   | `SHEERID_WEBHOOK_SECRET` | SheerID's Secret Token for signing |
   | `VERIFICATION_WRITER_KEY` | the writer key from step 2 |

6. In MySheerID, add the webhook URL `https://<your-deploy-host>/api/verification/providers/sheerid/webhook` (HTTPS) and enable at least SUCCESS, DOCUMENT_REJECTED, MAX_DOC_UPLOAD_ATTEMPTS, EXPIRATION and ERROR.
7. Run a Test Mode verification end to end, then see `PROVIDER_INTEGRATION_TESTING.md`.

## Going live (not before)

Contract and DPA signed, sandbox results confirmed against the real details response, privacy impact assessment and counsel review, security review, then `contract_state = 'live'`, `environment = 'production'` in the database, production env vars, and your explicit approval. The simulator and any `sandbox` provider are refused in production by the app, the policy and the database.

## Rollback

Set `enabled = false` for the provider (and/or `VERIFICATION_LIVE_PROVIDERS_ENABLED=false`); revoke a leaked writer key with `update public.verification_writer_keys set revoked_at = now() where label = '...'`; rotate the SheerID token and webhook secret in MySheerID. Existing credentials keep their own expiry and can be revoked from the admin page.
