const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const {renderBootstrap}=require('../supabase/scripts/prepare-bootstrap.cjs');
async function emptyProject(){
  const db=new PGlite();
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function public.digest(text,text) returns bytea language sql immutable as $$ select convert_to(md5($1),'UTF8') $$;
    grant usage on schema auth to authenticated;
    grant execute on function auth.uid() to authenticated;
    alter default privileges in schema public grant all on tables to anon,authenticated;
  `);
  return db;
}
const compatible=sql=>sql.replace('create extension if not exists pgcrypto;','');
test('bootstrap contains every ordered migration and no project credentials',()=>{
  const {sql,manifest}=renderBootstrap();
  assert.equal(manifest.length,fs.readdirSync(path.join(__dirname,'../supabase/migrations')).filter(n=>n.endsWith('.sql')).length);
  assert.equal(manifest.at(-1).name,'20261007000000_client_privileges.sql');
  assert.ok(sql.includes('begin;')&&sql.endsWith('commit;\n'));
  assert.doesNotMatch(sql,/postgres(?:ql)?:\/\/|sb_secret_|github_pat_|ghp_/i);
  for(const row of manifest)assert.match(row.sha256,/^[0-9a-f]{64}$/);
});
test('new-project bootstrap narrows permissive grants, keeps RPCs and refuses reinitialization',async()=>{
  const db=await emptyProject();
  try{
    await db.exec(compatible(renderBootstrap().sql));
    const checks=(await db.query(fs.readFileSync(path.join(__dirname,'../supabase/check-readiness.sql'),'utf8'))).rows;
    assert.equal(checks.length,14);assert.ok(checks.every(c=>c.passed),JSON.stringify(checks));
    const owner='11111111-1111-4111-8111-111111111111';
    await db.query('insert into auth.users(id,email) values ($1,$2)',[owner,'owner@example.test']);
    await db.exec(`set role authenticated; set request.jwt.claim.sub='${owner}';`);
    const item={mutationId:'new-project-test',entityType:'task',entityId:'task1',operation:'upsert',patch:{title:'safe'},baseRevision:0,basePayload:{},deviceId:'web'};
    assert.equal((await db.query('select public.push_mutations($1::jsonb) as data',[JSON.stringify([item])])).rows[0].data[0].status,'applied');
    await assert.rejects(db.exec('truncate public.sync_entities'),/permission denied/);
    await db.exec('reset role; set role anon;');
    await assert.rejects(db.exec('select * from public.sync_entities'),/permission denied/);
    await assert.rejects(db.exec('truncate public.sync_entities'),/permission denied/);
    await assert.rejects(db.exec('select public.delete_account()'),/permission denied/);
    await db.exec('reset role;');
    await assert.rejects(db.exec(compatible(renderBootstrap().sql)),/not an empty project/);
    await db.exec('rollback;');
    assert.equal((await db.query('select count(*)::int as n from public.sync_entities')).rows[0].n,1);
  }finally{await db.close();}
});
test('incremental permission hardening preserves existing tasks',async()=>{
  const db=await emptyProject();
  try{
    const dir=path.join(__dirname,'../supabase/migrations');
    for(const name of fs.readdirSync(dir).filter(n=>n.endsWith('.sql')&&!n.startsWith('20261007')).sort())await db.exec(compatible(fs.readFileSync(path.join(dir,name),'utf8')));
    const before=await db.query("select has_table_privilege('anon','public.sync_entities','TRUNCATE') as allowed");
    assert.equal(before.rows[0].allowed,true);
    const owner='11111111-1111-4111-8111-111111111111';
    await db.query('insert into auth.users(id,email) values ($1,$2)',[owner,'owner@example.test']);
    await db.query("insert into public.sync_entities(user_id,entity_type,entity_id,payload,device_id) values ($1,'task','keep','{\"title\":\"Keep me\"}','win')",[owner]);
    const sql=fs.readFileSync(path.join(dir,'20261007000000_client_privileges.sql'),'utf8');
    await db.exec(sql);await db.exec(sql);
    assert.equal((await db.query("select has_table_privilege('anon','public.sync_entities','TRUNCATE') as allowed")).rows[0].allowed,false);
    assert.equal((await db.query("select payload->>'title' as title from public.sync_entities")).rows[0].title,'Keep me');
  }finally{await db.close();}
});
