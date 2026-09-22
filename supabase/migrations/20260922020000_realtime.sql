-- Realtime is optional for local SQL tests. Supabase supplies this publication.
-- Polling remains the fallback if a network cannot maintain the WebSocket.
do $$
begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime')
     and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='sync_entities') then
    alter publication supabase_realtime add table public.sync_entities;
  end if;
end; $$;
