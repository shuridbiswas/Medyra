-- audit_logs.actor_id is ON DELETE SET NULL, but the append-only trigger rejected that update, so an
-- account that had ever acted in an audited decision (administrators, moderators) could not be
-- deleted. Give audit_logs the same exemption the community and verification logs already have:
-- an update is allowed only when it clears actor_id and changes nothing else. Everything else stays
-- append-only; the retention purge keeps its own delete path.
create or replace function private.deny_audit_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.actor_id is null and old.actor_id is not null
     and (to_jsonb(new) - 'actor_id') = (to_jsonb(old) - 'actor_id') then
    return new;
  end if;
  if tg_op = 'DELETE' and current_setting('medyra.retention_purge', true) = 'on' then
    return old;
  end if;
  raise exception 'audit_logs is append-only' using errcode = 'insufficient_privilege';
end;
$$;
