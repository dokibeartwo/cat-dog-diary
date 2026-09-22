-- Cover one foreground or background round; WorkManager cannot renew every
-- 60 seconds. Paused rounds use short renewable leases instead.
create or replace function public.acquire_focus_lease(p_device_id text, p_session_id text, p_lease_seconds integer default 90)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); other record; expires timestamptz := now() + make_interval(secs => greatest(15, least(coalesce(p_lease_seconds, 90), 14400)));
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
