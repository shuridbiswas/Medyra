-- Quebec student credential verification (MVP).
--
-- Two independent claims: CURRENT_STUDENT and CURRENT_PROGRAM_STUDENT. A badge exists only while a
-- row in student_verified_credentials is valid (not revoked, not ended, not past expires_at); the
-- check is made at read time, so an expiry or revocation takes effect immediately, with no cache.
--
--   * Reference data: academic_institutions, institution_verification_methods, program_categories,
--     academic_programs (all editable by administrators in SQL; nothing here is invented: domains
--     and sources not yet researched are recorded as unconfirmed).
--   * Requests move through an explicit state machine (private.can_transition). Members can only
--     read their own rows; every change goes through a security definer function.
--   * Reviewer-only detail (checks, notes, binding hash) lives in verification_review_details.
--   * Credentials are issued only inside approve_verification(), in the same transaction as the
--     decision, the event and the audit row, with the request row locked against concurrent decisions.
--   * Evidence files live in the private bucket student-verification-evidence.

-- ---------------------------------------------------------------------------
-- Notifications: a new type and entity
-- ---------------------------------------------------------------------------
alter table public.notifications drop constraint notifications_type_valid;
alter table public.notifications add constraint notifications_type_valid check (type in (
  'connection_request', 'connection_accepted', 'post_comment', 'comment_reply', 'mention',
  'community_event', 'mentorship_event',
  'community_join_request', 'community_request_approved', 'community_post_removed',
  'forum_answer', 'forum_reply', 'forum_answer_accepted',
  'message_request',
  'verification_update'
));
alter table public.notifications drop constraint notifications_entity_valid;
alter table public.notifications add constraint notifications_entity_valid check (
  entity_type is null or entity_type in ('post', 'connection', 'community', 'mentorship', 'forum_question', 'conversation', 'verification')
);

-- ---------------------------------------------------------------------------
-- Policy settings (a single row; values are Medyra's, pending legal review)
-- ---------------------------------------------------------------------------
create table public.verification_policy (
  id boolean primary key default true,
  max_lifespan_days integer not null default 365,
  unknown_term_days integer not null default 90,
  reminder_days integer not null default 14,
  evidence_retention_days integer not null default 90,
  consent_version text not null default 'student-verification-2026-11-draft',
  constraint verification_policy_single check (id),
  constraint verification_policy_ranges check (
    max_lifespan_days between 30 and 730 and unknown_term_days between 7 and 365
    and reminder_days between 1 and 90 and evidence_retention_days between 7 and 730
  )
);
insert into public.verification_policy default values;

-- ---------------------------------------------------------------------------
-- Institutions
-- ---------------------------------------------------------------------------
create table public.academic_institutions (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  name_en text not null,
  name_fr text not null,
  website text,
  kind text not null,
  country text not null default 'CA',
  province text not null default 'QC',
  city text,
  -- Only domains an administrator has confirmed from an official source. Empty = unconfirmed.
  email_domains text[] not null default '{}',
  email_domains_status text not null default 'unconfirmed',
  registrar_url text,
  documents_url text,
  instructions_en text,
  instructions_fr text,
  manual_review_required boolean not null default true,
  integration_status text not null default 'none',
  source_checked_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint institutions_kind_valid check (kind in ('university', 'cegep', 'college')),
  constraint institutions_domains_status_valid check (email_domains_status in ('confirmed', 'unconfirmed')),
  constraint institutions_domains_need_confirmation check (
    email_domains = '{}' or email_domains_status = 'confirmed'
  ),
  constraint institutions_integration_valid check (integration_status in ('none', 'requires_permission', 'tested')),
  constraint institutions_urls_https check (
    (website is null or website like 'https://%') and (registrar_url is null or registrar_url like 'https://%')
    and (documents_url is null or documents_url like 'https://%')
  )
);

create table public.institution_verification_methods (
  institution_id uuid not null references public.academic_institutions (id) on delete cascade,
  method text not null,
  -- documented = published by the institution; requires_permission = needs an agreement we do not
  -- have; unverified = not yet researched.
  status text not null,
  source_url text,
  note text,
  primary key (institution_id, method),
  constraint ivm_method_valid check (method in (
    'INSTITUTIONAL_EMAIL', 'ISSUER_BACKED_DOCUMENT_SHARE', 'OFFICIAL_ATTESTATION_REVIEW',
    'REGISTRAR_CONFIRMATION', 'FEDERATED_INSTITUTION_LOGIN'
  )),
  constraint ivm_status_valid check (status in ('documented', 'requires_permission', 'unverified')),
  constraint ivm_source_https check (source_url is null or source_url like 'https://%')
);

create table public.program_categories (
  key text primary key,
  label_en text not null,
  label_fr text not null
);

create table public.academic_programs (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.academic_institutions (id) on delete cascade,
  category text not null references public.program_categories (key),
  official_name text not null,
  official_code text,
  credential_level text not null,
  catalog_url text,
  classification text not null,
  -- Null until a person has checked the program against the institution's official catalogue.
  -- Programs without a review date cannot be chosen by members.
  source_reviewed_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint programs_level_valid check (credential_level in ('attestation', 'diploma', 'dec', 'bachelor', 'master', 'doctorate', 'professional_doctorate', 'certificate')),
  constraint programs_classification_valid check (classification in (
    'direct_entry_professional', 'pre_professional', 'general_health', 'research'
  )),
  constraint programs_catalog_https check (catalog_url is null or catalog_url like 'https://%'),
  constraint programs_reviewed_needs_source check (source_reviewed_at is null or catalog_url is not null)
);
create unique index academic_programs_unique on public.academic_programs
  (institution_id, official_name, credential_level);

-- ---------------------------------------------------------------------------
-- Requests, evidence, reviewer details, credentials, events, audit, email challenges
-- ---------------------------------------------------------------------------
create table public.student_verification_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  institution_id uuid not null references public.academic_institutions (id),
  requested_program_id uuid references public.academic_programs (id),
  requested_claim_type text not null,
  method text not null,
  status text not null default 'DRAFT',
  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  updated_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles (id) on delete set null,
  assigned_to uuid references public.profiles (id) on delete set null,
  expires_at timestamptz,
  decision_reason_code text,
  -- Short note the member can read. Reviewers must never put sensitive detail here.
  student_message text,
  consent_version text,
  consent_timestamp timestamptz,
  email_verified_at timestamptz,
  email_domain text,
  constraint svr_claim_valid check (requested_claim_type in ('CURRENT_STUDENT', 'CURRENT_PROGRAM_STUDENT')),
  constraint svr_program_matches_claim check (
    (requested_claim_type = 'CURRENT_PROGRAM_STUDENT') = (requested_program_id is not null)
  ),
  constraint svr_method_valid check (method in (
    'INSTITUTIONAL_EMAIL', 'ISSUER_BACKED_DOCUMENT_SHARE', 'OFFICIAL_ATTESTATION_REVIEW',
    'REGISTRAR_CONFIRMATION', 'FEDERATED_INSTITUTION_LOGIN'
  )),
  constraint svr_status_valid check (status in (
    'DRAFT', 'AWAITING_EMAIL_VERIFICATION', 'AWAITING_EVIDENCE', 'SUBMITTED', 'UNDER_REVIEW',
    'MORE_INFORMATION_REQUIRED', 'APPROVED', 'REJECTED', 'WITHDRAWN', 'EXPIRED', 'REVOKED'
  )),
  constraint svr_message_length check (student_message is null or char_length(student_message) <= 500),
  constraint svr_reason_valid check (decision_reason_code is null or decision_reason_code in (
    'approved', 'not_current', 'program_not_confirmed', 'identity_mismatch', 'unverifiable_document',
    'duplicate_identity', 'wrong_institution', 'withdrawn', 'expired', 'revoked_fraud', 'revoked_error',
    'revoked_member_request', 'other'
  ))
);
create index svr_user_idx on public.student_verification_requests (user_id, created_at desc);
create index svr_queue_idx on public.student_verification_requests (status, submitted_at);
-- One live request per member, institution and claim; a second one for the same thing is refused.
create unique index svr_one_open on public.student_verification_requests
  (user_id, institution_id, requested_claim_type, coalesce(requested_program_id, '00000000-0000-0000-0000-000000000000'))
  where status in ('DRAFT', 'AWAITING_EMAIL_VERIFICATION', 'AWAITING_EVIDENCE', 'SUBMITTED', 'UNDER_REVIEW', 'MORE_INFORMATION_REQUIRED');

create table public.student_verification_evidence (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.student_verification_requests (id) on delete cascade,
  private_storage_path text,
  evidence_type text not null,
  -- A share number or link the member pasted. Stored as text only. It is NEVER fetched by Medyra;
  -- a reviewer opens it through the institution's own validation service.
  source_reference text,
  mime_type text,
  size_bytes integer,
  sha256 text,
  uploaded_at timestamptz not null default now(),
  retention_delete_at timestamptz not null,
  deleted_at timestamptz,
  -- pending: stored, not yet inspected. static_ok: bytes inspected by a reviewer-triggered server
  -- check (signature, no scripts or embedded files). av_clean: an antivirus scan passed (not wired
  -- yet). quarantined: failed inspection, never opened.
  scan_status text not null default 'pending',
  validation_status text not null default 'pending',
  constraint sve_type_valid check (evidence_type in (
    'official_attestation', 'issuer_share_reference', 'registrar_confirmation', 'supporting_document'
  )),
  constraint sve_has_content check (deleted_at is not null or private_storage_path is not null or source_reference is not null),
  constraint sve_reference_length check (source_reference is null or char_length(source_reference) between 4 and 500),
  constraint sve_mime_valid check (mime_type is null or mime_type in ('application/pdf', 'image/jpeg', 'image/png')),
  constraint sve_size_valid check (size_bytes is null or size_bytes between 1 and 5242880),
  constraint sve_scan_valid check (scan_status in ('pending', 'static_ok', 'av_clean', 'quarantined')),
  constraint sve_validation_valid check (validation_status in ('pending', 'validated', 'rejected'))
);
create index sve_request_idx on public.student_verification_evidence (request_id);
create unique index sve_path_unique on public.student_verification_evidence (private_storage_path)
  where private_storage_path is not null;

-- Reviewer-only. Members never read this.
create table public.verification_review_details (
  request_id uuid primary key references public.student_verification_requests (id) on delete cascade,
  issuer_verified boolean not null default false,
  issuer_name text,
  identity_linkage text not null default 'unchecked',
  enrolment_confirmed boolean not null default false,
  program_confirmed boolean not null default false,
  term_start date,
  term_end date,
  registrar_result text not null default 'not_requested',
  -- Keyed hash of the identity the document names (never the identifier itself); used only to
  -- stop one real student being bound to two accounts.
  binding_hash text,
  reviewer_notes text,
  updated_at timestamptz not null default now(),
  constraint vrd_linkage_valid check (identity_linkage in ('unchecked', 'matched', 'mismatch', 'ambiguous')),
  constraint vrd_registrar_valid check (registrar_result in ('not_requested', 'pending', 'confirmed', 'not_confirmed', 'ambiguous')),
  constraint vrd_notes_length check (reviewer_notes is null or char_length(reviewer_notes) <= 2000),
  constraint vrd_term_order check (term_start is null or term_end is null or term_start <= term_end),
  constraint vrd_binding_length check (binding_hash is null or char_length(binding_hash) between 16 and 128)
);

create table public.student_verified_credentials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  institution_id uuid not null references public.academic_institutions (id),
  academic_program_id uuid references public.academic_programs (id),
  claim_type text not null,
  issuer text not null,
  verification_method text not null,
  verified_by uuid references public.profiles (id) on delete set null,
  verified_at timestamptz not null default now(),
  academic_term_start date,
  academic_term_end date,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revocation_reason_code text,
  expired_at timestamptz,
  reminded_at timestamptz,
  source_reference_id uuid references public.student_verification_requests (id) on delete set null,
  -- Private binding to the real student (see verification_review_details.binding_hash). Not readable
  -- by members: the credential grants below leave it out.
  binding_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint svc_claim_valid check (claim_type in ('CURRENT_STUDENT', 'CURRENT_PROGRAM_STUDENT')),
  constraint svc_program_matches_claim check ((claim_type = 'CURRENT_PROGRAM_STUDENT') = (academic_program_id is not null)),
  constraint svc_method_valid check (verification_method in (
    'ISSUER_BACKED_DOCUMENT_SHARE', 'OFFICIAL_ATTESTATION_REVIEW', 'REGISTRAR_CONFIRMATION', 'FEDERATED_INSTITUTION_LOGIN'
  )),
  constraint svc_revoked_has_reason check ((revoked_at is null) = (revocation_reason_code is null))
);
create index svc_user_idx on public.student_verified_credentials (user_id);
create unique index svc_one_active_scope on public.student_verified_credentials
  (user_id, institution_id, claim_type, coalesce(academic_program_id, '00000000-0000-0000-0000-000000000000'))
  where revoked_at is null and expired_at is null;
create index svc_binding_idx on public.student_verified_credentials (institution_id, binding_hash)
  where binding_hash is not null and revoked_at is null and expired_at is null;

create table public.verification_review_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.student_verification_requests (id) on delete cascade,
  actor_id uuid references public.profiles (id) on delete set null,
  from_status text,
  to_status text,
  event text not null,
  created_at timestamptz not null default now()
);
create index vre_request_idx on public.verification_review_events (request_id, created_at);

create table public.verification_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles (id) on delete set null,
  action text not null,
  target_type text not null,
  target_id uuid,
  -- Ids and decisions only; never evidence, names, emails or notes.
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index val_recent_idx on public.verification_audit_log (created_at desc);

-- Append-only, except that an account deletion may blank the actor and cascade the rows away.
create function private.protect_verification_log()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.actor_id is null and old.actor_id is not null
     and (to_jsonb(new) - 'actor_id') = (to_jsonb(old) - 'actor_id') then
    return new;
  end if;
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception 'This log is append-only' using errcode = 'insufficient_privilege';
end;
$$;
create trigger verification_events_append_only before update or delete on public.verification_review_events
  for each row execute function private.protect_verification_log();
create trigger verification_audit_append_only before update or delete on public.verification_audit_log
  for each row execute function private.protect_verification_log();

create table public.institutional_email_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  request_id uuid not null references public.student_verification_requests (id) on delete cascade,
  institution_id uuid not null references public.academic_institutions (id),
  email_domain text not null,
  -- Keyed hashes only: the address and the code are never stored.
  email_hash text not null,
  code_hash text not null,
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  invalidated_at timestamptz
);
create index iec_user_idx on public.institutional_email_challenges (user_id, created_at desc);
-- One school address can confirm one account at an institution.
create unique index iec_address_once on public.institutional_email_challenges (institution_id, email_hash)
  where consumed_at is not null;

-- ---------------------------------------------------------------------------
-- Status machine
-- ---------------------------------------------------------------------------
create function private.can_transition(p_from text, p_to text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select (p_from, p_to) in (
    ('DRAFT', 'AWAITING_EMAIL_VERIFICATION'),
    ('DRAFT', 'AWAITING_EVIDENCE'),
    ('AWAITING_EMAIL_VERIFICATION', 'AWAITING_EVIDENCE'),
    ('AWAITING_EVIDENCE', 'SUBMITTED'),
    ('SUBMITTED', 'UNDER_REVIEW'),
    ('UNDER_REVIEW', 'APPROVED'),
    ('UNDER_REVIEW', 'REJECTED'),
    ('UNDER_REVIEW', 'MORE_INFORMATION_REQUIRED'),
    ('MORE_INFORMATION_REQUIRED', 'SUBMITTED'),
    ('APPROVED', 'EXPIRED'),
    ('APPROVED', 'REVOKED'),
    ('DRAFT', 'WITHDRAWN'),
    ('AWAITING_EMAIL_VERIFICATION', 'WITHDRAWN'),
    ('AWAITING_EVIDENCE', 'WITHDRAWN'),
    ('SUBMITTED', 'WITHDRAWN'),
    ('UNDER_REVIEW', 'WITHDRAWN'),
    ('MORE_INFORMATION_REQUIRED', 'WITHDRAWN')
  );
$$;

-- Defence in depth: even a definer function (or the table owner) cannot skip the machine, and the
-- owner, institution and claim of a request never change.
create function private.guard_request_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.user_id is distinct from old.user_id
     or new.institution_id is distinct from old.institution_id
     or new.requested_claim_type is distinct from old.requested_claim_type
     or new.requested_program_id is distinct from old.requested_program_id
     or new.method is distinct from old.method then
    raise exception 'A verification request cannot be re-assigned.' using errcode = 'check_violation';
  end if;
  if new.status is distinct from old.status and not private.can_transition(old.status, new.status) then
    raise exception 'That change is not allowed from the current status.' using errcode = 'check_violation';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger svr_guard before update on public.student_verification_requests
  for each row execute function private.guard_request_update();

create function private.vaudit(p_action text, p_type text, p_target uuid, p_metadata jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.verification_audit_log (actor_id, action, target_type, target_id, metadata)
  values ((select auth.uid()), p_action, p_type, p_target, coalesce(p_metadata, '{}'));
$$;

-- Moves a request, locking the row first so two decisions cannot interleave. Returns the new row.
create function private.transition_request(p_id uuid, p_to text, p_event text default null)
returns public.student_verification_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.student_verification_requests;
  old_status text;
begin
  select * into r from public.student_verification_requests where id = p_id for update;
  if not found then
    raise exception 'Verification request not found.' using errcode = 'no_data_found';
  end if;
  old_status := r.status;
  if not private.can_transition(old_status, p_to) then
    raise exception 'That change is not allowed from the current status.' using errcode = 'check_violation';
  end if;
  update public.student_verification_requests set status = p_to where id = p_id returning * into r;
  insert into public.verification_review_events (request_id, actor_id, from_status, to_status, event)
    values (p_id, (select auth.uid()), old_status, p_to, coalesce(p_event, lower(p_to)));
  return r;
end;
$$;

create function private.notify_verification(p_user uuid, p_request uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications (recipient_id, actor_id, type, entity_type, entity_id)
  values (p_user, null, 'verification_update', 'verification', p_request);
$$;

-- ---------------------------------------------------------------------------
-- Member functions
-- ---------------------------------------------------------------------------
create function public.start_student_verification(
  p_institution uuid, p_program uuid, p_claim text, p_method text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  inst public.academic_institutions;
  new_id uuid;
begin
  if me is null or not private.is_member() then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  if p_claim not in ('CURRENT_STUDENT', 'CURRENT_PROGRAM_STUDENT') then
    raise exception 'Unknown credential type.' using errcode = 'check_violation';
  end if;
  -- Federated login and school-email-only are not requestable methods.
  if p_method not in ('ISSUER_BACKED_DOCUMENT_SHARE', 'OFFICIAL_ATTESTATION_REVIEW', 'REGISTRAR_CONFIRMATION') then
    raise exception 'That verification method is not available.' using errcode = 'check_violation';
  end if;
  select * into inst from public.academic_institutions where id = p_institution and active;
  if not found then
    raise exception 'Unknown institution.' using errcode = 'no_data_found';
  end if;
  if p_claim = 'CURRENT_PROGRAM_STUDENT' then
    if not exists (
      select 1 from public.academic_programs g
      where g.id = p_program and g.institution_id = p_institution and g.active and g.source_reviewed_at is not null
    ) then
      raise exception 'Choose a program from the institution''s list.' using errcode = 'check_violation';
    end if;
  elsif p_program is not null then
    raise exception 'A program can only be requested with a program credential.' using errcode = 'check_violation';
  end if;
  if (select count(*) from public.student_verification_requests
        where user_id = me and created_at > now() - interval '24 hours') >= 5 then
    raise exception 'You have started several requests today. Please try again tomorrow.' using errcode = 'check_violation';
  end if;
  insert into public.student_verification_requests (user_id, institution_id, requested_program_id, requested_claim_type, method)
    values (me, p_institution, p_program, p_claim, p_method)
    returning id into new_id;
  insert into public.verification_review_events (request_id, actor_id, from_status, to_status, event)
    values (new_id, me, null, 'DRAFT', 'created');
  return new_id;
exception when unique_violation then
  raise exception 'You already have an open request for this.' using errcode = 'check_violation';
end;
$$;

create function private.owned_request(p_request uuid)
returns public.student_verification_requests
language plpgsql
security definer
set search_path = ''
as $$
declare r public.student_verification_requests;
begin
  select * into r from public.student_verification_requests
    where id = p_request and user_id = (select auth.uid());
  if not found then
    raise exception 'Verification request not found.' using errcode = 'no_data_found';
  end if;
  return r;
end;
$$;

create function public.skip_email_step(p_request uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.owned_request(p_request);
  perform private.transition_request(p_request, 'AWAITING_EVIDENCE', 'email_step_skipped');
end;
$$;

create function public.create_email_challenge(p_request uuid, p_domain text, p_email_hash text, p_code_hash text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  r public.student_verification_requests;
  domains text[];
  cid uuid;
begin
  r := private.owned_request(p_request);
  if r.status not in ('DRAFT', 'AWAITING_EMAIL_VERIFICATION') then
    raise exception 'The email step is not open for this request.' using errcode = 'check_violation';
  end if;
  select email_domains into domains from public.academic_institutions where id = r.institution_id;
  if domains = '{}' or not (lower(p_domain) = any (domains)) then
    raise exception 'That email address does not belong to a confirmed school domain.' using errcode = 'check_violation';
  end if;
  if (select count(*) from public.institutional_email_challenges where user_id = me and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'Too many codes requested. Please try again later.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.institutional_email_challenges where user_id = me and created_at > now() - interval '60 seconds') then
    raise exception 'Please wait a minute before asking for another code.' using errcode = 'check_violation';
  end if;
  update public.institutional_email_challenges set invalidated_at = now()
    where request_id = p_request and consumed_at is null and invalidated_at is null;
  insert into public.institutional_email_challenges (user_id, request_id, institution_id, email_domain, email_hash, code_hash, expires_at)
    values (me, p_request, r.institution_id, lower(p_domain), p_email_hash, p_code_hash, now() + interval '15 minutes')
    returning id into cid;
  if r.status = 'DRAFT' then
    perform private.transition_request(p_request, 'AWAITING_EMAIL_VERIFICATION', 'email_code_sent');
  end if;
  return cid;
end;
$$;

-- Wrong guesses must be counted even though the answer is "no", so this returns a word instead of
-- raising (a raised error would roll the attempt count back).
create function public.verify_email_challenge(p_request uuid, p_code_hash text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.student_verification_requests;
  c public.institutional_email_challenges;
begin
  r := private.owned_request(p_request);
  select * into c from public.institutional_email_challenges
    where request_id = p_request and consumed_at is null and invalidated_at is null
    order by created_at desc limit 1
    for update;
  if not found then return 'invalid'; end if;
  if c.expires_at <= now() then return 'expired'; end if;
  if c.attempts >= 5 then return 'locked'; end if;
  update public.institutional_email_challenges set attempts = attempts + 1 where id = c.id;
  if c.code_hash <> p_code_hash then return 'wrong'; end if;
  begin
    update public.institutional_email_challenges set consumed_at = now() where id = c.id;
  exception when unique_violation then
    return 'in_use';
  end;
  update public.student_verification_requests set email_verified_at = now(), email_domain = c.email_domain
    where id = p_request;
  if r.status = 'AWAITING_EMAIL_VERIFICATION' then
    perform private.transition_request(p_request, 'AWAITING_EVIDENCE', 'email_verified');
  end if;
  return 'ok';
end;
$$;

create function public.add_verification_evidence(
  p_request uuid, p_type text, p_path text, p_mime text, p_size integer, p_sha256 text, p_reference text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  r public.student_verification_requests;
  eid uuid;
  days integer;
begin
  r := private.owned_request(p_request);
  if r.status not in ('AWAITING_EVIDENCE', 'MORE_INFORMATION_REQUIRED') then
    raise exception 'Evidence can only be added while we are waiting for it.' using errcode = 'check_violation';
  end if;
  if p_path is not null and p_path not like me::text || '/' || p_request::text || '/%' then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  if (select count(*) from public.student_verification_evidence where request_id = p_request and deleted_at is null) >= 5 then
    raise exception 'You can attach up to 5 items to a request.' using errcode = 'check_violation';
  end if;
  select evidence_retention_days into days from public.verification_policy;
  insert into public.student_verification_evidence
    (request_id, private_storage_path, evidence_type, source_reference, mime_type, size_bytes, sha256, retention_delete_at)
    values (p_request, p_path, p_type, nullif(btrim(p_reference), ''), p_mime, p_size, p_sha256, now() + make_interval(days => days))
    returning id into eid;
  insert into public.verification_review_events (request_id, actor_id, event) values (p_request, me, 'evidence_added');
  return eid;
end;
$$;

create function public.submit_student_verification(p_request uuid, p_consent_version text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare r public.student_verification_requests;
begin
  r := private.owned_request(p_request);
  if r.status not in ('AWAITING_EVIDENCE', 'MORE_INFORMATION_REQUIRED') then
    raise exception 'This request cannot be submitted right now.' using errcode = 'check_violation';
  end if;
  if p_consent_version is distinct from (select consent_version from public.verification_policy) then
    raise exception 'Please read and accept the current consent statement.' using errcode = 'check_violation';
  end if;
  -- A registrar confirmation needs only the member's authorisation; everything else needs evidence.
  if r.method <> 'REGISTRAR_CONFIRMATION'
     and not exists (select 1 from public.student_verification_evidence where request_id = p_request and deleted_at is null) then
    raise exception 'Add your official evidence before submitting.' using errcode = 'check_violation';
  end if;
  perform private.transition_request(p_request, 'SUBMITTED', 'submitted');
  update public.student_verification_requests
    set consent_version = p_consent_version, consent_timestamp = now(), submitted_at = now(), student_message = null
    where id = p_request;
end;
$$;

create function public.withdraw_student_verification(p_request uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.owned_request(p_request);
  perform private.transition_request(p_request, 'WITHDRAWN', 'withdrawn');
  update public.student_verification_requests set decision_reason_code = 'withdrawn' where id = p_request;
end;
$$;

-- Everything a page may show about who is verified. Computed at the time of the call: an expired
-- or revoked credential never appears, so there is nothing to invalidate.
create function public.verified_badges(p_users uuid[])
returns table (
  user_id uuid,
  claim_type text,
  institution_id uuid,
  institution_name text,
  institution_name_en text,
  institution_name_fr text,
  program_name text,
  category text,
  category_label_en text,
  category_label_fr text,
  verification_method text,
  verified_at timestamptz,
  expires_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.user_id, c.claim_type, i.id, i.name, i.name_en, i.name_fr, g.official_name,
         g.category, k.label_en, k.label_fr, c.verification_method, c.verified_at, c.expires_at
  from public.student_verified_credentials c
  join public.academic_institutions i on i.id = c.institution_id
  left join public.academic_programs g on g.id = c.academic_program_id
  left join public.program_categories k on k.key = g.category
  where private.is_member()
    and c.user_id = any (p_users)
    and c.revoked_at is null
    and c.expired_at is null
    and c.expires_at > now()
  order by c.user_id, (c.claim_type = 'CURRENT_PROGRAM_STUDENT') desc, c.verified_at desc;
$$;

-- ---------------------------------------------------------------------------
-- Reviewer functions (administrators only, always audited)
-- ---------------------------------------------------------------------------
create function private.require_reviewer()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  return (select auth.uid());
end;
$$;

create function public.claim_student_verification(p_request uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare me uuid := private.require_reviewer(); r public.student_verification_requests;
begin
  select * into r from public.student_verification_requests where id = p_request;
  if r.user_id = me then
    raise exception 'You cannot review your own request.' using errcode = 'insufficient_privilege';
  end if;
  perform private.transition_request(p_request, 'UNDER_REVIEW', 'review_started');
  update public.student_verification_requests set assigned_to = me where id = p_request;
  insert into public.verification_review_details (request_id) values (p_request) on conflict do nothing;
  perform private.vaudit('verification.claim', 'request', p_request, '{}');
end;
$$;

create function private.assigned_request(p_request uuid)
returns public.student_verification_requests
language plpgsql
security definer
set search_path = ''
as $$
declare r public.student_verification_requests;
begin
  select * into r from public.student_verification_requests where id = p_request for update;
  if not found or r.status <> 'UNDER_REVIEW' or r.assigned_to is distinct from (select auth.uid()) then
    raise exception 'This request is not under your review.' using errcode = 'check_violation';
  end if;
  return r;
end;
$$;

create function public.record_verification_checks(
  p_request uuid,
  p_issuer_verified boolean,
  p_issuer_name text,
  p_identity_linkage text,
  p_enrolment_confirmed boolean,
  p_program_confirmed boolean,
  p_term_start date,
  p_term_end date,
  p_registrar_result text,
  p_binding_hash text,
  p_notes text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_reviewer();
  perform private.assigned_request(p_request);
  insert into public.verification_review_details as d
    (request_id, issuer_verified, issuer_name, identity_linkage, enrolment_confirmed, program_confirmed,
     term_start, term_end, registrar_result, binding_hash, reviewer_notes)
  values (p_request, p_issuer_verified, nullif(btrim(p_issuer_name), ''), p_identity_linkage, p_enrolment_confirmed,
          p_program_confirmed, p_term_start, p_term_end, p_registrar_result, nullif(btrim(p_binding_hash), ''), nullif(btrim(p_notes), ''))
  on conflict (request_id) do update set
    issuer_verified = excluded.issuer_verified, issuer_name = excluded.issuer_name,
    identity_linkage = excluded.identity_linkage, enrolment_confirmed = excluded.enrolment_confirmed,
    program_confirmed = excluded.program_confirmed, term_start = excluded.term_start, term_end = excluded.term_end,
    registrar_result = excluded.registrar_result, binding_hash = excluded.binding_hash,
    reviewer_notes = excluded.reviewer_notes, updated_at = now();
  perform private.vaudit('verification.checks', 'request', p_request, jsonb_build_object(
    'issuer_verified', p_issuer_verified, 'identity_linkage', p_identity_linkage,
    'enrolment_confirmed', p_enrolment_confirmed, 'program_confirmed', p_program_confirmed));
end;
$$;

create function public.set_evidence_scan(p_evidence uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare e public.student_verification_evidence;
begin
  perform private.require_reviewer();
  if p_status not in ('static_ok', 'quarantined') then
    raise exception 'Unknown scan result.' using errcode = 'check_violation';
  end if;
  update public.student_verification_evidence set scan_status = p_status where id = p_evidence returning * into e;
  if not found then raise exception 'Evidence not found.' using errcode = 'no_data_found'; end if;
  perform private.vaudit('verification.scan', 'evidence', p_evidence, jsonb_build_object('scan_status', p_status));
end;
$$;

create function public.review_evidence(p_evidence uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare e public.student_verification_evidence;
begin
  perform private.require_reviewer();
  if p_status not in ('validated', 'rejected') then
    raise exception 'Unknown result.' using errcode = 'check_violation';
  end if;
  select * into e from public.student_verification_evidence where id = p_evidence;
  if not found then raise exception 'Evidence not found.' using errcode = 'no_data_found'; end if;
  perform private.assigned_request(e.request_id);
  -- A file can only be validated after the byte inspection passed.
  if p_status = 'validated' and e.private_storage_path is not null and e.scan_status not in ('static_ok', 'av_clean') then
    raise exception 'Inspect the file before validating it.' using errcode = 'check_violation';
  end if;
  update public.student_verification_evidence set validation_status = p_status where id = p_evidence;
  perform private.vaudit('verification.evidence_review', 'evidence', p_evidence, jsonb_build_object('validation_status', p_status));
end;
$$;

create function public.request_more_information(p_request uuid, p_message text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare msg text := nullif(btrim(p_message), '');
begin
  perform private.require_reviewer();
  if msg is null or char_length(msg) > 500 then
    raise exception 'Write a short note for the member (up to 500 characters).' using errcode = 'check_violation';
  end if;
  perform private.assigned_request(p_request);
  perform private.transition_request(p_request, 'MORE_INFORMATION_REQUIRED', 'more_information_requested');
  update public.student_verification_requests set student_message = msg, reviewed_by = (select auth.uid()) where id = p_request;
  perform private.notify_verification((select user_id from public.student_verification_requests where id = p_request), p_request);
  perform private.vaudit('verification.more_information', 'request', p_request, '{}');
end;
$$;

create function public.reject_verification(p_request uuid, p_reason text, p_message text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare r public.student_verification_requests;
begin
  perform private.require_reviewer();
  if p_reason not in ('not_current', 'program_not_confirmed', 'identity_mismatch', 'unverifiable_document', 'duplicate_identity', 'wrong_institution', 'other') then
    raise exception 'Choose a reason.' using errcode = 'check_violation';
  end if;
  if char_length(coalesce(p_message, '')) > 500 then
    raise exception 'Write a short note for the member (up to 500 characters).' using errcode = 'check_violation';
  end if;
  r := private.assigned_request(p_request);
  perform private.transition_request(p_request, 'REJECTED', 'rejected');
  update public.student_verification_requests
    set decision_reason_code = p_reason, reviewed_at = now(), reviewed_by = (select auth.uid()),
        student_message = nullif(btrim(p_message), '')
    where id = p_request;
  perform private.notify_verification(r.user_id, p_request);
  perform private.vaudit('verification.reject', 'request', p_request, jsonb_build_object('reason', p_reason));
end;
$$;

create function public.approve_verification(p_request uuid, p_claim text, p_expires_at timestamptz default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := private.require_reviewer();
  r public.student_verification_requests;
  d public.verification_review_details;
  pol public.verification_policy;
  inst public.academic_institutions;
  expiry timestamptz;
  cap timestamptz;
  cid uuid;
begin
  r := private.assigned_request(p_request);
  if r.user_id = me then
    raise exception 'You cannot approve your own request.' using errcode = 'insufficient_privilege';
  end if;
  if p_claim not in ('CURRENT_STUDENT', 'CURRENT_PROGRAM_STUDENT') then
    raise exception 'Unknown credential type.' using errcode = 'check_violation';
  end if;
  -- Only what was asked for can be granted, and a program claim needs program evidence.
  if p_claim = 'CURRENT_PROGRAM_STUDENT' and r.requested_claim_type <> 'CURRENT_PROGRAM_STUDENT' then
    raise exception 'The member did not request a program credential.' using errcode = 'check_violation';
  end if;
  if r.method = 'INSTITUTIONAL_EMAIL' or r.method = 'FEDERATED_INSTITUTION_LOGIN' then
    raise exception 'This method cannot establish enrolment on its own.' using errcode = 'check_violation';
  end if;

  select * into d from public.verification_review_details where request_id = p_request;
  if not found
     or not d.issuer_verified
     or d.identity_linkage <> 'matched'
     or not d.enrolment_confirmed
     or d.binding_hash is null then
    raise exception 'Complete the checklist first: issuer, identity match, current enrolment and identity reference.' using errcode = 'check_violation';
  end if;
  if not (
    exists (select 1 from public.student_verification_evidence where request_id = p_request and validation_status = 'validated' and deleted_at is null)
    or d.registrar_result = 'confirmed'
  ) then
    raise exception 'Validate at least one piece of evidence or record a confirmed registrar response.' using errcode = 'check_violation';
  end if;
  if p_claim = 'CURRENT_PROGRAM_STUDENT' and not d.program_confirmed then
    raise exception 'Program evidence has not been confirmed, so only a student credential can be granted.' using errcode = 'check_violation';
  end if;
  if d.term_end is not null and d.term_end < current_date then
    raise exception 'The confirmed academic term has already ended.' using errcode = 'check_violation';
  end if;

  select * into pol from public.verification_policy;
  select * into inst from public.academic_institutions where id = r.institution_id;
  cap := now() + make_interval(days => pol.max_lifespan_days);
  if d.term_end is not null then
    expiry := least(cap, (d.term_end + 1)::timestamptz);
  else
    -- No term end was confirmed, so no date is invented: use Medyra's conservative window.
    expiry := now() + make_interval(days => pol.unknown_term_days);
  end if;
  if p_expires_at is not null then
    if p_expires_at <= now() then
      raise exception 'The expiry must be in the future.' using errcode = 'check_violation';
    end if;
    expiry := least(expiry, p_expires_at);
  end if;

  -- One real student, one account. The lock closes the race between two reviewers.
  perform pg_advisory_xact_lock(hashtextextended(r.institution_id::text || ':' || d.binding_hash, 0));
  if exists (
    select 1 from public.student_verified_credentials c
    where c.institution_id = r.institution_id and c.binding_hash = d.binding_hash and c.user_id <> r.user_id
      and c.revoked_at is null and c.expired_at is null and c.expires_at > now()
  ) then
    raise exception 'This identity is already verified on another account.' using errcode = 'check_violation';
  end if;

  -- A renewal replaces the earlier credential of the same scope.
  update public.student_verified_credentials set expired_at = now(), updated_at = now()
    where user_id = r.user_id and institution_id = r.institution_id and claim_type = p_claim
      and coalesce(academic_program_id, '00000000-0000-0000-0000-000000000000') =
          coalesce(case when p_claim = 'CURRENT_PROGRAM_STUDENT' then r.requested_program_id end, '00000000-0000-0000-0000-000000000000')
      and revoked_at is null and expired_at is null;

  insert into public.student_verified_credentials
    (user_id, institution_id, academic_program_id, claim_type, issuer, verification_method, verified_by,
     academic_term_start, academic_term_end, expires_at, source_reference_id, binding_hash)
  values (r.user_id, r.institution_id, case when p_claim = 'CURRENT_PROGRAM_STUDENT' then r.requested_program_id end,
          p_claim, coalesce(d.issuer_name, inst.name), r.method, me, d.term_start, d.term_end, expiry, p_request, d.binding_hash)
  returning id into cid;

  perform private.transition_request(p_request, 'APPROVED', 'approved');
  update public.student_verification_requests
    set reviewed_at = now(), reviewed_by = me, expires_at = expiry, decision_reason_code = 'approved',
        student_message = null
    where id = p_request;
  perform private.notify_verification(r.user_id, p_request);
  perform private.vaudit('verification.approve', 'request', p_request, jsonb_build_object('claim', p_claim, 'credential', cid));
  return cid;
end;
$$;

create function public.revoke_student_credential(p_credential uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare c public.student_verified_credentials;
begin
  perform private.require_reviewer();
  if p_reason not in ('revoked_fraud', 'revoked_error', 'revoked_member_request', 'identity_mismatch', 'other') then
    raise exception 'Choose a reason.' using errcode = 'check_violation';
  end if;
  update public.student_verified_credentials
    set revoked_at = now(), revocation_reason_code = p_reason, updated_at = now()
    where id = p_credential and revoked_at is null
    returning * into c;
  if not found then
    raise exception 'That credential is not active.' using errcode = 'no_data_found';
  end if;
  if c.source_reference_id is not null
     and exists (select 1 from public.student_verification_requests where id = c.source_reference_id and status = 'APPROVED') then
    perform private.transition_request(c.source_reference_id, 'REVOKED', 'revoked');
    update public.student_verification_requests set decision_reason_code = p_reason where id = c.source_reference_id;
  end if;
  perform private.notify_verification(c.user_id, coalesce(c.source_reference_id, c.id));
  perform private.vaudit('verification.revoke', 'credential', p_credential, jsonb_build_object('reason', p_reason));
end;
$$;

create function public.set_credential_expiry(p_credential uuid, p_expires_at timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare max_days integer;
begin
  perform private.require_reviewer();
  select max_lifespan_days into max_days from public.verification_policy;
  if p_expires_at <= now() or p_expires_at > now() + make_interval(days => max_days) then
    raise exception 'The expiry must be in the future and within the maximum lifespan.' using errcode = 'check_violation';
  end if;
  update public.student_verified_credentials set expires_at = p_expires_at, reminded_at = null, updated_at = now()
    where id = p_credential and revoked_at is null and expired_at is null;
  if not found then
    raise exception 'That credential is not active.' using errcode = 'no_data_found';
  end if;
  perform private.vaudit('verification.set_expiry', 'credential', p_credential, '{}');
end;
$$;

-- Expiry and reminders. A badge never depends on this running (verified_badges checks expires_at
-- itself); this keeps the records, the request status and the in-app notices tidy.
create function private.expire_credentials_job()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer := 0;
  c record;
  remind integer;
begin
  select reminder_days into remind from public.verification_policy;
  for c in
    select id, user_id, source_reference_id from public.student_verified_credentials
    where revoked_at is null and expired_at is null and expires_at <= now()
    for update
  loop
    update public.student_verified_credentials set expired_at = now(), updated_at = now() where id = c.id;
    if c.source_reference_id is not null
       and exists (select 1 from public.student_verification_requests where id = c.source_reference_id and status = 'APPROVED') then
      perform private.transition_request(c.source_reference_id, 'EXPIRED', 'expired');
    end if;
    perform private.notify_verification(c.user_id, coalesce(c.source_reference_id, c.id));
    n := n + 1;
  end loop;
  for c in
    select id, user_id, source_reference_id from public.student_verified_credentials
    where revoked_at is null and expired_at is null and reminded_at is null
      and expires_at <= now() + make_interval(days => remind)
    for update
  loop
    update public.student_verified_credentials set reminded_at = now() where id = c.id;
    perform private.notify_verification(c.user_id, coalesce(c.source_reference_id, c.id));
  end loop;
  return n;
end;
$$;

create function public.expire_student_credentials()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare n integer;
begin
  perform private.require_reviewer();
  n := private.expire_credentials_job();
  perform private.vaudit('verification.expiry_run', 'credential', null, jsonb_build_object('expired', n));
  return n;
end;
$$;

-- Evidence retention: rows whose time is up are listed for the app to delete from Storage, then
-- marked deleted. (Deleting storage.objects rows in SQL would leave the files behind.)
create function public.due_evidence_deletions()
returns table (id uuid, private_storage_path text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_reviewer();
  return query
    select e.id, e.private_storage_path from public.student_verification_evidence e
    where e.deleted_at is null and e.retention_delete_at <= now();
end;
$$;

create function public.mark_evidence_deleted(p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare n integer;
begin
  perform private.require_reviewer();
  update public.student_verification_evidence set deleted_at = now(), private_storage_path = null,
         source_reference = null
    where id = any (p_ids) and deleted_at is null and retention_delete_at <= now();
  get diagnostics n = row_count;
  perform private.vaudit('verification.evidence_purge', 'evidence', null, jsonb_build_object('count', n));
  return n;
end;
$$;

-- The notice recipient: an administrator may read the email of the member whose request they are
-- deciding, only to send the short notice that points back to the dashboard.
create function public.verification_notice_recipient(p_request uuid)
returns table (user_id uuid, email text, first_name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_reviewer();
  return query
    select r.user_id, u.email::text, p.first_name
    from public.student_verification_requests r
    join auth.users u on u.id = r.user_id
    join public.profiles p on p.id = r.user_id
    where r.id = p_request;
end;
$$;

-- pg_cron (Supabase) runs the job hourly when the extension exists; otherwise an administrator
-- runs it from the review page.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('student-verification-expiry', '17 * * * *', 'select private.expire_credentials_job()');
  end if;
exception when others then
  raise notice 'pg_cron not scheduled: %', sqlerrm;
end;
$$;

-- ---------------------------------------------------------------------------
-- Seed: institutions (unconfirmed domains, no invented partnerships)
-- ---------------------------------------------------------------------------
insert into public.program_categories (key, label_en, label_fr) values
  ('medicine', 'Medicine', 'Médecine'),
  ('nursing', 'Nursing', 'Sciences infirmières'),
  ('pharmacy', 'Pharmacy', 'Pharmacie'),
  ('psychology', 'Psychology', 'Psychologie'),
  ('social_work', 'Social Work', 'Travail social'),
  ('physiotherapy', 'Physiotherapy', 'Physiothérapie'),
  ('occupational_therapy', 'Occupational Therapy', 'Ergothérapie'),
  ('speech_language_pathology', 'Speech-Language Pathology', 'Orthophonie'),
  ('audiology', 'Audiology', 'Audiologie'),
  ('dentistry', 'Dentistry', 'Médecine dentaire'),
  ('nutrition', 'Nutrition', 'Nutrition'),
  ('respiratory_therapy', 'Respiratory Therapy', 'Inhalothérapie'),
  ('medical_laboratory_technology', 'Medical Laboratory Technology', 'Technologie de laboratoire médical'),
  ('medical_imaging_technology', 'Medical Imaging Technology', 'Technologie d''imagerie médicale'),
  ('public_health', 'Public Health', 'Santé publique'),
  ('other_health_social', 'Other Health and Social Services Programs', 'Autres programmes en santé et services sociaux');

insert into public.academic_institutions (slug, name, name_en, name_fr, website, kind, city) values
  ('udem', 'Université de Montréal', 'University of Montreal', 'Université de Montréal', 'https://www.umontreal.ca', 'university', 'Montréal'),
  ('mcgill', 'McGill University', 'McGill University', 'Université McGill', 'https://www.mcgill.ca', 'university', 'Montréal'),
  ('uqam', 'UQAM', 'University of Quebec at Montreal (UQAM)', 'Université du Québec à Montréal (UQAM)', 'https://uqam.ca', 'university', 'Montréal'),
  ('concordia', 'Concordia University', 'Concordia University', 'Université Concordia', 'https://www.concordia.ca', 'university', 'Montréal'),
  ('sherbrooke', 'Université de Sherbrooke', 'University of Sherbrooke', 'Université de Sherbrooke', 'https://www.usherbrooke.ca', 'university', 'Sherbrooke'),
  ('laval', 'Université Laval', 'Laval University', 'Université Laval', 'https://www.ulaval.ca', 'university', 'Québec'),
  ('uqtr', 'UQTR', 'University of Quebec at Trois-Rivières (UQTR)', 'Université du Québec à Trois-Rivières (UQTR)', 'https://www.uqtr.ca', 'university', 'Trois-Rivières'),
  ('uqo', 'UQO', 'University of Quebec in Outaouais (UQO)', 'Université du Québec en Outaouais (UQO)', 'https://uqo.ca', 'university', 'Gatineau'),
  ('inrs', 'INRS', 'National Institute of Scientific Research (INRS)', 'Institut national de la recherche scientifique (INRS)', 'https://inrs.ca', 'university', 'Québec'),
  ('polymtl', 'Polytechnique Montréal', 'Polytechnique Montreal', 'Polytechnique Montréal', 'https://www.polymtl.ca', 'university', 'Montréal'),
  ('ets', 'ÉTS', 'École de technologie supérieure (ÉTS)', 'École de technologie supérieure (ÉTS)', 'https://www.etsmtl.ca', 'university', 'Montréal'),
  ('hec', 'HEC Montréal', 'HEC Montréal', 'HEC Montréal', 'https://www.hec.ca', 'university', 'Montréal'),
  ('dawson', 'Dawson College', 'Dawson College', 'Collège Dawson', 'https://www.dawsoncollege.qc.ca', 'cegep', 'Montréal'),
  ('vanier', 'Vanier College', 'Vanier College', 'Collège Vanier', 'https://www.vaniercollege.qc.ca', 'cegep', 'Montréal'),
  ('john-abbott', 'John Abbott College', 'John Abbott College', 'Collège John Abbott', 'https://www.johnabbott.qc.ca', 'cegep', 'Sainte-Anne-de-Bellevue'),
  ('ahuntsic', 'Collège Ahuntsic', 'Ahuntsic College', 'Collège Ahuntsic', 'https://www.collegeahuntsic.qc.ca', 'cegep', 'Montréal'),
  ('edouard-montpetit', 'Cégep Édouard-Montpetit', 'Édouard-Montpetit College', 'Cégep Édouard-Montpetit', 'https://www.cegepmontpetit.ca', 'cegep', 'Longueuil'),
  ('maisonneuve', 'Collège de Maisonneuve', 'Maisonneuve College', 'Collège de Maisonneuve', 'https://www.cmaisonneuve.qc.ca', 'cegep', 'Montréal'),
  ('montmorency', 'Collège Montmorency', 'Montmorency College', 'Collège Montmorency', 'https://www.cmontmorency.qc.ca', 'cegep', 'Laval'),
  ('rosemont', 'Collège de Rosemont', 'Rosemont College', 'Collège de Rosemont', 'https://www.crosemont.qc.ca', 'cegep', 'Montréal'),
  ('bois-de-boulogne', 'Collège de Bois-de-Boulogne', 'Bois-de-Boulogne College', 'Collège de Bois-de-Boulogne', 'https://www.bdeb.qc.ca', 'cegep', 'Montréal'),
  ('saint-laurent', 'Cégep de Saint-Laurent', 'Saint-Laurent College', 'Cégep de Saint-Laurent', 'https://www.cegepsl.qc.ca', 'cegep', 'Montréal'),
  ('vieux-montreal', 'Cégep du Vieux Montréal', 'Vieux Montréal College', 'Cégep du Vieux Montréal', 'https://www.cvm.qc.ca', 'cegep', 'Montréal');

-- Institution-specific sources (as published by each institution; reviewed by a person before use).
update public.academic_institutions set
  documents_url = 'https://registraire.umontreal.ca/documents-officiels/commander-un-document/mescertif/',
  registrar_url = 'https://registraire.umontreal.ca/documents-officiels/confirmation-de-diplomes-et-verification-de-documents/',
  integration_status = 'requires_permission',
  instructions_en = 'Order an official current-enrolment attestation from the Registrar and share it with Medyra through MesCertif where possible. A Medyra reviewer validates the issuer-backed share and the document. If needed, the Registrar''s official third-party verification procedure is used. Medyra does not assume public MesCertif API access.',
  instructions_fr = 'Commandez une attestation officielle d''inscription au Registrariat et partagez-la avec Medyra par MesCertif lorsque c''est possible. Un évaluateur de Medyra valide le partage émis par l''établissement et le document. Au besoin, la procédure officielle de vérification par un tiers du Registrariat est utilisée. Medyra ne suppose aucun accès public à une API MesCertif.'
  where slug = 'udem';
update public.academic_institutions set
  documents_url = 'https://www.mcgill.ca/student-records/proof-reg',
  registrar_url = 'https://www.mcgill.ca/student-records/mycreds',
  integration_status = 'requires_permission',
  instructions_en = 'Get official proof of enrolment from Minerva. Sharing through McGill MyCreds (an optional paid process documented by McGill) is preferred. A plain downloaded PDF does not prove an unaltered credential, so a reviewer checks issuer authentication, the term and the document contents. Program claims need official program evidence.',
  instructions_fr = 'Obtenez une preuve officielle d''inscription dans Minerva. Le partage par McGill MyCreds (procédure facultative et payante décrite par McGill) est à privilégier. Un simple PDF téléchargé ne prouve pas l''intégrité d''un document; un évaluateur vérifie l''authentification de l''émetteur, la session et le contenu. Une preuve officielle du programme est requise pour une mention de programme.'
  where slug = 'mcgill';
update public.academic_institutions set
  documents_url = 'https://registrariat.info.uqam.ca/releves-de-notes-attestations/',
  registrar_url = 'https://services.uqam.ca/services-offerts/demande-de-verification-de-scolarite-et-diplomes/',
  instructions_en = 'Prefer a current attestation issued by the Registrariat. UQAM also accepts third-party verification requests through its official service (name, date of birth, type of verification and signed student authorization; fees may apply). Medyra does not collect or keep your date of birth in this version: if a formal registrar check is needed, you make the request through UQAM''s service and share the response.',
  instructions_fr = 'Privilégiez une attestation récente émise par le Registrariat. L''UQAM accepte aussi les demandes de vérification par un tiers via son service officiel (nom, date de naissance, type de vérification et autorisation signée; des frais peuvent s''appliquer). Medyra ne recueille ni ne conserve votre date de naissance dans cette version : si une vérification formelle est nécessaire, vous faites la demande au service de l''UQAM et partagez la réponse.'
  where slug = 'uqam';
update public.academic_institutions set
  documents_url = 'https://www.concordia.ca/students/your-sis/attestation-letter-laptop.html',
  instructions_en = 'Download the official attestation letter from the Student Centre. It must show the correct academic term and, if relevant, full-time or part-time status. Program confirmation may need additional evidence. A document is never marked Verified until a reviewer has validated it.',
  instructions_fr = 'Téléchargez la lettre d''attestation officielle depuis le Centre étudiant. Elle doit indiquer la bonne session et, au besoin, le statut à temps plein ou partiel. La confirmation du programme peut exiger une preuve supplémentaire. Un document n''est jamais marqué Vérifié avant d''être validé par un évaluateur.'
  where slug = 'concordia';
update public.academic_institutions set
  documents_url = 'https://www.usherbrooke.ca/communaute-etudiante/services-administratifs/demande-de-documents-officiels',
  instructions_en = 'Request an attestation of registration (attestation d''inscription) from the official documents service. It must show the current academic term and come with the issuer''s official documentation. Additional program evidence may be required.',
  instructions_fr = 'Demandez une attestation d''inscription au service des documents officiels. Elle doit indiquer la session en cours et être accompagnée de la documentation officielle de l''émetteur. Une preuve supplémentaire du programme peut être exigée.'
  where slug = 'sherbrooke';
update public.academic_institutions set
  registrar_url = 'https://monportail.ulaval.ca/validation',
  instructions_en = 'Obtain an official attestation from Université Laval and share it with Medyra. A Medyra reviewer enters the validation number and student details in Laval''s official validation service by hand, compares the result with your document, and checks the current term and program. Medyra does not automate that web form.',
  instructions_fr = 'Obtenez une attestation officielle de l''Université Laval et partagez-la avec Medyra. Un évaluateur de Medyra saisit manuellement le numéro de validation et les renseignements requis dans le service officiel de validation de Laval, compare le résultat à votre document et vérifie la session et le programme. Medyra n''automatise pas ce formulaire.'
  where slug = 'laval';
update public.academic_institutions set
  documents_url = 'https://www.dawsoncollege.qc.ca/academic-advising/faq/frequently-asked-questions-currentreturning-students/',
  instructions_en = 'Request proof of registration through My Dawson Portal / Omnivox. A screenshot of a portal is not accepted on its own: the document must be official and cover the relevant term.',
  instructions_fr = 'Demandez une preuve d''inscription par le portail Mon Dawson / Omnivox. Une capture d''écran du portail n''est pas acceptée seule : le document doit être officiel et couvrir la session visée.'
  where slug = 'dawson';
update public.academic_institutions set
  documents_url = 'https://www.vaniercollege.qc.ca/request-forms',
  instructions_en = 'The Registrar issues attendance letters and enrolment confirmations; request one through the official request forms. A screenshot of a portal is not accepted on its own.',
  instructions_fr = 'Le Registrariat émet des lettres de fréquentation et des confirmations d''inscription; faites-en la demande par les formulaires officiels. Une capture d''écran d''un portail n''est pas acceptée seule.'
  where slug = 'vanier';

insert into public.institution_verification_methods (institution_id, method, status, source_url, note)
select id, 'ISSUER_BACKED_DOCUMENT_SHARE', 'requires_permission', documents_url, 'Share through the institution''s credential platform; automated receipt needs an agreement we do not have.'
  from public.academic_institutions where slug in ('udem', 'mcgill');
insert into public.institution_verification_methods (institution_id, method, status, source_url, note)
select id, 'REGISTRAR_CONFIRMATION', 'documented', registrar_url, 'Institution''s official third-party verification procedure; fees may apply.'
  from public.academic_institutions where slug in ('udem', 'uqam');
insert into public.institution_verification_methods (institution_id, method, status, source_url, note)
select id, 'REGISTRAR_CONFIRMATION', 'documented', registrar_url, 'Manual, reviewer-assisted check in Laval''s official validation service. Not automated.'
  from public.academic_institutions where slug = 'laval';
insert into public.institution_verification_methods (institution_id, method, status, source_url)
select id, 'OFFICIAL_ATTESTATION_REVIEW', 'documented', documents_url
  from public.academic_institutions where slug in ('udem', 'mcgill', 'uqam', 'concordia', 'sherbrooke', 'dawson', 'vanier');
insert into public.institution_verification_methods (institution_id, method, status, source_url)
select id, 'OFFICIAL_ATTESTATION_REVIEW', 'unverified', null
  from public.academic_institutions
  where id not in (select institution_id from public.institution_verification_methods where method = 'OFFICIAL_ATTESTATION_REVIEW');
insert into public.institution_verification_methods (institution_id, method, status, note)
select id, 'INSTITUTIONAL_EMAIL', 'unverified', 'Email domains are unconfirmed; the step stays off until an administrator confirms them from an official source.'
  from public.academic_institutions;
insert into public.institution_verification_methods (institution_id, method, status, note)
select id, 'FEDERATED_INSTITUTION_LOGIN', 'requires_permission', 'Future only: needs CANARIE federation registration, agreements and attribute validation.'
  from public.academic_institutions;

-- ---------------------------------------------------------------------------
-- Row level security and grants
-- ---------------------------------------------------------------------------
alter table public.verification_policy enable row level security;
alter table public.academic_institutions enable row level security;
alter table public.institution_verification_methods enable row level security;
alter table public.program_categories enable row level security;
alter table public.academic_programs enable row level security;
alter table public.student_verification_requests enable row level security;
alter table public.student_verification_evidence enable row level security;
alter table public.verification_review_details enable row level security;
alter table public.student_verified_credentials enable row level security;
alter table public.verification_review_events enable row level security;
alter table public.verification_audit_log enable row level security;
alter table public.institutional_email_challenges enable row level security;

revoke all on public.verification_policy, public.academic_institutions, public.institution_verification_methods,
  public.program_categories, public.academic_programs, public.student_verification_requests,
  public.student_verification_evidence, public.verification_review_details, public.student_verified_credentials,
  public.verification_review_events, public.verification_audit_log, public.institutional_email_challenges
  from anon, authenticated;

grant select on public.verification_policy, public.academic_institutions, public.institution_verification_methods,
  public.program_categories, public.academic_programs, public.student_verification_requests,
  public.student_verification_evidence, public.verification_review_details,
  public.verification_review_events, public.verification_audit_log to authenticated;
-- Credentials: every column except the private binding hash.
grant select (id, user_id, institution_id, academic_program_id, claim_type, issuer, verification_method,
  verified_by, verified_at, academic_term_start, academic_term_end, expires_at, revoked_at,
  revocation_reason_code, expired_at, source_reference_id, created_at, updated_at)
  on public.student_verified_credentials to authenticated;
-- Registry edits by administrators (still no client write path for anything else).
grant insert, update on public.academic_institutions, public.institution_verification_methods,
  public.academic_programs, public.program_categories to authenticated;
grant update on public.verification_policy to authenticated;

create policy "policy: members read" on public.verification_policy for select to authenticated
  using ((select private.is_member()));
create policy "policy: staff update" on public.verification_policy for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

create policy "institutions: members read" on public.academic_institutions for select to authenticated
  using ((select private.is_member()));
create policy "institutions: staff insert" on public.academic_institutions for insert to authenticated
  with check ((select private.is_admin()));
create policy "institutions: staff update" on public.academic_institutions for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

create policy "methods: members read" on public.institution_verification_methods for select to authenticated
  using ((select private.is_member()));
create policy "methods: staff insert" on public.institution_verification_methods for insert to authenticated
  with check ((select private.is_admin()));
create policy "methods: staff update" on public.institution_verification_methods for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

create policy "categories: members read" on public.program_categories for select to authenticated
  using ((select private.is_member()));
create policy "categories: staff insert" on public.program_categories for insert to authenticated
  with check ((select private.is_admin()));
create policy "categories: staff update" on public.program_categories for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

create policy "programs: members read reviewed ones" on public.academic_programs for select to authenticated
  using ((select private.is_member()) and (source_reviewed_at is not null or (select private.is_admin())));
create policy "programs: staff insert" on public.academic_programs for insert to authenticated
  with check ((select private.is_admin()));
create policy "programs: staff update" on public.academic_programs for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

create policy "requests: owner or staff read" on public.student_verification_requests for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_admin()));

create policy "evidence: owner or staff read" on public.student_verification_evidence for select to authenticated
  using (
    (select private.is_admin())
    or exists (select 1 from public.student_verification_requests r where r.id = request_id and r.user_id = (select auth.uid()))
  );

create policy "review details: staff only" on public.verification_review_details for select to authenticated
  using ((select private.is_admin()));

create policy "credentials: owner or staff read" on public.student_verified_credentials for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_admin()));

create policy "events: owner or staff read" on public.verification_review_events for select to authenticated
  using (
    (select private.is_admin())
    or exists (select 1 from public.student_verification_requests r where r.id = request_id and r.user_id = (select auth.uid()))
  );

create policy "audit: staff read" on public.verification_audit_log for select to authenticated
  using ((select private.is_admin()));

-- institutional_email_challenges: no policy and no grant. Only the definer functions touch it.

-- Only the functions created in this migration are touched below; earlier grants stay as they were.
revoke execute on function
  public.start_student_verification(uuid, uuid, text, text), public.skip_email_step(uuid),
  public.create_email_challenge(uuid, text, text, text), public.verify_email_challenge(uuid, text),
  public.add_verification_evidence(uuid, text, text, text, integer, text, text),
  public.submit_student_verification(uuid, text), public.withdraw_student_verification(uuid),
  public.verified_badges(uuid[]), public.claim_student_verification(uuid),
  public.record_verification_checks(uuid, boolean, text, text, boolean, boolean, date, date, text, text, text),
  public.set_evidence_scan(uuid, text), public.review_evidence(uuid, text),
  public.request_more_information(uuid, text), public.reject_verification(uuid, text, text),
  public.approve_verification(uuid, text, timestamptz), public.revoke_student_credential(uuid, text),
  public.set_credential_expiry(uuid, timestamptz), public.expire_student_credentials(),
  public.due_evidence_deletions(), public.mark_evidence_deleted(uuid[]),
  public.verification_notice_recipient(uuid)
  from public, anon;
grant execute on function
  public.start_student_verification(uuid, uuid, text, text), public.skip_email_step(uuid),
  public.create_email_challenge(uuid, text, text, text), public.verify_email_challenge(uuid, text),
  public.add_verification_evidence(uuid, text, text, text, integer, text, text),
  public.submit_student_verification(uuid, text), public.withdraw_student_verification(uuid),
  public.verified_badges(uuid[]), public.claim_student_verification(uuid),
  public.record_verification_checks(uuid, boolean, text, text, boolean, boolean, date, date, text, text, text),
  public.set_evidence_scan(uuid, text), public.review_evidence(uuid, text),
  public.request_more_information(uuid, text), public.reject_verification(uuid, text, text),
  public.approve_verification(uuid, text, timestamptz), public.revoke_student_credential(uuid, text),
  public.set_credential_expiry(uuid, timestamptz), public.expire_student_credentials(),
  public.due_evidence_deletions(), public.mark_evidence_deleted(uuid[]),
  public.verification_notice_recipient(uuid)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Private storage for evidence: <member id>/<request id>/<random>.<ext>
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('student-verification-evidence', 'student-verification-evidence', false, 5242880,
        array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do update set public = false, file_size_limit = 5242880,
  allowed_mime_types = array['application/pdf', 'image/jpeg', 'image/png'];

create policy "evidence files: owner uploads while evidence is open"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'student-verification-evidence'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (
      select 1 from public.student_verification_requests r
      where r.id::text = (storage.foldername(name))[2] and r.user_id = (select auth.uid())
        and r.status in ('AWAITING_EVIDENCE', 'MORE_INFORMATION_REQUIRED')
    )
  );

create policy "evidence files: owner or assigned reviewer read"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'student-verification-evidence'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or ((select private.is_admin()) and exists (
        select 1 from public.student_verification_requests r
        where r.id::text = (storage.foldername(name))[2] and r.assigned_to = (select auth.uid())
      ))
    )
  );

create policy "evidence files: owner deletes while evidence is open"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'student-verification-evidence'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (
      select 1 from public.student_verification_requests r
      where r.id::text = (storage.foldername(name))[2] and r.user_id = (select auth.uid())
        and r.status in ('AWAITING_EVIDENCE', 'MORE_INFORMATION_REQUIRED')
    )
  );

-- The private schema stays closed except for the policy helpers.
revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.is_member() to authenticated;
grant execute on function private.is_admin() to authenticated;
grant execute on function private.has_block_between(uuid, uuid) to authenticated;
grant execute on function private.can_see_profile_details(uuid) to authenticated;
grant execute on function private.community_role(uuid) to authenticated;
grant execute on function private.is_community_staff(uuid) to authenticated;
grant execute on function private.is_banned_from_community(uuid) to authenticated;
grant execute on function private.can_read_community(uuid) to authenticated;
grant execute on function private.can_post_in_community(uuid) to authenticated;
grant execute on function private.post_visible(uuid) to authenticated;
grant execute on function private.is_content_author(text, uuid) to authenticated;
grant execute on function private.content_author_blocked(text, uuid) to authenticated;
grant execute on function private.forum_content_visible(text, uuid) to authenticated;
grant execute on function private.conv_status(uuid) to authenticated;
grant execute on function private.can_read_conversation(uuid) to authenticated;
grant execute on function private.can_send_in_conversation(uuid) to authenticated;
grant execute on function private.can_list_as_mentor() to authenticated;
grant execute on function private.is_mentorship_party(uuid) to authenticated;
