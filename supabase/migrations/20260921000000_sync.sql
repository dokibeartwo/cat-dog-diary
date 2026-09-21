-- 猫狗日记 cloud sync schema (Supabase/PostgreSQL)
--
-- This migration is deliberately self-contained.  It stores only JSON payloads
-- produced by the clients; no service-role key or project URL belongs here.
-- Apply it with `supabase db push` after linking a private Supabase project.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  timezone text not null default 'Asia/Shanghai',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles(user_id, display_name)
    values (new.id, coalesce(new.raw_user_meta_data ->> 'name', new.email));
  return new;
end;
$$;

drop trigger if exists auth_user_profile on auth.users;
create trigger auth_user_profile after insert on auth.users
for each row execute function public.handle_new_user();

create table if not exists public.sync_entities (
  user_id uuid not null references auth.users(id) on delete cascade,
  entity_type text not null check (entity_type in (
    'task', 'step', 'habit', 'habit_event', 'category', 'stage', 'stage_plan',
    'reminder', 'reminder_rule', 'focus', 'focusSession', 'focus_session',
    'habitCompletion', 'preference'
  )),
  entity_id text not null check (length(entity_id) between 1 and 200),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  revision bigint not null default 1 check (revision > 0),
  device_id text not null check (length(device_id) between 1 and 200),
  last_mutation_id text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, entity_type, entity_id)
);

create table if not exists public.sync_mutations (
  user_id uuid not null references auth.users(id) on delete cascade,
  mutation_id text not null check (length(mutation_id) between 1 and 200),
  entity_type text not null check (entity_type in (
    'task', 'step', 'habit', 'habit_event', 'category', 'stage', 'stage_plan',
    'reminder', 'reminder_rule', 'focus', 'focusSession', 'focus_session',
    'habitCompletion', 'preference'
  )),
  entity_id text not null check (length(entity_id) between 1 and 200),
  operation text not null check (operation in ('upsert', 'restore', 'delete')),
  patch jsonb not null default '{}'::jsonb check (jsonb_typeof(patch) = 'object'),
  base_payload jsonb not null default '{}'::jsonb check (jsonb_typeof(base_payload) = 'object'),
  base_revision bigint not null default 0 check (base_revision >= 0),
  device_id text not null check (length(device_id) between 1 and 200),
  status text not null default 'received' check (status in ('received', 'applied', 'conflict', 'rejected', 'duplicate')),
  resulting_revision bigint,
  mutation_hash text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, mutation_id)
);

create table if not exists public.sync_conflicts (
  conflict_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  entity_type text not null,
  entity_id text not null,
  mutation_id text not null,
  local_patch jsonb not null default '{}'::jsonb,
  remote_payload jsonb not null default '{}'::jsonb,
  conflict_fields text[] not null default '{}',
  base_revision bigint not null default 0,
  remote_revision bigint not null,
  status text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  resolution jsonb,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete set null,
  unique (user_id, mutation_id)
);

create table if not exists public.habit_events (
  user_id uuid not null references auth.users(id) on delete cascade,
  event_id text not null check (length(event_id) between 1 and 200),
  habit_id text not null check (length(habit_id) between 1 and 200),
  occurrence_key text not null check (length(occurrence_key) between 1 and 200),
  completed_at timestamptz not null default now(),
  device_id text not null check (length(device_id) between 1 and 200),
  created_at timestamptz not null default now(),
  primary key (user_id, event_id),
  unique (user_id, habit_id, occurrence_key)
);

create table if not exists public.device_sessions (
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id text not null check (length(device_id) between 1 and 200),
  platform text not null check (platform in ('windows', 'android', 'web', 'other')),
  device_name text,
  app_version text,
  last_seen_at timestamptz not null default now(),
  sync_cursor timestamptz,
  sync_cursor_entity text,
  focus_session_id text,
  focus_lease_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, device_id)
);

create index if not exists sync_entities_user_updated_idx
  on public.sync_entities (user_id, updated_at, entity_type, entity_id);
create index if not exists sync_entities_live_idx
  on public.sync_entities (user_id, entity_type, entity_id) where deleted_at is null;
create index if not exists sync_mutations_user_created_idx
  on public.sync_mutations (user_id, created_at);
create index if not exists sync_conflicts_open_idx
  on public.sync_conflicts (user_id, created_at) where status = 'open';
create index if not exists habit_events_habit_idx
  on public.habit_events (user_id, habit_id, completed_at desc);
create index if not exists device_sessions_seen_idx
  on public.device_sessions (user_id, last_seen_at desc);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at before update on public.profiles
for each row execute function public.touch_updated_at();
drop trigger if exists device_sessions_touch_updated_at on public.device_sessions;
create trigger device_sessions_touch_updated_at before update on public.device_sessions
for each row execute function public.touch_updated_at();

-- All client-facing tables are private to the signed-in owner.
alter table public.profiles enable row level security;
alter table public.sync_entities enable row level security;
alter table public.sync_mutations enable row level security;
alter table public.sync_conflicts enable row level security;
alter table public.habit_events enable row level security;
alter table public.device_sessions enable row level security;

drop policy if exists profiles_owner_select on public.profiles;
create policy profiles_owner_select on public.profiles for select to authenticated
using (user_id = auth.uid());
drop policy if exists profiles_owner_insert on public.profiles;
create policy profiles_owner_insert on public.profiles for insert to authenticated
with check (user_id = auth.uid());
drop policy if exists profiles_owner_update on public.profiles;
create policy profiles_owner_update on public.profiles for update to authenticated
using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists sync_entities_owner_select on public.sync_entities;
create policy sync_entities_owner_select on public.sync_entities for select to authenticated
using (user_id = auth.uid());
drop policy if exists sync_mutations_owner_select on public.sync_mutations;
create policy sync_mutations_owner_select on public.sync_mutations for select to authenticated
using (user_id = auth.uid());
drop policy if exists sync_conflicts_owner_select on public.sync_conflicts;
create policy sync_conflicts_owner_select on public.sync_conflicts for select to authenticated
using (user_id = auth.uid());
drop policy if exists habit_events_owner_select on public.habit_events;
create policy habit_events_owner_select on public.habit_events for select to authenticated
using (user_id = auth.uid());
drop policy if exists device_sessions_owner_select on public.device_sessions;
create policy device_sessions_owner_select on public.device_sessions for select to authenticated
using (user_id = auth.uid());

-- Mutations must pass through the RPC so revision checks cannot be bypassed.
revoke insert, update, delete on public.sync_entities, public.sync_mutations,
  public.sync_conflicts, public.habit_events, public.device_sessions from anon, authenticated;
revoke all on public.profiles from anon;
revoke delete on public.profiles from authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select on public.sync_entities, public.sync_mutations, public.sync_conflicts,
  public.habit_events, public.device_sessions to authenticated;

create or replace function public.push_mutations(p_mutations jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  item jsonb;
  mid text;
  etype text;
  eid text;
  op text;
  patch jsonb;
  base_payload jsonb;
  base_rev bigint;
  device text;
  current_revision bigint;
  next_revision bigint;
  current_payload jsonb;
  current_deleted timestamptz;
  conflict_fields text[];
  result jsonb := '[]'::jsonb;
  existing_status text;
  existing_hash text;
  incoming_hash text;
begin
  if uid is null then raise exception using errcode = '42501', message = 'authentication required'; end if;
  -- Serialize a user's mutation batches so duplicate retries and revision checks
  -- cannot race each other between the existence read and the insert.
  perform pg_advisory_xact_lock(hashtextextended(uid::text, 0));
  if p_mutations is null or jsonb_typeof(p_mutations) <> 'array' then
    raise exception using errcode = '22023', message = 'p_mutations must be a JSON array';
  end if;
  if jsonb_array_length(p_mutations) > 500 then
    raise exception using errcode = '22023', message = 'at most 500 mutations per request';
  end if;

  for item in select value from jsonb_array_elements(p_mutations) loop
    mid := item->>'mutationId'; etype := item->>'entityType'; eid := item->>'entityId';
    op := item->>'operation'; patch := coalesce(item->'patch', '{}'::jsonb);
    base_payload := coalesce(item->'basePayload', '{}'::jsonb);
    base_rev := coalesce((item->>'baseRevision')::bigint, 0); device := item->>'deviceId';
    incoming_hash := encode(digest(item::text, 'sha256'), 'hex');
    if mid is null or etype is null or eid is null or op is null or device is null then
      raise exception using errcode = '22023', message = 'mutationId, entityType, entityId, operation and deviceId are required';
    end if;
    if etype not in ('task','step','habit','habit_event','category','stage','stage_plan','reminder','reminder_rule','focus','focusSession','focus_session','habitCompletion','preference') then
      raise exception using errcode = '22023', message = 'unsupported entity type';
    end if;
    if op not in ('upsert','restore','delete') or jsonb_typeof(patch) <> 'object' or jsonb_typeof(base_payload) <> 'object' then
      raise exception using errcode = '22023', message = 'invalid operation or patch';
    end if;
    select status, mutation_hash into existing_status, existing_hash from public.sync_mutations where user_id = uid and mutation_id = mid;
    if found then
      if existing_hash is distinct from incoming_hash then
        result := result || jsonb_build_array(jsonb_build_object('mutationId', mid, 'status', 'rejected', 'reason', 'mutation-id-reuse'));
        continue;
      end if;
      result := result || jsonb_build_array(jsonb_build_object('mutationId', mid, 'status', 'duplicate'));
      continue;
    end if;

    select revision, payload, deleted_at into current_revision, current_payload, current_deleted
      from public.sync_entities where user_id = uid and entity_type = etype and entity_id = eid for update;
    if not found then current_revision := 0; current_payload := '{}'::jsonb; current_deleted := null; end if;
    insert into public.sync_mutations(user_id, mutation_id, entity_type, entity_id, operation, patch, base_payload, base_revision, device_id, mutation_hash)
      values (uid, mid, etype, eid, op, patch, base_payload, base_rev, device, incoming_hash);

    -- A stale mutation can still merge when it changed fields untouched by the
    -- remote revision.  The client includes its base payload for this check.
    conflict_fields := array(
      select field from jsonb_object_keys(patch) as fields(field)
      where (current_payload -> field) is distinct from (base_payload -> field)
        and (patch -> field) is distinct from (current_payload -> field)
    );
    if op = 'delete' and base_rev <> current_revision then
      conflict_fields := array['deletedAt'];
    end if;
    if current_deleted is not null and op = 'upsert' then
      conflict_fields := array['deletedAt'];
    end if;
    if current_deleted is not null and op = 'restore' and base_rev <> current_revision then
      conflict_fields := array['deletedAt'];
    end if;
    if cardinality(conflict_fields) > 0 then
      update public.sync_mutations set status = 'conflict' where user_id = uid and mutation_id = mid;
      insert into public.sync_conflicts(user_id, entity_type, entity_id, mutation_id, local_patch, remote_payload, conflict_fields, base_revision, remote_revision)
        values (uid, etype, eid, mid, patch, current_payload, conflict_fields, base_rev, current_revision);
      result := result || jsonb_build_array(jsonb_build_object('mutationId', mid, 'status', 'conflict', 'revision', current_revision, 'fields', conflict_fields));
      continue;
    end if;

    next_revision := current_revision + 1;
    if current_revision = 0 then
      insert into public.sync_entities(user_id, entity_type, entity_id, payload, revision, device_id, last_mutation_id, deleted_at)
        values (uid, etype, eid, case when op = 'delete' then '{}'::jsonb else patch end, next_revision, device, mid,
                case when op = 'delete' then now() else null end);
    else
      update public.sync_entities set payload = case when op = 'delete' then payload else payload || patch end,
        revision = next_revision, device_id = device, last_mutation_id = mid,
        deleted_at = case when op = 'delete' then now() else null end, updated_at = now()
        where user_id = uid and entity_type = etype and entity_id = eid;
    end if;
    update public.sync_mutations set status = 'applied', resulting_revision = next_revision
      where user_id = uid and mutation_id = mid;
    result := result || jsonb_build_array(jsonb_build_object('mutationId', mid, 'status', 'applied', 'revision', next_revision));
  end loop;
  return result;
end;
$$;

-- Resolve a field-level conflict as a new, auditable mutation. Clients never
-- edit sync_entities directly, so the selected resolution gets a fresh
-- revision and cannot resurrect an older tombstone by accident.
create or replace function public.resolve_conflict(p_conflict_id uuid, p_resolution jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid(); c record; entity_row public.sync_entities; next_revision bigint; mutation_id text;
begin
  if uid is null then raise exception using errcode = '42501', message = 'authentication required'; end if;
  if p_resolution is null or jsonb_typeof(p_resolution) <> 'object' then raise exception using errcode = '22023', message = 'resolution must be an object'; end if;
  -- Keep the same lock order as push_mutations.  This prevents a conflict
  -- resolution racing a normal push from waiting on each other indefinitely.
  perform pg_advisory_xact_lock(hashtextextended(uid::text, 0));
  select * into c from public.sync_conflicts where conflict_id = p_conflict_id and user_id = uid and status = 'open' for update;
  if not found then raise exception using errcode = 'P0002', message = 'conflict not found or already resolved'; end if;
  select * into entity_row from public.sync_entities where user_id = uid and entity_type = c.entity_type and entity_id = c.entity_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'entity not found'; end if;
  next_revision := entity_row.revision + 1; mutation_id := 'resolve:' || p_conflict_id::text || ':' || next_revision::text;
  update public.sync_entities set payload = entity_row.payload || p_resolution, revision = next_revision,
    updated_at = clock_timestamp(), device_id = 'conflict-resolution', last_mutation_id = mutation_id, deleted_at = null
    where user_id = uid and entity_type = c.entity_type and entity_id = c.entity_id;
  insert into public.sync_mutations(user_id, mutation_id, entity_type, entity_id, operation, patch, base_payload, base_revision, device_id, status, resulting_revision, mutation_hash)
    values (uid, mutation_id, c.entity_type, c.entity_id, 'restore', p_resolution, entity_row.payload, entity_row.revision, 'conflict-resolution', 'applied', next_revision, encode(digest(mutation_id || p_resolution::text, 'sha256'), 'hex'));
  update public.sync_conflicts set status = 'resolved', resolution = p_resolution, resolved_at = clock_timestamp(), resolved_by = uid where conflict_id = p_conflict_id;
  return jsonb_build_object('resolved', true, 'revision', next_revision, 'mutationId', mutation_id);
end;
$$;

create or replace function public.pull_changes(
  p_cursor timestamptz default null,
  p_cursor_entity text default '',
  p_limit integer default 500
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  rows jsonb;
  last_updated timestamptz;
  last_entity text;
  has_more boolean;
  safe_limit integer := greatest(1, least(coalesce(p_limit, 500), 500));
begin
  if uid is null then raise exception using errcode = '42501', message = 'authentication required'; end if;
  with page as (
    select entity_type, entity_id, payload, revision, device_id, last_mutation_id, updated_at, deleted_at,
           row_number() over (order by updated_at, entity_type, entity_id) as rn
    from public.sync_entities
    where user_id = uid
      and (p_cursor is null or updated_at > p_cursor or (updated_at = p_cursor and (entity_type || '|' || entity_id) > coalesce(p_cursor_entity, '')))
    order by updated_at, entity_type, entity_id
    limit safe_limit + 1
  ), trimmed as (select * from page where rn <= safe_limit)
  select coalesce(jsonb_agg(jsonb_build_object(
    'entityType', entity_type, 'entityId', entity_id, 'payload', payload, 'revision', revision,
    'deviceId', device_id, 'lastMutationId', last_mutation_id, 'updatedAt', updated_at, 'deletedAt', deleted_at
  ) order by updated_at, entity_type, entity_id), '[]'::jsonb),
  max(updated_at), (array_agg(entity_type || '|' || entity_id order by updated_at desc, entity_type desc, entity_id desc))[1]
  into rows, last_updated, last_entity from trimmed;
  select exists(select 1 from public.sync_entities where user_id = uid and (p_cursor is null or updated_at > p_cursor or (updated_at = p_cursor and (entity_type || '|' || entity_id) > coalesce(p_cursor_entity, ''))) and (updated_at, entity_type || '|' || entity_id) > (last_updated, coalesce(last_entity,''))) into has_more;
  return jsonb_build_object('items', rows, 'nextCursor', case when last_updated is null then null else jsonb_build_object('updatedAt', last_updated, 'entity', last_entity) end, 'hasMore', coalesce(has_more, false));
end;
$$;

create or replace function public.ack_sync_cursor(p_device_id text, p_cursor timestamptz, p_cursor_entity text default '')
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then raise exception using errcode = '42501', message = 'authentication required'; end if;
  if p_device_id is null or length(p_device_id) = 0 or p_cursor is null then raise exception using errcode = '22023', message = 'device and cursor are required'; end if;
  update public.device_sessions set sync_cursor = p_cursor, sync_cursor_entity = p_cursor_entity, last_seen_at = now()
    where user_id = auth.uid() and device_id = p_device_id;
  if not found then
    insert into public.device_sessions(user_id, device_id, platform, sync_cursor, sync_cursor_entity)
      values (auth.uid(), p_device_id, 'other', p_cursor, p_cursor_entity);
  end if;
end;
$$;

create or replace function public.record_habit_event(
  p_event_id text, p_habit_id text, p_occurrence_key text, p_completed_at timestamptz default now(), p_device_id text default 'unknown'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); result public.habit_events;
begin
  if uid is null then raise exception using errcode = '42501', message = 'authentication required'; end if;
  insert into public.habit_events(user_id, event_id, habit_id, occurrence_key, completed_at, device_id)
    values (uid, p_event_id, p_habit_id, p_occurrence_key, coalesce(p_completed_at, now()), p_device_id)
    on conflict do nothing
    returning * into result;
  if result.event_id is null then
    select * into result from public.habit_events where user_id = uid and (event_id = p_event_id or (habit_id = p_habit_id and occurrence_key = p_occurrence_key));
  end if;
  return to_jsonb(result);
end;
$$;

create or replace function public.acquire_focus_lease(p_device_id text, p_session_id text, p_lease_seconds integer default 90)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); other record; expires timestamptz := now() + make_interval(secs => greatest(15, least(coalesce(p_lease_seconds, 90), 900)));
begin
  if uid is null then raise exception using errcode = '42501', message = 'authentication required'; end if;
  if p_device_id is null or p_session_id is null then raise exception using errcode = '22023', message = 'device and session are required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(uid::text, 0));
  select device_id, focus_session_id, focus_lease_expires_at into other from public.device_sessions
    where user_id = uid and focus_session_id is not null and focus_lease_expires_at > now() and device_id <> p_device_id limit 1;
  if found then return jsonb_build_object('ok', false, 'reason', 'in_use', 'deviceId', other.device_id, 'sessionId', other.focus_session_id, 'expiresAt', other.focus_lease_expires_at); end if;
  insert into public.device_sessions(user_id, device_id, platform, focus_session_id, focus_lease_expires_at)
    values (uid, p_device_id, 'other', p_session_id, expires)
    on conflict (user_id, device_id) do update set focus_session_id = excluded.focus_session_id, focus_lease_expires_at = excluded.focus_lease_expires_at, last_seen_at = now();
  return jsonb_build_object('ok', true, 'deviceId', p_device_id, 'sessionId', p_session_id, 'expiresAt', expires);
end;
$$;

create or replace function public.release_focus_lease(p_device_id text, p_session_id text default null)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then raise exception using errcode = '42501', message = 'authentication required'; end if;
  update public.device_sessions set focus_session_id = null, focus_lease_expires_at = null, last_seen_at = now()
    where user_id = auth.uid() and device_id = p_device_id and (p_session_id is null or focus_session_id = p_session_id);
  return found;
end;
$$;

create or replace function public.delete_account()
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception using errcode = '42501', message = 'authentication required'; end if;
  -- All public records cascade from auth.users.  This also invalidates the account.
  delete from auth.users where id = uid;
  return jsonb_build_object('deleted', true, 'userId', uid);
end;
$$;

revoke all on function public.push_mutations(jsonb) from public;
revoke all on function public.pull_changes(timestamptz, text, integer) from public;
revoke all on function public.ack_sync_cursor(text, timestamptz, text) from public;
revoke all on function public.record_habit_event(text, text, text, timestamptz, text) from public;
revoke all on function public.acquire_focus_lease(text, text, integer) from public;
revoke all on function public.release_focus_lease(text, text) from public;
revoke all on function public.delete_account() from public;
grant execute on function public.push_mutations(jsonb) to authenticated;
grant execute on function public.pull_changes(timestamptz, text, integer) to authenticated;
grant execute on function public.resolve_conflict(uuid, jsonb) to authenticated;
grant execute on function public.ack_sync_cursor(text, timestamptz, text) to authenticated;
grant execute on function public.record_habit_event(text, text, text, timestamptz, text) to authenticated;
grant execute on function public.acquire_focus_lease(text, text, integer) to authenticated;
grant execute on function public.release_focus_lease(text, text) to authenticated;
grant execute on function public.delete_account() to authenticated;
