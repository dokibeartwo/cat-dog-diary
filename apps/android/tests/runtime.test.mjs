import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Module,{createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
const require=createRequire(import.meta.url),ts=require('typescript');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const journal=require('../../../packages/core/src/replica');
function loadServices(){
  const sqlite=new DatabaseSync(':memory:'),cache=new Map();
  const scheduled=new Map(),deliveries=[];
  let granted=true;
  const notifications={setNotificationHandler(){},SchedulableTriggerInputTypes:{DATE:'date'},AndroidNotificationPriority:{HIGH:1},AndroidImportance:{MAX:5},AndroidNotificationVisibility:{PUBLIC:1},
    async getPermissionsAsync(){return {granted};},async setNotificationChannelAsync(){},
    async scheduleNotificationAsync(value){scheduled.set(value.identifier,value);deliveries.push(value);return value.identifier;},
    async cancelScheduledNotificationAsync(id){scheduled.delete(id);},async dismissNotificationAsync(){},
    async cancelAllScheduledNotificationsAsync(){scheduled.clear();},async dismissAllNotificationsAsync(){}};
  const facade={execSync:s=>sqlite.exec(s),getAllSync:(s,a=[])=>sqlite.prepare(s).all(...a),getFirstSync:(s,a=[])=>sqlite.prepare(s).get(...a),runSync:(s,a=[])=>sqlite.prepare(s).run(...a),withTransactionSync(fn){sqlite.exec('BEGIN');try{fn();sqlite.exec('COMMIT');}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
  function load(file){
    const absolute=path.resolve(root,file);if(cache.has(absolute))return cache.get(absolute).exports;
    const mod=new Module(absolute);mod.filename=absolute;mod.paths=Module._nodeModulePaths(path.dirname(absolute));cache.set(absolute,mod);
    const realRequire=mod.require.bind(mod);
    mod.require=name=>{
      if(name==='expo-sqlite')return {openDatabaseSync:()=>facade};
      if(name==='expo-notifications')return notifications;
      if(name==='expo-intent-launcher')return {startActivityAsync:async()=>{}};
      if(name==='react-native')return {AppState:{currentState:'active'},Platform:{OS:'android'},Linking:{openSettings:async()=>{}}};
      if(name==='./supabase')return {supabase:null};
      if(name.startsWith('.')){const p=path.resolve(path.dirname(absolute),name+'.ts');if(fs.existsSync(p))return load(p);}
      return realRequire(name);
    };
    const source=ts.transpileModule(fs.readFileSync(absolute,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    mod._compile(source,absolute);return mod.exports;
  }
  return {db:load('src/services/local-db.ts'),sync:load('src/services/sync.ts'),focus:load('src/services/focus.ts'),reminders:load('src/services/notifications.ts'),sqlite,scheduled,deliveries,notifications,setPermission:value=>{granted=value;},close:()=>sqlite.close()};
}
const e=(id,payload,revision=1)=>({entityType:'task',entityId:id,payload,revision,updatedAt:'2026-09-22T00:00:00.123456Z',deletedAt:null,deviceId:'win',lastMutationId:'cloud'});
test('real SQLite writes preserve IDs, step edits, soft deletion and separate account caches',async()=>{
  const {db,close}=loadServices();try{
    await db.saveEntity('task',{id:'t',title:'Offline',completed:false,nextReminderAt:'private',localNotificationId:'private'});
    await db.saveEntity('step',{id:'s',taskId:'t',title:'Step',completed:false});
    assert.equal((await db.listTasks())[0].id,'t');assert.equal(db.readReplica().outbox[0].patch.localNotificationId,undefined);
    db.selectAccount('a');await db.saveEntity('task',{...(await db.listTasks())[0],title:'A edit'});
    db.selectAccount('b');assert.equal((await db.listTasks()).length,0);
    db.selectAccount('a');assert.equal((await db.listTasks())[0].title,'A edit');
    await db.deleteTask('t');assert.equal((await db.listTasks()).length,0);assert.equal((await db.listEntities('step')).length,0);
    await db.restoreEntity('task','t');assert.equal((await db.listTasks())[0].title,'A edit');
  }finally{close();}
});
test('first merge is read-only until confirmation, rejects stale previews and preserves a durable backup',async()=>{
  const {db,sync,sqlite,close}=loadServices();try{
    let account='a',pushed=0;
    await db.saveEntity('task',{id:'local',title:'Local'});db.selectAccount('a');
    const adapter={identity:async()=>account,push:async()=>{pushed++;return [];},pull:async()=>({entities:[e('remote',{title:'Cloud'})],cursor:null,hasMore:false})};
    const service=new sync.SyncService(db.localStore,adapter);
    await assert.rejects(service.run(),/先预览/);
    const p=await service.preview();assert.equal(p.localEntities,1);assert.equal(p.cloudEntities,1);assert.equal(pushed,0);assert.equal((await db.listTasks()).length,1);
    await db.saveEntity('task',{id:'local',title:'Changed'});await assert.rejects(service.merge(p.token),/修改/);
    const fresh=await service.preview();await service.merge(fresh.token);assert.equal((await db.listTasks()).length,2);assert.equal(pushed,0);
    assert.equal(sqlite.prepare('SELECT count(*) n FROM sync_backups').get().n,1);assert.equal(db.readReplica().migrated,true);
    account='b';await assert.rejects(service.merge(fresh.token),/过期/);
  }finally{close();}
});
test('sync batches at 100, preserves concurrent local edits, keeps raw cursor and retries immutable mutations',async()=>{
  const {db,sync,close}=loadServices();try{
    db.selectAccount('a');let r=db.readReplica();r.migrated=true;r.remote['task|t']=e('t',{title:'Base',notes:''});db.writeReplica(r);
    await db.saveEntity('task',{id:'t',title:'First',notes:''});
    let sent,pullCount=0;
    const adapter={identity:async()=> 'a',push:async mutations=>{sent=structuredClone(mutations);assert.ok(mutations.length<=100);await db.saveEntity('task',{id:'t',title:'Second',notes:''});return mutations.map(m=>({mutationId:m.mutationId,status:'applied'}));},pull:async()=>{pullCount++;return {entities:[e('t',{title:'First',notes:'remote'},2)],cursor:{updatedAt:'2026-09-22T00:00:00.123456Z',entityId:'task|t'},hasMore:false};}};
    const service=new sync.SyncService(db.localStore,adapter);await Promise.all([service.run(),service.run()]);
    assert.equal(pullCount,1);assert.deepEqual(sent[0].patch,{title:'First',completed:false});assert.equal(sent[0].attempted,undefined);
    const task=(await db.listTasks())[0];assert.equal(task.title,'Second');assert.equal(task.notes,'remote');assert.equal(db.readReplica().outbox.length,1);assert.match(db.readReplica().cursor.updatedAt,/123456/);
    const old=journal.transportMutation(db.readReplica().outbox[0]);adapter.push=async()=>{throw Error('offline');};await assert.rejects(service.run(),/offline/);
    await db.saveEntity('task',{id:'t',title:'Third',notes:'remote'});assert.deepEqual(journal.transportMutation(db.readReplica().outbox[0]),old);
  }finally{close();}
});
test('account changes during a request cannot apply the old response',async()=>{
  const {db,sync,close}=loadServices();try{
    db.selectAccount('a');let r=db.readReplica();r.migrated=true;db.writeReplica(r);
    let account='a';const adapter={identity:async()=>account,push:async()=>[],pull:async()=>{account='b';db.selectAccount('b');return {entities:[e('secret',{title:'A private'})],cursor:null,hasMore:false};}};
    await assert.rejects(new sync.SyncService(db.localStore,adapter).run(),/账号已变化/);assert.equal((await db.listTasks()).length,0);
  }finally{close();}
});

test('SQLite compare-and-swap rejects stale background writes without losing new edits',async()=>{
  const {db,close}=loadServices();try{
    const old=db.readReplica();await db.saveTask({id:'new',title:'Just typed',completed:false});
    assert.throws(()=>db.writeReplica(old),/后台刚更新/);
    assert.equal((await db.listTasks())[0].title,'Just typed');
  }finally{close();}
});

test('actual focus service preserves segments across pause, counts reality once and projects to Windows',async t=>{
  const {db,focus,close}=loadServices();let now=Date.now();t.mock.method(Date,'now',()=>now);
  try{
    const started=await focus.startFocus('focus',2,{id:'task',title:'Experiment'});
    now+=30000;await focus.toggleFocus();now+=600000;
    assert.equal(focus.remaining(focus.readFocus()),90);
    await focus.toggleFocus();now+=90000;await focus.finishFocus();await focus.finishFocus();
    const history=await db.listEntities('focus_session');assert.equal(history.length,1);
    assert.equal(history[0].id,started.sessionId);assert.equal(history[0].durationSeconds,120);assert.equal(history[0].segments.length,2);
    assert.equal(require('../../../src/shared/productivity').normalizeHistory(history)[0].durationSeconds,120);
    const other=await focus.startFocus('focus',1);now+=20000;await focus.finishFocus(true);
    assert.equal((await db.listEntities('focus_session')).find(h=>h.id===other.sessionId).outcome,'interrupted');
  }finally{close();}
});

test('notification adapter deduplicates until handled, reschedules from close, and restores cleared OS identifiers',async t=>{
  const {db,reminders,deliveries,scheduled,setPermission,close}=loadServices();let now=Date.parse('2026-09-22T13:00:00+08:00');t.mock.method(Date,'now',()=>now);
  try{
    await db.saveTask({id:'long',title:'Long experiment',completed:false,scheduleMode:'ongoing',reminderMode:'interval',reminderMinutes:30,reminderActive:true});
    await reminders.rebuildReminders();assert.equal(deliveries.length,1);
    now+=95*60000;for(let i=0;i<5;i++)await reminders.rebuildReminders();assert.equal(deliveries.length,1);
    await reminders.handleReminder('interval:long','ack');assert.equal(reminders.reminderRows().length,1);
    assert.equal(Date.parse(reminders.reminderRows()[0].at),now+30*60000);assert.equal(deliveries.length,2);
    await reminders.clearDeviceNotifications();assert.equal(scheduled.size,0);await reminders.rebuildReminders();assert.equal(scheduled.size,1);
    await reminders.handleReminder('interval:long','snooze',10);assert.equal(Date.parse(reminders.reminderRows()[0].at),now+10*60000);
    await db.deleteTask('long');await reminders.rebuildReminders();assert.equal(scheduled.size,0);
    setPermission(false);await db.saveTask({id:'denied',title:'Permission denied',completed:false,reminderMode:'interval',reminderMinutes:30});await reminders.rebuildReminders();assert.equal(scheduled.size,0);
  }finally{close();}
});

test('dismissed event and focus reminders stay dismissed across arbitrary rebuilds',async t=>{
  const {db,reminders,deliveries,close}=loadServices();let now=Date.now();t.mock.method(Date,'now',()=>now);
  try{
    await db.saveTask({id:'event',title:'Meeting',completed:false,dueAt:new Date(now).toISOString(),reminderMode:'event',reminderMinutes:10});
    await reminders.rebuildReminders();await reminders.handleReminder('event:event','ack');const count=deliveries.length;
    for(let i=0;i<5;i++){now+=30000;await reminders.rebuildReminders();}assert.equal(deliveries.length,count);
    db.setMeta(`focus.state.${db.activeDataset()}`,{sessionId:'one',mode:'focus',completed:true,endsAt:new Date(now).toISOString()});
    await reminders.rebuildReminders();await reminders.handleReminder('focus:one','ack');const count2=deliveries.length;
    for(let i=0;i<5;i++)await reminders.rebuildReminders();assert.equal(deliveries.length,count2);
  }finally{close();}
});

test('a delayed rebuild cannot overwrite acknowledgement; repeated clicks keep the next occurrence intact',async t=>{
  const {db,reminders,notifications,close}=loadServices();let now=Date.now();t.mock.method(Date,'now',()=>now);
  try{
    await db.saveTask({id:'race',title:'Experiment',completed:false,reminderMode:'interval',reminderMinutes:30});
    await reminders.rebuildReminders();now+=31*60000;
    const occurrence=structuredClone(reminders.reminderRows()[0]);
    let release,entered;const gate=new Promise(r=>{release=r;}),ready=new Promise(r=>{entered=r;});
    const original=notifications.getPermissionsAsync;
    notifications.getPermissionsAsync=async()=>{entered();await gate;return original();};
    const rebuilding=reminders.rebuildReminders();await ready;
    const first=reminders.handleReminder('interval:race','ack',10,occurrence),second=reminders.handleReminder('interval:race','ack',10,occurrence);
    release();await Promise.all([rebuilding,first,second]);
    assert.equal(Date.parse(reminders.reminderRows()[0].at),now+30*60000);assert.equal(reminders.reminderRows()[0].pending,false);
    now+=60000;await reminders.handleReminder('interval:race','ack',10,occurrence);
    assert.equal(Date.parse(reminders.reminderRows()[0].at),now+29*60000,'stale UI cannot acknowledge the next cycle');
  }finally{close();}
});

test('advance warning acknowledgement retains the due-time alert without accumulating reminders',async t=>{
  const {db,reminders,deliveries,close}=loadServices();let now=Date.now();t.mock.method(Date,'now',()=>now);
  try{
    const dueAt=new Date(now+30*60000).toISOString();
    await db.saveTask({id:'meeting',title:'Meeting',completed:false,dueAt,reminderMode:'event',reminderMinutes:10});
    await reminders.rebuildReminders();now+=21*60000;await reminders.rebuildReminders();
    await reminders.handleReminder('event:meeting','ack');assert.equal(reminders.reminderRows()[0].at,dueAt);
    assert.equal(reminders.reminderRows().length,1);const count=deliveries.length;
    now+=10*60000;await reminders.rebuildReminders();await reminders.handleReminder('event:meeting','ack');
    for(let i=0;i<5;i++)await reminders.rebuildReminders();assert.equal(deliveries.length,count);
  }finally{close();}
});

test('permission revocation clears stale IDs and switching accounts during scheduling does not leak alerts',async()=>{
  const {db,reminders,notifications,scheduled,setPermission,close}=loadServices();
  try{
    await db.saveTask({id:'private',title:'Private',completed:false,reminderMode:'interval',reminderMinutes:30});
    await reminders.rebuildReminders();setPermission(false);await reminders.rebuildReminders();
    assert.equal(scheduled.size,0);assert.equal(reminders.reminderRows()[0].notificationId,null);
    setPermission(true);await reminders.rebuildReminders();assert.equal(scheduled.size,1);
    await reminders.clearDeviceNotifications();db.selectAccount('a');
    const original=notifications.scheduleNotificationAsync;
    notifications.scheduleNotificationAsync=async value=>{const id=await original(value);db.selectAccount('b');return id;};
    await reminders.rebuildReminders();assert.equal(scheduled.size,0);assert.deepEqual(reminders.reminderRows(),[]);
  }finally{close();}
});
