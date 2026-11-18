-- External student-verification providers (SheerID, InAcademia, MyCreds, CAF, ID.me, simulator).
--
-- Additive only. Trust model: the app has no service key and acts as the member, so a member could
-- call any RPC the app can with forged data. Therefore a provider result is recorded ONLY by an
-- administrator session (record_provider_result), after the admin's server action re-fetched it
-- from the provider. Members can start an attempt and move it through harmless progress states.
-- This migration never issues a credential: approval stays with approve_verification.

create table public.verification_provider_configs (
  provider text primary key,
  enabled boolean not null default false,
  environment text not null default 'development',
  countries text[] not null default '{CA}',
  claims text[] not null default '{CURRENT_STUDENT}',
  contract_state text not null default 'none',
  reviewed_at timestamptz,
  note text,
  updated_at timestamptz not null default now(),
  constraint vpc_provider_valid check (provider in ('inacademia', 'sheerid', 'mycreds', 'caf_saml', 'idme', 'simulated')),
  constraint vpc_env_valid check (environment in ('development', 'staging', 'production')),
  constraint vpc_contract_valid check (contract_state in ('none', 'awaiting_contract', 'awaiting_credentials', 'sandbox', 'live')),
  constraint vpc_claims_valid check (claims <@ array['CURRENT_STUDENT', 'CURRENT_PROGRAM_STUDENT']),
  -- Nothing can be switched on without an approval state, and the simulator never outside development.
  constraint vpc_enabled_needs_contract check (not enabled or contract_state in ('sandbox', 'live')),
  constraint vpc_simulated_dev_only check (provider <> 'simulated' or environment = 'development')
);

insert into public.verification_provider_configs (provider, contract_state)
values ('inacademia', 'none'), ('sheerid', 'none'), ('mycreds', 'none'), ('caf_saml', 'none'), ('idme', 'none'), ('simulated', 'sandbox');

create table public.verification_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  institution_id uuid not null references public.academic_institutions (id),
  provider text not null references public.verification_provider_configs (provider),
  claim_type text not null,
  state text not null default 'created',
  provider_attempt_id text,
  environment text not null,
  subject_hash text,
  linkage text,
  issuer_validated boolean,
  valid_until timestamptz,
  evidence_digest text,
  expires_at timestamptz not null default now() + interval '2 days',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint va_claim_valid check (claim_type in ('CURRENT_STUDENT', 'CURRENT_PROGRAM_STUDENT')),
  constraint va_state_valid check (state in ('created', 'redirected', 'provider_pending', 'proof_received',
    'requires_review', 'approved', 'rejected', 'expired', 'revoked', 'provider_error', 'cancelled')),
  constraint va_linkage_valid check (linkage is null or linkage in ('strong', 'partial', 'unresolved'))
);
create index va_user_idx on public.verification_attempts (user_id, state);
create unique index va_provider_attempt_uidx on public.verification_attempts (provider, provider_attempt_id)
  where provider_attempt_id is not null;
-- One real student (provider subject) cannot back two accounts.
create unique index va_subject_uidx on public.verification_attempts (provider, subject_hash)
  where subject_hash is not null and state in ('proof_received', 'requires_review', 'approved');
-- One live attempt per member, provider and claim.
create unique index va_open_uidx on public.verification_attempts (user_id, provider, claim_type)
  where state in ('created', 'redirected', 'provider_pending', 'proof_received', 'requires_review');

create table public.verification_provider_events (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.verification_attempts (id) on delete cascade,
  event_hash text not null,
  outcome text not null,
  to_state text not null,
  actor_id uuid references auth.users (id) on delete set null,
  recorded_at timestamptz not null default now(),
  constraint vpe_unique unique (attempt_id, event_hash)
);

-- Members move an attempt only through states that grant nothing.
create function public.start_provider_attempt(
  p_institution uuid, p_provider text, p_claim text, p_provider_attempt_id text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  cfg public.verification_provider_configs;
  new_id uuid;
begin
  if me is null or not private.is_member() then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  select * into cfg from public.verification_provider_configs where provider = p_provider;
  if not found or not cfg.enabled or not (p_claim = any (cfg.claims)) then
    raise exception 'That verification provider is not available.' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.academic_institutions where id = p_institution and active) then
    raise exception 'Unknown institution.' using errcode = 'no_data_found';
  end if;
  if (select count(*) from public.verification_attempts where user_id = me and created_at > now() - interval '24 hours') >= 5 then
    raise exception 'You have started several attempts today. Please try again tomorrow.' using errcode = 'check_violation';
  end if;
  insert into public.verification_attempts (user_id, institution_id, provider, claim_type, provider_attempt_id, environment)
    values (me, p_institution, p_provider, p_claim, p_provider_attempt_id, cfg.environment)
    returning id into new_id;
  return new_id;
exception when unique_violation then
  raise exception 'You already have an open attempt for this.' using errcode = 'check_violation';
end;
$$;

create function public.set_attempt_progress(p_attempt uuid, p_state text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  a public.verification_attempts;
begin
  if me is null then raise exception 'Not allowed' using errcode = 'insufficient_privilege'; end if;
  select * into a from public.verification_attempts where id = p_attempt and user_id = me for update;
  if not found then raise exception 'Not found' using errcode = 'no_data_found'; end if;
  if not ((a.state = 'created' and p_state in ('redirected', 'cancelled'))
       or (a.state = 'redirected' and p_state in ('provider_pending', 'cancelled'))
       or (a.state = 'provider_pending' and p_state = 'cancelled')) then
    raise exception 'That change is not allowed.' using errcode = 'check_violation';
  end if;
  update public.verification_attempts set state = p_state, updated_at = now() where id = p_attempt;
end;
$$;

-- Administrator only. The caller has already re-fetched the result from the provider server-side.
create function public.record_provider_result(
  p_attempt uuid, p_event_hash text, p_outcome text, p_state text, p_linkage text,
  p_issuer_validated boolean, p_valid_until timestamptz, p_subject_hash text, p_digest text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  a public.verification_attempts;
begin
  if me is null or not private.is_admin() then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  if p_state not in ('proof_received', 'requires_review', 'rejected', 'provider_error') then
    raise exception 'That result state is not allowed.' using errcode = 'check_violation';
  end if;
  select * into a from public.verification_attempts where id = p_attempt for update;
  if not found then raise exception 'Not found' using errcode = 'no_data_found'; end if;
  -- A repeated event is a no-op, so provider retries and double clicks cannot change a decision.
  if exists (select 1 from public.verification_provider_events where attempt_id = p_attempt and event_hash = p_event_hash) then
    return a.state;
  end if;
  if a.state not in ('redirected', 'provider_pending', 'proof_received', 'requires_review') or a.expires_at < now() then
    raise exception 'This attempt can no longer take a result.' using errcode = 'check_violation';
  end if;
  update public.verification_attempts
     set state = p_state, linkage = p_linkage, issuer_validated = p_issuer_validated, valid_until = p_valid_until,
         subject_hash = p_subject_hash, evidence_digest = p_digest, updated_at = now()
   where id = p_attempt;
  insert into public.verification_provider_events (attempt_id, event_hash, outcome, to_state, actor_id)
    values (p_attempt, p_event_hash, p_outcome, p_state, me);
  return p_state;
exception when unique_violation then
  raise exception 'This provider identity is already linked to another account.' using errcode = 'check_violation';
end;
$$;

alter table public.verification_provider_configs enable row level security;
alter table public.verification_attempts enable row level security;
alter table public.verification_provider_events enable row level security;
revoke all on public.verification_provider_configs, public.verification_attempts, public.verification_provider_events
  from anon, authenticated;
grant select on public.verification_provider_configs to authenticated;
grant update (enabled, environment, countries, claims, contract_state, reviewed_at, note, updated_at)
  on public.verification_provider_configs to authenticated;
-- Members never read the private columns (subject hash, digest).
grant select (id, user_id, institution_id, provider, claim_type, state, environment, linkage, issuer_validated,
  valid_until, expires_at, created_at, updated_at) on public.verification_attempts to authenticated;
grant select on public.verification_provider_events to authenticated;

create policy "provider configs: members read" on public.verification_provider_configs for select to authenticated
  using ((select private.is_member()));
create policy "provider configs: staff update" on public.verification_provider_configs for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "attempts: owner or staff read" on public.verification_attempts for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_admin()));
create policy "provider events: staff read" on public.verification_provider_events for select to authenticated
  using ((select private.is_admin()));
