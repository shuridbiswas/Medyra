-- Montréal student SSO (provisional affiliation) and document-program analysis.
--
-- Additive. Nothing here issues a badge: a university login can only produce a private, short-lived
-- PROVISIONAL status, and a document analysis can only be copied into the reviewer checklist after
-- the document's authenticity was confirmed. approve_verification stays the only issuer.
-- Writes that depend on a server-side validation (the SSO callback, the document analysis) go through
-- the same keyed trusted writer as provider results (private.writer_key_ok): no service key.

-- ---------------------------------------------------------------------------
-- Program catalogue: bilingual names for exact matching
-- ---------------------------------------------------------------------------
alter table public.academic_programs add column name_fr text;
alter table public.academic_programs add column aliases text[] not null default '{}';

-- ---------------------------------------------------------------------------
-- Which institutions Medyra may send members to. Candidates only until an approved connection exists.
-- ---------------------------------------------------------------------------
create table public.institution_sso_connections (
  institution_id uuid primary key references public.academic_institutions (id) on delete cascade,
  protocol text not null default 'oidc',
  approval_state text not null default 'researched',
  issuer text,
  entity_id text,
  metadata_ref text,
  client_id text,
  affiliation_scopes text[] not null default '{}',
  approved_claims text[] not null default '{}',
  last_checked_at timestamptz,
  contact text,
  note text,
  updated_at timestamptz not null default now(),
  constraint isc_protocol_valid check (protocol in ('oidc', 'saml', 'contracted_provider', 'mock')),
  constraint isc_state_valid check (approval_state in ('researched', 'pending_approval', 'sandbox_approved', 'production_approved', 'disabled')),
  constraint isc_mock_never_production check (protocol <> 'mock' or approval_state <> 'production_approved'),
  constraint isc_https check (issuer is null or issuer like 'https://%'),
  constraint isc_approved_needs_issuer check (
    approval_state not in ('sandbox_approved', 'production_approved') or protocol = 'mock'
    or (issuer is not null and client_id is not null and cardinality(affiliation_scopes) > 0))
);
insert into public.institution_sso_connections (institution_id)
  select id from public.academic_institutions where slug in ('udem', 'mcgill', 'uqam', 'concordia', 'polymtl', 'ets', 'hec', 'inrs');

-- ---------------------------------------------------------------------------
-- Attempts. The state value is random and single-use; only its hash is stored.
-- ---------------------------------------------------------------------------
create table public.institution_sso_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  request_id uuid not null,
  institution_id uuid not null references public.academic_institutions (id),
  state_hash text not null unique,
  status text not null default 'started',
  failure_code text,
  subject_hash text,
  affiliation_current boolean,
  affiliation_evidence text,
  auth_at timestamptz,
  provisional_until timestamptz,
  expires_at timestamptz not null default now() + interval '10 minutes',
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint isa_request_fk foreign key (request_id, user_id)
    references public.student_verification_requests (id, user_id) on delete cascade,
  constraint isa_status_valid check (status in ('started', 'sso_confirmed_only', 'provisional', 'review_required', 'failed', 'cancelled', 'expired')),
  constraint isa_hash_shape check (state_hash ~ '^[0-9a-f]{64}$')
);
create unique index isa_one_open on public.institution_sso_attempts (request_id) where status = 'started';
create index isa_user_idx on public.institution_sso_attempts (user_id, created_at desc);

-- One university identity belongs to one Medyra account (keyed hash of issuer + subject).
create table public.verified_institutional_subjects (
  institution_id uuid not null references public.academic_institutions (id),
  subject_hash text not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  first_seen_at timestamptz not null default now(),
  primary key (institution_id, subject_hash)
);

-- ---------------------------------------------------------------------------
-- Document analysis: structured, minimal, no names and no text.
-- ---------------------------------------------------------------------------
create table public.document_program_analysis (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.student_verification_requests (id) on delete cascade,
  evidence_id uuid not null unique references public.student_verification_evidence (id) on delete cascade,
  document_type text not null,
  language text not null default 'unknown',
  claimed_status text not null default 'unknown',
  term_start date,
  term_end date,
  matched_program_id uuid references public.academic_programs (id),
  matched_institution_id uuid references public.academic_institutions (id),
  name_match text not null default 'not_checked',
  authenticity text not null default 'NOT_CHECKED',
  ambiguity_flags text[] not null default '{}',
  model_version text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dpa_type_valid check (document_type in ('current_enrollment', 'admission', 'transcript', 'diploma', 'student_card', 'unknown')),
  constraint dpa_lang_valid check (language in ('fr', 'en', 'mixed', 'unknown')),
  constraint dpa_status_valid check (claimed_status in ('current', 'past', 'future', 'unknown')),
  constraint dpa_name_valid check (name_match in ('matched', 'mismatch', 'ambiguous', 'not_checked')),
  constraint dpa_auth_valid check (authenticity in ('NOT_CHECKED', 'ISSUER_VALIDATED', 'DIGITAL_SIGNATURE_VALIDATED', 'REGISTRAR_CONFIRMED', 'UNVERIFIABLE', 'SUSPECTED_TAMPERING')),
  constraint dpa_term_order check (term_start is null or term_end is null or term_start <= term_end)
);

-- ---------------------------------------------------------------------------
-- Member: start an SSO attempt on their own request
-- ---------------------------------------------------------------------------
create function public.start_sso_attempt(p_request uuid, p_state_hash text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  r public.student_verification_requests;
  c public.institution_sso_connections;
  new_id uuid;
begin
  if me is null or not private.is_member() then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  r := private.owned_request(p_request);
  if r.status not in ('AWAITING_EVIDENCE', 'MORE_INFORMATION_REQUIRED', 'DRAFT', 'AWAITING_EMAIL_VERIFICATION') then
    raise exception 'This request cannot start a university login.' using errcode = 'check_violation';
  end if;
  select * into c from public.institution_sso_connections where institution_id = r.institution_id;
  if not found or c.approval_state not in ('sandbox_approved', 'production_approved') then
    raise exception 'University login is not available for this institution.' using errcode = 'check_violation';
  end if;
  if (select count(*) from public.institution_sso_attempts where user_id = me and created_at > now() - interval '24 hours') >= 10 then
    raise exception 'Please try again tomorrow.' using errcode = 'check_violation';
  end if;
  -- An old unfinished attempt is closed so the member can retry.
  update public.institution_sso_attempts set status = 'expired', completed_at = now()
    where request_id = p_request and status = 'started' and expires_at < now();
  insert into public.institution_sso_attempts (user_id, request_id, institution_id, state_hash)
    values (me, p_request, r.institution_id, p_state_hash) returning id into new_id;
  return new_id;
exception when unique_violation then
  raise exception 'A university login is already in progress.' using errcode = 'check_violation';
end;
$$;

create function public.cancel_sso_attempt(p_attempt uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.institution_sso_attempts set status = 'cancelled', completed_at = now()
    where id = p_attempt and user_id = (select auth.uid()) and status = 'started';
  if not found then raise exception 'That attempt cannot be cancelled.' using errcode = 'check_violation'; end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Trusted writer: callback context and completion
-- ---------------------------------------------------------------------------
create function public.sso_attempt_context(p_secret text, p_state_hash text)
returns table (attempt_id uuid, request_id uuid, user_id uuid, institution_id uuid, status text, expired boolean,
               protocol text, approval_state text, issuer text, client_id text, affiliation_scopes text[])
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.writer_key_ok(p_secret) then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  return query
    select a.id, a.request_id, a.user_id, a.institution_id, a.status, a.expires_at < now(),
           c.protocol, c.approval_state, c.issuer, c.client_id, c.affiliation_scopes
    from public.institution_sso_attempts a
    join public.institution_sso_connections c on c.institution_id = a.institution_id
    where a.state_hash = p_state_hash;
end;
$$;

-- p_outcome: 'student' (a trusted signed claim says current student), 'confirmed_only' (login only), 'failed'.
create function public.complete_sso_attempt(
  p_secret text, p_attempt uuid, p_outcome text, p_failure text, p_subject_hash text,
  p_evidence text, p_auth_at timestamptz, p_provisional_until timestamptz
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.institution_sso_attempts;
  final text;
  until_ts timestamptz;
  other uuid;
begin
  if not private.writer_key_ok(p_secret) then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  if p_outcome not in ('student', 'confirmed_only', 'failed') then
    raise exception 'Unknown outcome.' using errcode = 'check_violation';
  end if;
  select * into a from public.institution_sso_attempts where id = p_attempt for update;
  if not found then raise exception 'Not found' using errcode = 'no_data_found'; end if;
  -- Single use: a replayed callback returns the recorded result and changes nothing.
  if a.status <> 'started' then return a.status; end if;
  if a.expires_at < now() then
    update public.institution_sso_attempts set status = 'expired', completed_at = now() where id = p_attempt;
    return 'expired';
  end if;
  if p_outcome = 'failed' then
    final := 'failed';
  else
    final := 'sso_confirmed_only';
    if p_subject_hash is not null then
      select user_id into other from public.verified_institutional_subjects
        where institution_id = a.institution_id and subject_hash = p_subject_hash;
      if found and other <> a.user_id then
        final := 'review_required'; -- this university identity already belongs to another Medyra account
      else
        insert into public.verified_institutional_subjects (institution_id, subject_hash, user_id)
          values (a.institution_id, p_subject_hash, a.user_id) on conflict do nothing;
        if p_outcome = 'student' and p_provisional_until is not null and p_provisional_until > now() then
          final := 'provisional';
          until_ts := least(p_provisional_until, now() + interval '30 days');
        end if;
      end if;
    end if;
  end if;
  update public.institution_sso_attempts
     set status = final, failure_code = left(p_failure, 60), subject_hash = p_subject_hash,
         affiliation_current = (p_outcome = 'student'), affiliation_evidence = left(p_evidence, 80),
         auth_at = p_auth_at, provisional_until = until_ts, completed_at = now()
   where id = p_attempt;
  insert into public.verification_audit_log (actor_id, action, target_type, target_id, metadata)
    values (null, 'verification.sso_result', 'request', a.request_id, jsonb_build_object('status', final, 'institution', a.institution_id));
  return final;
end;
$$;

-- A member's private view of "school affiliation confirmed": derived, so it can never outlive its expiry.
create function public.my_provisional_affiliations()
returns table (request_id uuid, institution_id uuid, provisional_until timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select a.request_id, a.institution_id, a.provisional_until
  from public.institution_sso_attempts a
  where a.user_id = (select auth.uid()) and a.status = 'provisional' and a.provisional_until > now();
$$;

-- ---------------------------------------------------------------------------
-- Documents: record an analysis (trusted writer), set authenticity (reviewer), copy to the checklist
-- ---------------------------------------------------------------------------
create function public.record_document_analysis(
  p_secret text, p_evidence uuid, p_type text, p_language text, p_status text, p_term_start date, p_term_end date,
  p_program uuid, p_institution uuid, p_name_match text, p_flags text[], p_model text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare e public.student_verification_evidence; aid uuid;
begin
  if not private.writer_key_ok(p_secret) then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  select * into e from public.student_verification_evidence where id = p_evidence and deleted_at is null;
  if not found then raise exception 'Not found' using errcode = 'no_data_found'; end if;
  -- The analysis never carries authenticity: a re-analysis resets it to NOT_CHECKED.
  insert into public.document_program_analysis
    (request_id, evidence_id, document_type, language, claimed_status, term_start, term_end, matched_program_id,
     matched_institution_id, name_match, ambiguity_flags, model_version)
  values (e.request_id, p_evidence, p_type, p_language, p_status, p_term_start, p_term_end, p_program,
          p_institution, p_name_match, coalesce(p_flags, '{}'), p_model)
  on conflict (evidence_id) do update set
    document_type = excluded.document_type, language = excluded.language, claimed_status = excluded.claimed_status,
    term_start = excluded.term_start, term_end = excluded.term_end, matched_program_id = excluded.matched_program_id,
    matched_institution_id = excluded.matched_institution_id, name_match = excluded.name_match,
    ambiguity_flags = excluded.ambiguity_flags, model_version = excluded.model_version,
    authenticity = 'NOT_CHECKED', updated_at = now()
  returning id into aid;
  return aid;
end;
$$;

create function public.set_document_authenticity(p_analysis uuid, p_state text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare d public.document_program_analysis;
begin
  perform private.require_reviewer();
  if p_state not in ('ISSUER_VALIDATED', 'DIGITAL_SIGNATURE_VALIDATED', 'REGISTRAR_CONFIRMED', 'UNVERIFIABLE', 'SUSPECTED_TAMPERING') then
    raise exception 'Unknown authenticity result.' using errcode = 'check_violation';
  end if;
  select * into d from public.document_program_analysis where id = p_analysis;
  if not found then raise exception 'Not found' using errcode = 'no_data_found'; end if;
  perform private.assigned_request(d.request_id);
  update public.document_program_analysis set authenticity = p_state, updated_at = now() where id = p_analysis;
  perform private.vaudit('verification.document_authenticity', 'request', d.request_id, jsonb_build_object('state', p_state));
end;
$$;

create function public.apply_document_analysis_to_review(p_request uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := private.require_reviewer();
  r public.student_verification_requests;
  d public.document_program_analysis;
  e public.student_verification_evidence;
  prog_ok boolean := false;
  binding text;
begin
  r := private.assigned_request(p_request);
  if r.user_id = me then
    raise exception 'You cannot review your own request.' using errcode = 'insufficient_privilege';
  end if;
  select a.* into d from public.document_program_analysis a
    where a.request_id = p_request and a.authenticity in ('ISSUER_VALIDATED', 'DIGITAL_SIGNATURE_VALIDATED', 'REGISTRAR_CONFIRMED')
    order by a.updated_at desc limit 1;
  if not found then
    raise exception 'No document with confirmed authenticity. Confirm the issuer first.' using errcode = 'check_violation';
  end if;
  if d.document_type <> 'current_enrollment' or d.claimed_status <> 'current' then
    raise exception 'The document is not a current enrolment document.' using errcode = 'check_violation';
  end if;
  if d.term_end is null or d.term_end < current_date or (d.term_start is not null and d.term_start > current_date + 31) then
    raise exception 'The document does not show a current academic term.' using errcode = 'check_violation';
  end if;
  if d.name_match <> 'matched' then
    raise exception 'The name on the document is not matched to the member.' using errcode = 'check_violation';
  end if;
  if d.matched_institution_id is distinct from r.institution_id then
    raise exception 'The document is from a different institution.' using errcode = 'check_violation';
  end if;
  -- Program: exact catalogue match to the requested, reviewed program, or no program claim at all.
  if r.requested_claim_type = 'CURRENT_PROGRAM_STUDENT' then
    prog_ok := d.matched_program_id is not distinct from r.requested_program_id and d.matched_program_id is not null
      and exists (select 1 from public.academic_programs g where g.id = d.matched_program_id and g.active and g.source_reviewed_at is not null);
    if not prog_ok then
      raise exception 'The document does not confirm the requested program.' using errcode = 'check_violation';
    end if;
  end if;
  -- The file must have passed inspection before its analysis is used.
  select * into e from public.student_verification_evidence where id = d.evidence_id and deleted_at is null;
  if not found or e.scan_status not in ('static_ok', 'av_clean') then
    raise exception 'Inspect the file before using its analysis.' using errcode = 'check_violation';
  end if;
  -- Identity reference: keep one the reviewer already recorded. A simulated (mock) SSO subject is never used.
  select v.binding_hash into binding from public.verification_review_details v where v.request_id = p_request;
  if binding is null then
    select a.subject_hash into binding from public.institution_sso_attempts a
      join public.institution_sso_connections c on c.institution_id = a.institution_id
     where a.request_id = p_request and a.status = 'provisional' and c.protocol <> 'mock'
     order by a.completed_at desc limit 1;
  end if;
  if binding is null or char_length(binding) < 16 then
    raise exception 'Record an identity reference in the checklist first.' using errcode = 'check_violation';
  end if;
  update public.student_verification_evidence set validation_status = 'validated' where id = d.evidence_id;
  insert into public.verification_review_details as v
    (request_id, issuer_verified, issuer_name, identity_linkage, enrolment_confirmed, program_confirmed, term_start, term_end,
     registrar_result, binding_hash, reviewer_notes)
  values (p_request, true, 'Issuer-confirmed document', 'matched', true, prog_ok, d.term_start, d.term_end,
          case when d.authenticity = 'REGISTRAR_CONFIRMED' then 'confirmed' else 'not_requested' end, binding,
          'Copied from document analysis (' || d.authenticity || ').')
  on conflict (request_id) do update set
    issuer_verified = true, issuer_name = excluded.issuer_name, identity_linkage = 'matched', enrolment_confirmed = true,
    program_confirmed = excluded.program_confirmed, term_start = excluded.term_start, term_end = excluded.term_end,
    registrar_result = excluded.registrar_result, binding_hash = excluded.binding_hash,
    reviewer_notes = excluded.reviewer_notes, updated_at = now();
  perform private.vaudit('verification.apply_document', 'request', p_request, jsonb_build_object('analysis', d.id, 'program', prog_ok));
end;
$$;

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------
alter table public.institution_sso_connections enable row level security;
alter table public.institution_sso_attempts enable row level security;
alter table public.verified_institutional_subjects enable row level security;
alter table public.document_program_analysis enable row level security;
revoke all on public.institution_sso_connections, public.institution_sso_attempts,
  public.verified_institutional_subjects, public.document_program_analysis from anon, authenticated;
-- Members see only whether a connection is usable; the issuer details stay with staff.
grant select (institution_id, protocol, approval_state) on public.institution_sso_connections to authenticated;
grant update (protocol, approval_state, issuer, entity_id, metadata_ref, client_id, affiliation_scopes, approved_claims,
  last_checked_at, contact, note, updated_at) on public.institution_sso_connections to authenticated;
grant select (id, user_id, request_id, institution_id, status, failure_code, provisional_until, expires_at, created_at, completed_at)
  on public.institution_sso_attempts to authenticated;
grant select on public.document_program_analysis to authenticated;

create policy "sso connections: members read" on public.institution_sso_connections for select to authenticated
  using ((select private.is_member()));
create policy "sso connections: staff update" on public.institution_sso_connections for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "sso attempts: owner or staff read" on public.institution_sso_attempts for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_admin()));
create policy "document analysis: staff read" on public.document_program_analysis for select to authenticated
  using ((select private.is_admin()));

revoke all on function public.sso_attempt_context(text, text) from public;
revoke all on function public.complete_sso_attempt(text, uuid, text, text, text, text, timestamptz, timestamptz) from public;
revoke all on function public.record_document_analysis(text, uuid, text, text, text, date, date, uuid, uuid, text, text[], text) from public;
grant execute on function public.sso_attempt_context(text, text) to anon, authenticated;
grant execute on function public.complete_sso_attempt(text, uuid, text, text, text, text, timestamptz, timestamptz) to anon, authenticated;
grant execute on function public.record_document_analysis(text, uuid, text, text, text, date, date, uuid, uuid, text, text[], text) to anon, authenticated;
