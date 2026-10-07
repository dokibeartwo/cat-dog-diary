-- Read-only deployment checks. Returns booleans, never task/account contents.
-- Run in the new project's SQL Editor after initialization.
with expected_tables(name) as (
  values ('profiles'),('sync_entities'),('sync_mutations'),
         ('sync_conflicts'),('habit_events'),('device_sessions')
), tables as (
  select name, to_regclass('public.'||name) as oid from expected_tables
), expected_rpc(signature) as (
  values
    ('public.push_mutations(jsonb)'),
    ('public.pull_changes(timestamp with time zone,text,integer)'),
    ('public.resolve_conflict(uuid,jsonb)'),
    ('public.ack_sync_cursor(text,timestamp with time zone,text)'),
    ('public.record_habit_event(text,text,text,timestamp with time zone,text)'),
    ('public.acquire_focus_lease(text,text,integer)'),
    ('public.release_focus_lease(text,text)'),
    ('public.delete_account()')
), rpc as (
  select signature,to_regprocedure(signature) as oid from expected_rpc
)
select 'table:'||t.name as check_name,
  coalesce(c.relrowsecurity,false)
  and coalesce(has_table_privilege('authenticated',t.oid,'SELECT'),false)
  and not coalesce(has_table_privilege('anon',t.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),true)
  and not coalesce(has_table_privilege('authenticated',t.oid,
    case when t.name='profiles' then 'DELETE,TRUNCATE,REFERENCES,TRIGGER'
      else 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER' end),true)
  as passed
from tables t left join pg_class c on c.oid=t.oid
union all
select 'rpc:'||signature,
  coalesce(has_function_privilege('authenticated',oid,'EXECUTE'),false)
  and not coalesce(has_function_privilege('anon',oid,'EXECUTE'),true)
from rpc
order by check_name;
