const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

test('actual PostgreSQL RPCs: merge, retry, tombstone, conflict resolution, RLS and microsecond cursor', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth;
      create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      -- Baseline compatibility only; the active RPC uses PostgreSQL's
      -- built-in SHA-256 (no cryptographic substitution in the active path).
      create function public.digest(text,text) returns bytea language sql immutable as $$ select convert_to(md5($1),'UTF8') $$;
      grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;`);
    for (const file of fs.readdirSync(path.join(__dirname, '../supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) {
      const sql = fs.readFileSync(path.join(__dirname, '../supabase/migrations', file), 'utf8').replace('create extension if not exists pgcrypto;', '');
      await db.exec(sql);
    }
    const a = '11111111-1111-4111-8111-111111111111', b = '22222222-2222-4222-8222-222222222222';
    await db.query('insert into auth.users(id,email) values ($1,$2),($3,$4)', [a,'a@example.test',b,'b@example.test']);
    await db.exec(`set role authenticated; set request.jwt.claim.sub='${a}';`);
    const push = async m => (await db.query('select public.push_mutations($1::jsonb) as value', [JSON.stringify([m])])).rows[0].value[0];
    const base = { entityType:'task',entityId:'t1',operation:'upsert',baseRevision:0,basePayload:{},deviceId:'win',createdAt:'2026-01-01T00:00:00Z' };
    assert.equal((await push({...base,mutationId:'m1',patch:{title:'Task',notes:''}})).status,'applied');
    assert.equal((await push({...base,mutationId:'m1',patch:{title:'Task',notes:''}})).status,'duplicate');
    const lease=async(device,session)=> (await db.query('select public.acquire_focus_lease($1,$2,1620) as value',[device,session])).rows[0].value;
    assert.equal((await lease('win','round-a')).ok,true);
    assert.equal((await lease('android','round-b')).ok,false);
    await db.query('select public.release_focus_lease($1,$2)',['win','wrong-round']);
    assert.equal((await lease('android','round-b')).ok,false);
    await db.query('select public.release_focus_lease($1,$2)',['win','round-a']);
    assert.equal((await lease('android','round-b')).ok,true);
    await assert.rejects(push({...base,mutationId:'m1',patch:{title:'reused'}}),/mutation-id-reuse/);
    const v1 = {title:'Task',notes:''};
    assert.equal((await push({...base,mutationId:'m2',baseRevision:1,basePayload:v1,patch:{title:'Win'}})).status,'applied');
    assert.equal((await push({...base,mutationId:'m3',baseRevision:1,basePayload:v1,patch:{notes:'Android'}})).status,'applied');
    const conflictMutation={...base,mutationId:'m4',baseRevision:1,basePayload:v1,patch:{title:'Phone'}};
    const c = await push(conflictMutation);
    assert.equal(c.status,'conflict'); assert.equal((await push(conflictMutation)).status,'conflict');
    let pulled = (await db.query('select public.pull_changes() as value')).rows[0].value;
    assert.equal(pulled.items[0].payload.title,'Win'); assert.equal(pulled.items[0].payload.notes,'Android');
    await push({...base,mutationId:'m5',operation:'delete',baseRevision:3,basePayload:{title:'Win',notes:'Android'},patch:{}});
    const stale = (await db.query('select public.resolve_conflict($1,$2) as value',[c.conflictId,JSON.stringify({action:'merge',expectedRevision:3,fields:{title:'Phone'}})])).rows[0].value;
    assert.equal(stale.resolved,false);
    await assert.rejects(db.query('select public.resolve_conflict($1,$2)',[c.conflictId,JSON.stringify({action:'merge',expectedRevision:4,fields:{title:'Phone'}})]),/explicit restore/);
    const staleEdit=await push({...base,mutationId:'m6',baseRevision:3,basePayload:{title:'Win',notes:'Android'},patch:{notes:'late'}});
    assert.equal(staleEdit.status,'conflict');
    assert.equal((await db.query('select payload,deleted_at from public.sync_entities')).rows[0].deleted_at instanceof Date,true);
    await db.query('select public.resolve_conflict($1,$2)',[staleEdit.conflictId,JSON.stringify({action:'keepRemote',expectedRevision:4})]);
    const next = (await db.query('select public.pull_changes($1,$2,1) as value',[pulled.nextCursor.updatedAt,pulled.nextCursor.entity])).rows[0].value;
    assert.equal(next.items.length,1); assert.ok(next.items[0].deletedAt);
    await db.exec(`set request.jwt.claim.sub='${b}'`);
    assert.equal((await db.query('select * from public.sync_entities')).rows.length,0);
    assert.equal((await db.query('select public.pull_changes() as value')).rows[0].value.items.length,0);
    await assert.rejects(db.query("insert into public.sync_entities(user_id,entity_type,entity_id,device_id) values ($1,'task','forbidden','x')",[a]),/permission denied/);
    await db.exec('reset role');
    await db.exec(`set request.jwt.claim.sub='${a}'`);
    await db.query('select public.delete_account()');
    assert.equal((await db.query('select * from public.sync_entities')).rows.length,0);
    assert.equal((await db.query('select * from public.sync_conflicts')).rows.length,0);
  } finally { await db.close(); }
});
