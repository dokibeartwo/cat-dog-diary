-- Upgrade existing previews without dropping user data.
alter table public.sync_conflicts add column if not exists local_operation text;
alter table public.sync_conflicts add column if not exists remote_deleted_at timestamptz;
update public.sync_conflicts c set local_operation=m.operation from public.sync_mutations m
  where c.user_id=m.user_id and c.mutation_id=m.mutation_id and c.local_operation is null;
-- One monotonic cursor order per account, including concurrent transactions.
create or replace function public.sync_entity_clock()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare previous timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text, 0));
  select max(updated_at) into previous from public.sync_entities where user_id = new.user_id;
  new.updated_at := greatest(clock_timestamp(), coalesce(previous + interval '1 microsecond', '-infinity'::timestamptz));
  return new;
end; $$;
drop trigger if exists sync_entities_clock on public.sync_entities;
create trigger sync_entities_clock before insert or update on public.sync_entities for each row execute function public.sync_entity_clock();

create or replace function public.push_mutations(p_mutations jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := auth.uid(); item jsonb; mid text; etype text; eid text; op text; patch jsonb; base_payload jsonb;
  base_rev bigint; device text; current_revision bigint; current_payload jsonb; current_deleted timestamptz;
  conflict_fields text[]; result jsonb := '[]'::jsonb; prior public.sync_mutations;
  incoming_hash text; cid uuid; allowed text[];
begin
  if uid is null then raise exception using errcode='42501', message='authentication required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(uid::text, 0));
  if p_mutations is null or jsonb_typeof(p_mutations) <> 'array' or jsonb_array_length(p_mutations) > 100 then
    raise exception using errcode='22023', message='expected at most 100 mutations';
  end if;
  for item in select value from jsonb_array_elements(p_mutations) loop
    mid:=item->>'mutationId'; etype:=item->>'entityType'; eid:=item->>'entityId'; op:=item->>'operation';
    patch:=coalesce(item->'patch','{}'); base_payload:=coalesce(item->'basePayload','{}'); device:=item->>'deviceId';
    if mid is null or length(mid) not between 1 and 200 or eid is null or eid !~ '^[A-Za-z0-9_:-]{1,128}$'
       or device is null or length(device) not between 1 and 200 or coalesce(item->>'baseRevision','0') !~ '^[0-9]{1,15}$'
       or op is null or op not in ('upsert','restore','delete') or jsonb_typeof(patch) <> 'object'
       or jsonb_typeof(base_payload) <> 'object' or octet_length(item::text) > 262144 then
      raise exception using errcode='22023', message='invalid mutation';
    end if;
    base_rev:=coalesce((item->>'baseRevision')::bigint,0);
    allowed:=case etype
      when 'task' then array['title','notes','dueAt','deadlineDate','deadlineReminderDays','priority','scheduleMode','reminderMode','reminderMinutes','reminderActive','planDate','priorityDate','category','estimateMinutes','recurrence','recurrenceNextId','reminderPresentation','urgentReminder','seriesId','completed','completedAt','createdAt','inStage']
      when 'step' then array['taskId','title','completed','completedAt','position']
      when 'habit' then array['title','icon','scheduleType','intervalMinutes','time','active','days','windowEnabled','windowStart','windowEnd','reminderPresentation','urgentReminder','createdAt']
      when 'habit_event' then array['habitId','occurredAt','completed','source']
      when 'category' then array['name','color','icon','position']
      when 'stage_plan' then array['start','end','dailyCapacity','dailyMinutes','workdaysOnly','lastPlannedAt']
      when 'reminder_rule' then array['targetType','targetId','mode','minutes','time','active','presentation','urgent']
      when 'focus_session' then array['taskId','taskTitle','startedAt','endedAt','outcome','durationSeconds','segments']
      when 'preference' then array['themeId'] else null end;
    if allowed is null or exists(select 1 from jsonb_object_keys(patch) as k(field) where not field=any(allowed)) then
      raise exception using errcode='22023', message='unsupported entity type or field';
    end if;
    -- Built-in SHA-256 works regardless of Supabase's extension schema.
    incoming_hash:=encode(pg_catalog.sha256(convert_to(item::text,'UTF8')),'hex');
    select * into prior from public.sync_mutations where user_id=uid and mutation_id=mid;
    if found then
      if prior.mutation_hash <> incoming_hash then raise exception using errcode='22023', message='mutation-id-reuse'; end if;
      select conflict_id into cid from public.sync_conflicts where user_id=uid and mutation_id=mid and status='open';
      result:=result || jsonb_build_array(jsonb_build_object('mutationId',mid,'status',case when cid is not null then 'conflict' else 'duplicate' end,
        'revision',prior.resulting_revision,'conflictId',cid,'entityType',etype,'entityId',eid));
      continue;
    end if;
    select revision,payload,deleted_at into current_revision,current_payload,current_deleted from public.sync_entities
      where user_id=uid and entity_type=etype and entity_id=eid for update;
    if not found then current_revision:=0; current_payload:='{}'; current_deleted:=null; end if;
    if base_rev > current_revision then raise exception using errcode='22023', message='future base revision'; end if;
    insert into public.sync_mutations(user_id,mutation_id,entity_type,entity_id,operation,patch,base_payload,base_revision,device_id,mutation_hash)
      values(uid,mid,etype,eid,op,patch,base_payload,base_rev,device,incoming_hash);
    -- Compare JSONB structurally; a field removed remotely is still a change.
    conflict_fields:=array(select field from jsonb_object_keys(patch) as k(field)
      where current_revision<>base_rev and (current_payload->field) is distinct from (base_payload->field)
        and (patch->field) is distinct from (current_payload->field));
    if current_deleted is not null and op='upsert' then conflict_fields:=array['deletedAt']; end if;
    if op='delete' and current_deleted is null and base_rev<>current_revision then conflict_fields:=array['deletedAt']; end if;
    if op='restore' and (current_deleted is null or base_rev<>current_revision) then conflict_fields:=array['deletedAt']; end if;
    if cardinality(conflict_fields)>0 then
      update public.sync_mutations set status='conflict',resulting_revision=current_revision where user_id=uid and mutation_id=mid;
      insert into public.sync_conflicts(user_id,entity_type,entity_id,mutation_id,local_patch,remote_payload,conflict_fields,base_revision,remote_revision,local_operation,remote_deleted_at)
        values(uid,etype,eid,mid,patch,current_payload,conflict_fields,base_rev,current_revision,op,current_deleted) returning conflict_id into cid;
      result:=result || jsonb_build_array(jsonb_build_object('mutationId',mid,'status','conflict','revision',current_revision,'fields',conflict_fields,'conflictId',cid,'entityType',etype,'entityId',eid));
      continue;
    end if;
    insert into public.sync_entities(user_id,entity_type,entity_id,payload,revision,device_id,last_mutation_id,deleted_at)
      values(uid,etype,eid,case when op='delete' then current_payload else current_payload||patch end,current_revision+1,device,mid,
        case when op='delete' then coalesce(current_deleted,clock_timestamp()) else null end)
      on conflict(user_id,entity_type,entity_id) do update set payload=excluded.payload,revision=excluded.revision,
        device_id=excluded.device_id,last_mutation_id=excluded.last_mutation_id,deleted_at=excluded.deleted_at;
    update public.sync_mutations set status='applied',resulting_revision=current_revision+1 where user_id=uid and mutation_id=mid;
    result:=result || jsonb_build_array(jsonb_build_object('mutationId',mid,'status','applied','revision',current_revision+1));
  end loop;
  return result;
end; $$;

-- Resolution schema: { expectedRevision, action: keepRemote|merge|delete|restore, fields: {...} }.
-- A complete field choice is committed atomically. Never implicitly restore.
create or replace function public.resolve_conflict(p_conflict_id uuid,p_resolution jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare uid uuid:=auth.uid(); c public.sync_conflicts; e public.sync_entities; action text; fields jsonb; response jsonb; mid text;
begin
  if uid is null then raise exception using errcode='42501',message='authentication required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(uid::text,0));
  select * into c from public.sync_conflicts where user_id=uid and conflict_id=p_conflict_id for update;
  if not found then raise exception using errcode='P0002',message='conflict not found'; end if;
  if c.status<>'open' then return jsonb_build_object('resolved',true,'duplicate',true); end if;
  select * into e from public.sync_entities where user_id=uid and entity_type=c.entity_type and entity_id=c.entity_id for update;
  action:=p_resolution->>'action'; fields:=coalesce(p_resolution->'fields','{}');
  if coalesce(p_resolution->>'expectedRevision','') !~ '^[0-9]{1,15}$' or (p_resolution->>'expectedRevision')::bigint<>e.revision then
    update public.sync_conflicts set remote_revision=e.revision,remote_payload=e.payload,remote_deleted_at=e.deleted_at,
      conflict_fields=case when e.deleted_at is not null or c.local_operation in ('delete','restore') then array['deletedAt']
        else array(select field from jsonb_object_keys(c.local_patch) as k(field) where (c.local_patch->field) is distinct from (e.payload->field)) end
      where conflict_id=c.conflict_id;
    return jsonb_build_object('resolved',false,'reason','stale','revision',e.revision);
  end if;
  if action is null or action not in ('keepRemote','merge','delete','restore') or jsonb_typeof(fields)<>'object' then
    raise exception using errcode='22023',message='invalid resolution';
  end if;
  if action='merge' and ('deletedAt'=any(c.conflict_fields) or e.deleted_at is not null) then
    raise exception using errcode='22023',message='choose keepRemote, delete or explicit restore';
  end if;
  if action<>'keepRemote' then
    if action='merge' and exists(select 1 from unnest(c.conflict_fields) f where not fields ? f) then
      raise exception using errcode='22023',message='choose all conflicting fields';
    end if;
    mid:='resolve:'||p_conflict_id::text;
    response:=public.push_mutations(jsonb_build_array(jsonb_build_object('mutationId',mid,'entityType',c.entity_type,'entityId',c.entity_id,
      'operation',case when action='merge' then 'upsert' else action end,'patch',case when action='delete' then '{}'::jsonb else c.local_patch||fields end,
      'basePayload',e.payload,'baseRevision',e.revision,'deviceId','conflict-resolution')));
    if response->0->>'status' not in ('applied','duplicate') then raise exception using errcode='22023',message='resolution no longer applicable'; end if;
  end if;
  update public.sync_conflicts set status='resolved',resolution=p_resolution,resolved_at=clock_timestamp(),resolved_by=uid where conflict_id=c.conflict_id;
  return jsonb_build_object('resolved',true);
end; $$;

create or replace function public.pull_changes(p_cursor timestamptz default null,p_cursor_entity text default '',p_limit integer default 500)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare uid uuid:=auth.uid(); rows jsonb; last_updated timestamptz; last_entity text; more boolean; lim integer:=greatest(1,least(coalesce(p_limit,500),500));
begin
  if uid is null then raise exception using errcode='42501',message='authentication required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(uid::text,0));
  with page as (
    select *,entity_type||'|'||entity_id as key from public.sync_entities where user_id=uid
      and (p_cursor is null or (updated_at,(entity_type||'|'||entity_id) collate "C")>(p_cursor,coalesce(p_cursor_entity,'') collate "C"))
    order by updated_at,(entity_type||'|'||entity_id) collate "C" limit lim
  ) select coalesce(jsonb_agg(jsonb_build_object('entityType',entity_type,'entityId',entity_id,'payload',payload,'revision',revision,
    'deviceId',device_id,'lastMutationId',last_mutation_id,'updatedAt',updated_at,'deletedAt',deleted_at) order by updated_at,key collate "C"),'[]'),
    max(updated_at),(array_agg(key order by updated_at desc,key collate "C" desc))[1] into rows,last_updated,last_entity from page;
  select exists(select 1 from public.sync_entities where user_id=uid and (updated_at,(entity_type||'|'||entity_id) collate "C")>(last_updated,last_entity collate "C")) into more;
  return jsonb_build_object('items',rows,'nextCursor',case when last_updated is null then null else jsonb_build_object('updatedAt',last_updated,'entity',last_entity) end,'hasMore',more);
end; $$;
revoke all on function public.resolve_conflict(uuid,jsonb) from public,anon;
grant execute on function public.resolve_conflict(uuid,jsonb) to authenticated;
revoke all on function public.sync_entity_clock() from public,anon,authenticated;
