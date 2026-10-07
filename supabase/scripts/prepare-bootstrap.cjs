'use strict';
// Generates a NEW-project SQL Editor artifact; never connects to a database.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
function renderBootstrap(){
  const names=fs.readdirSync(path.join(root,'migrations')).filter(n=>/^\d{14}_[a-z_]+\.sql$/.test(n)).sort();
  if(!names.length)throw Error('No migration files found');
  const sources=names.map(name=>({name,sql:fs.readFileSync(path.join(root,'migrations',name),'utf8').replace(/\r\n/g,'\n')}));
  const header=[
    '-- 猫狗日记：仅用于专门新建的空白 Supabase 项目。',
    '-- 不包含账号、密钥或任务数据；必须由项目所有者选择正确项目后执行。',
    '-- 已有猫狗日记表时主动中止；旧项目用 migrations 增量升级。',
    '-- BEGIN/COMMIT 确保初始化出错时整体回滚。',
    'begin;',
    "set local lock_timeout = '5s';",
    "set local statement_timeout = '120s';",
    'do $$',
    'begin',
    "  if exists (select 1 from unnest(array['profiles','sync_entities','sync_mutations','sync_conflicts','habit_events','device_sessions']) as x(name) where to_regclass('public.'||x.name) is not null) then",
    "    raise exception 'This is not an empty project. Stop and use incremental migrations; no data has been changed.';",
    '  end if;',
    'end; $$;'
  ].join('\n');
  const sql=header+'\n\n'+sources.map(({name,sql})=>'-- BEGIN MIGRATION '+name+'\n'+sql+'\n-- END MIGRATION '+name).join('\n\n')+'\n\ncommit;\n';
  return {sql,manifest:sources.map(({name,sql})=>({name,sha256:crypto.createHash('sha256').update(sql).digest('hex')}))};
}
if(require.main===module){
  const result=renderBootstrap(),dir=path.join(root,'generated');
  fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(dir,'猫狗日记-云同步初始化.sql'),result.sql,'utf8');
  fs.writeFileSync(path.join(dir,'migration-manifest.json'),JSON.stringify(result.manifest,null,2)+'\n');
  console.log('Prepared '+result.manifest.length+' ordered migrations in supabase/generated. No network or database was accessed.');
}
module.exports={renderBootstrap};
