-- Provider attempts become part of the existing request -> review -> credential flow.
--
--   member -> student_verification_requests (method PROVIDER_VERIFICATION)
--          -> verification_attempts (many per request, history kept)
--          -> provider result (recorded by a trusted writer)
--          -> evidence row 'provider_result' + reviewer checklist
--          -> approve_verification (unchanged) -> student_verified_credentials -> badge
--
-- Trusted writer without a service key: ingest_provider_result() is callable by the web server's
-- anonymous connection, but only with a long random key whose SHA-256 an administrator stored in
-- verification_writer_keys. It can only record a provider result on an existing attempt; it cannot
-- approve anything. Credentials are issued only by approve_verification, by an assigned reviewer.

-- ---------------------------------------------------------------------------
-- Request side
-- ---------------------------------------------------------------------------
alter table public.student_verification_requests drop constraint svr_method_valid;
alter table public.student_verification_requests add constraint svr_method_valid check (method in (
  'INSTITUTIONAL_EMAIL', 'ISSUER_BACKED_DOCUMENT_SHARE', 'OFFICIAL_ATTESTATION_REVIEW',
  'REGISTRAR_CONFIRMATION', 'FEDERATED_INSTITUTION_LOGIN', 'PROVIDER_VERIFICATION'));
alter table public.student_verified_credentials drop constraint svc_method_valid;
alter table public.student_verified_credentials add constraint svc_method_valid check (verification_method in (
  'ISSUER_BACKED_DOCUMENT_SHARE', 'OFFICIAL_ATTESTATION_REVIEW', 'REGISTRAR_CONFIRMATION',
  'FEDERATED_INSTITUTION_LOGIN', 'PROVIDER_VERIFICATION'));
alter table public.student_verification_evidence drop constraint sve_type_valid;
alter table public.student_verification_evidence add constraint sve_type_valid check (evidence_type in (
  'official_attestation', 'issuer_share_reference', 'registrar_confirmation', 'supporting_document', 'provider_result'));

-- A provider request only ever asks for the general student claim.
alter table public.student_verification_requests add constraint svr_provider_general_only
  check (method <> 'PROVIDER_VERIFICATION' or requested_claim_type = 'CURRENT_STUDENT');
alter table public.student_verification_requests add constraint svr_id_user_unique unique (id, user_id);

-- ---------------------------------------------------------------------------
-- Attempts belong to a request of the same member
-- ---------------------------------------------------------------------------
alter table public.verification_attempts add column request_id uuid;
alter table public.verification_attempts add column last_checked_at timestamptz;
alter table public.verification_attempts
  add constraint va_request_fk foreign key (request_id, user_id)
  references public.student_verification_requests (id, user_id) on delete cascade;
alter table public.verification_attempts add constraint va_request_required check (request_id is not null) not valid;
create index va_request_idx on public.verification_attempts (request_id, created_at desc);

create table public.verification_writer_keys (
  key_hash text primary key,
  label text not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint vwk_hash_shape check (key_hash ~ '^[0-9a-f]{64}$')
);
alter table public.verification_writer_keys enable row level security;
revoke all on public.verification_writer_keys from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Member: start a provider request, then attempts under it
-- ---------------------------------------------------------------------------
create function public.start_provider_request(p_institution uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  rid uuid;
begin
  if me is null or not private.is_member() then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from public.academic_institutions where id = p_institution and active) then
    raise exception 'Unknown institution.' using errcode = 'no_data_found';
  end if;
  -- Reuse the open provider request: a new attempt is the retry, history stays on one request.
  select id into rid from public.student_verification_requests
    where user_id = me and institution_id = p_institution and requested_claim_type = 'CURRENT_STUDENT'
      and requested_program_id is null and method = 'PROVIDER_VERIFICATION'
      and status in ('AWAITING_EVIDENCE', 'SUBMITTED', 'UNDER_REVIEW', 'MORE_INFORMATION_REQUIRED');
  if found then return rid; end if;
  if (select count(*) from public.student_verification_requests
        where user_id = me and created_at > now() - interval '24 hours') >= 5 then
    raise exception 'You have started several requests today. Please try again tomorrow.' using errcode = 'check_violation';
  end if;
  insert into public.student_verification_requests (user_id, institution_id, requested_claim_type, method)
    values (me, p_institution, 'CURRENT_STUDENT', 'PROVIDER_VERIFICATION') returning id into rid;
  insert into public.verification_review_events (request_id, actor_id, from_status, to_status, event)
    values (rid, me, null, 'DRAFT', 'created');
  perform private.transition_request(rid, 'AWAITING_EVIDENCE', 'provider_started');
  return rid;
exception when unique_violation then
  raise exception 'You already have an open request for this.' using errcode = 'check_violation';
end;
$$;

drop function public.start_provider_attempt(uuid, text, text, text);
create function public.start_provider_attempt(p_request uuid, p_provider text, p_provider_attempt_id text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  r public.student_verification_requests;
  cfg public.verification_provider_configs;
  new_id uuid;
begin
  if me is null or not private.is_member() then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  r := private.owned_request(p_request);
  if r.method <> 'PROVIDER_VERIFICATION' or r.status not in ('AWAITING_EVIDENCE', 'MORE_INFORMATION_REQUIRED') then
    raise exception 'This request cannot start a provider attempt.' using errcode = 'check_violation';
  end if;
  select * into cfg from public.verification_provider_configs where provider = p_provider;
  if not found or not cfg.enabled or not (r.requested_claim_type = any (cfg.claims)) then
    raise exception 'That verification provider is not available.' using errcode = 'check_violation';
  end if;
  if (select count(*) from public.verification_attempts where user_id = me and created_at > now() - interval '24 hours') >= 5 then
    raise exception 'You have started several attempts today. Please try again tomorrow.' using errcode = 'check_violation';
  end if;
  insert into public.verification_attempts (user_id, request_id, institution_id, provider, claim_type, provider_attempt_id, environment)
    values (me, p_request, r.institution_id, p_provider, r.requested_claim_type, p_provider_attempt_id, cfg.environment)
    returning id into new_id;
  return new_id;
exception when unique_violation then
  raise exception 'You already have an open attempt for this.' using errcode = 'check_violation';
end;
$$;

-- ---------------------------------------------------------------------------
-- Recording a provider result (shared by the administrator path and the trusted writer)
-- ---------------------------------------------------------------------------
create function private.attempt_rank(p_state text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_state
    when 'created' then 0 when 'redirected' then 0
    when 'provider_error' then 1 when 'provider_pending' then 1
    when 'requires_review' then 2
    when 'proof_received' then 3 when 'rejected' then 3
    else 9 end;
$$;

create function private.apply_provider_result(
  p_attempt uuid, p_event_hash text, p_outcome text, p_state text, p_linkage text,
  p_issuer_validated boolean, p_valid_until timestamptz, p_subject_hash text, p_digest text, p_actor uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.verification_attempts;
  days integer;
  ref text;
  evidence_id uuid;
begin
  if p_state not in ('provider_pending', 'proof_received', 'requires_review', 'rejected', 'provider_error') then
    raise exception 'That result state is not allowed.' using errcode = 'check_violation';
  end if;
  select * into a from public.verification_attempts where id = p_attempt for update;
  if not found then raise exception 'Not found' using errcode = 'no_data_found'; end if;
  update public.verification_attempts set last_checked_at = now() where id = p_attempt;
  -- A repeated event is a no-op, so provider retries and double clicks cannot change a decision.
  if exists (select 1 from public.verification_provider_events where attempt_id = p_attempt and event_hash = p_event_hash) then
    return a.state;
  end if;
  if private.attempt_rank(a.state) = 9 or a.expires_at < now() then
    raise exception 'This attempt can no longer take a result.' using errcode = 'check_violation';
  end if;
  -- Out-of-order delivery: a result may only move an attempt forward, never back.
  if private.attempt_rank(p_state) <= private.attempt_rank(a.state) then
    insert into public.verification_provider_events (attempt_id, event_hash, outcome, to_state, actor_id)
      values (p_attempt, p_event_hash, p_outcome, a.state, p_actor);
    return a.state;
  end if;
  update public.verification_attempts
     set state = p_state, linkage = p_linkage, issuer_validated = p_issuer_validated, valid_until = p_valid_until,
         subject_hash = p_subject_hash, evidence_digest = p_digest, updated_at = now()
   where id = p_attempt;
  insert into public.verification_provider_events (attempt_id, event_hash, outcome, to_state, actor_id)
    values (p_attempt, p_event_hash, p_outcome, p_state, p_actor);
  -- A result a reviewer can use becomes an (unvalidated) evidence row on the request.
  if p_state in ('proof_received', 'requires_review') then
    ref := 'provider:' || a.provider || ':' || coalesce(a.provider_attempt_id, a.id::text);
    if not exists (select 1 from public.student_verification_evidence where request_id = a.request_id and source_reference = ref) then
      select evidence_retention_days into days from public.verification_policy;
      insert into public.student_verification_evidence (request_id, evidence_type, source_reference, retention_delete_at)
        values (a.request_id, 'provider_result', ref, now() + make_interval(days => days));
    end if;
  end if;
  insert into public.verification_audit_log (actor_id, action, target_type, target_id, metadata)
    values (p_actor, 'verification.provider_result', 'attempt', p_attempt,
            jsonb_build_object('provider', a.provider, 'state', p_state, 'outcome', p_outcome));
  return p_state;
exception when unique_violation then
  raise exception 'This provider identity is already linked to another account.' using errcode = 'check_violation';
end;
$$;
revoke all on function private.apply_provider_result(uuid, text, text, text, text, boolean, timestamptz, text, text, uuid) from public;
revoke all on function private.attempt_rank(text) from public;

create or replace function public.record_provider_result(
  p_attempt uuid, p_event_hash text, p_outcome text, p_state text, p_linkage text,
  p_issuer_validated boolean, p_valid_until timestamptz, p_subject_hash text, p_digest text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare me uuid := (select auth.uid());
begin
  if me is null or not private.is_admin() then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  return private.apply_provider_result(p_attempt, p_event_hash, p_outcome, p_state, p_linkage,
    p_issuer_validated, p_valid_until, p_subject_hash, p_digest, me);
end;
$$;

-- Trusted writer. Authenticated by a key, never by a user id in the payload.
create function private.writer_key_ok(p_secret text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_secret is not null and char_length(p_secret) >= 32 and exists (
    select 1 from public.verification_writer_keys k
    where k.revoked_at is null and k.key_hash = encode(sha256(convert_to(p_secret, 'UTF8')), 'hex'));
$$;
revoke all on function private.writer_key_ok(text) from public;

create function public.provider_attempt_context(p_secret text, p_provider text, p_provider_attempt_id text)
returns table (attempt_id uuid, claim_type text, state text, enabled boolean, environment text, contract_state text, claims text[])
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.writer_key_ok(p_secret) then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  return query
    select a.id, a.claim_type, a.state, c.enabled, c.environment, c.contract_state, c.claims
    from public.verification_attempts a join public.verification_provider_configs c on c.provider = a.provider
    where a.provider = p_provider and a.provider_attempt_id = p_provider_attempt_id;
end;
$$;

create function public.ingest_provider_result(
  p_secret text, p_provider text, p_provider_attempt_id text, p_event_hash text, p_outcome text, p_state text,
  p_linkage text, p_issuer_validated boolean, p_valid_until timestamptz, p_subject_hash text, p_digest text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare aid uuid;
begin
  if not private.writer_key_ok(p_secret) then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  select id into aid from public.verification_attempts where provider = p_provider and provider_attempt_id = p_provider_attempt_id;
  if not found then raise exception 'Not found' using errcode = 'no_data_found'; end if;
  return private.apply_provider_result(aid, p_event_hash, p_outcome, p_state, p_linkage,
    p_issuer_validated, p_valid_until, p_subject_hash, p_digest, null);
end;
$$;
revoke all on function public.provider_attempt_context(text, text, text) from public;
revoke all on function public.ingest_provider_result(text, text, text, text, text, text, text, boolean, timestamptz, text, text) from public;
grant execute on function public.provider_attempt_context(text, text, text) to anon, authenticated;
grant execute on function public.ingest_provider_result(text, text, text, text, text, text, text, boolean, timestamptz, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Reviewer: copy a policy-eligible provider result into the checklist. Approval stays separate.
-- ---------------------------------------------------------------------------
create function public.apply_provider_result_to_review(p_request uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := private.require_reviewer();
  r public.student_verification_requests;
  a public.verification_attempts;
  cfg public.verification_provider_configs;
  ref text;
begin
  r := private.assigned_request(p_request);
  if r.user_id = me then
    raise exception 'You cannot review your own request.' using errcode = 'insufficient_privilege';
  end if;
  select * into a from public.verification_attempts
    where request_id = p_request and state = 'proof_received' order by updated_at desc limit 1;
  if not found then
    raise exception 'No provider result is ready to apply. Check it manually.' using errcode = 'check_violation';
  end if;
  select * into cfg from public.verification_provider_configs where provider = a.provider;
  if a.environment = 'production' and (a.provider = 'simulated' or cfg.contract_state <> 'live') then
    raise exception 'Test results cannot be used in production.' using errcode = 'check_violation';
  end if;
  -- The database re-checks what the policy engine decided: nothing weaker is copied.
  if a.linkage is distinct from 'strong' or a.issuer_validated is not true or a.subject_hash is null
     or char_length(a.subject_hash) < 16 or (a.valid_until is not null and a.valid_until <= now()) then
    raise exception 'This result is not strong enough to copy; complete the checklist manually.' using errcode = 'check_violation';
  end if;
  ref := 'provider:' || a.provider || ':' || coalesce(a.provider_attempt_id, a.id::text);
  update public.student_verification_evidence set validation_status = 'validated'
    where request_id = p_request and source_reference = ref and evidence_type = 'provider_result';
  insert into public.verification_review_details as d
    (request_id, issuer_verified, issuer_name, identity_linkage, enrolment_confirmed, program_confirmed,
     term_end, registrar_result, binding_hash, reviewer_notes)
  values (p_request, true,
          case when a.provider = 'simulated' then 'TEST ONLY: simulated provider' else a.provider end,
          'matched', true, false, a.valid_until::date, 'not_requested', a.subject_hash,
          'Copied from provider result (' || a.provider || ').')
  on conflict (request_id) do update set
    issuer_verified = true, issuer_name = excluded.issuer_name, identity_linkage = 'matched',
    enrolment_confirmed = true, program_confirmed = false, term_end = excluded.term_end,
    binding_hash = excluded.binding_hash, reviewer_notes = excluded.reviewer_notes, updated_at = now();
  perform private.vaudit('verification.apply_provider', 'request', p_request, jsonb_build_object('attempt', a.id, 'provider', a.provider));
end;
$$;

-- ---------------------------------------------------------------------------
-- Keep attempt history in step with the request's outcome
-- ---------------------------------------------------------------------------
create function private.sync_attempts_with_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    update public.verification_attempts set updated_at = now(), state = case new.status
        when 'APPROVED' then 'approved' when 'REJECTED' then 'rejected' when 'REVOKED' then 'revoked'
        when 'EXPIRED' then 'expired' else 'cancelled' end
      where request_id = new.id
        and ((new.status = 'APPROVED' and state = 'proof_received')
          or (new.status in ('REJECTED', 'WITHDRAWN') and state in ('created', 'redirected', 'provider_pending', 'requires_review', 'proof_received'))
          or (new.status in ('REVOKED', 'EXPIRED') and state = 'approved'));
  end if;
  return new;
end;
$$;
revoke all on function private.sync_attempts_with_request() from public;
create trigger svr_sync_attempts after update on public.student_verification_requests
  for each row execute function private.sync_attempts_with_request();

grant select (id, user_id, request_id, institution_id, provider, claim_type, state, environment, linkage, issuer_validated,
  valid_until, expires_at, last_checked_at, created_at, updated_at) on public.verification_attempts to authenticated;
