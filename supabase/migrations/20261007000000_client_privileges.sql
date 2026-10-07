-- Explicitly narrow pre-existing/default grants on this application's tables.
-- RLS does not apply to TRUNCATE; revoking only INSERT/UPDATE/DELETE is not enough
-- on a project whose default privileges granted ALL to client roles.
-- This migration changes privileges only; it does not delete or rewrite data.
revoke all privileges on table
  public.profiles, public.sync_entities, public.sync_mutations,
  public.sync_conflicts, public.habit_events, public.device_sessions
  from public, anon, authenticated;

grant select on table
  public.profiles, public.sync_entities, public.sync_mutations,
  public.sync_conflicts, public.habit_events, public.device_sessions
  to authenticated;
grant insert, update on table public.profiles to authenticated;

-- Mutations, deletion and lease writes continue to use the existing owner-
-- scoped SECURITY DEFINER RPCs. No service-role grant is changed here.
