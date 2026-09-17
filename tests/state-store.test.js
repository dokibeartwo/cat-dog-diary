'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {StateStore}=require('../src/state-store');
const diary=require('../src/shared/diary-v1');

function fixture(t,adapter=fs,now=()=>new Date()) {
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'diary-store-audit-'));
  t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));
  const file=path.join(folder,'done-data.json'),legacy=path.join(folder,'legacy.json');
  return {folder,file,legacy,store:new StateStore(file,legacy,adapter,now)};
}
const data=title=>diary.migrate({tasks:[{id:'task-1',title}],preferences:{themeId:'bg6'},customLegacy:{keep:true}});

test('current schema startup creates no migration backup; legacy startup copies original only once',t=>{
  const {file,legacy,store}=fixture(t);
  store.save(data('current'));
  assert.equal(store.load().tasks[0].title,'current');
  assert.equal(store.list().length,0);
  const original=JSON.stringify({tasks:[{id:'old',title:'legacy',customField:{keep:true}}],preferences:{themeId:'bg5'}});
  fs.writeFileSync(file,original);
  assert.equal(store.load().tasks[0].customField.keep,true);
  assert.equal(new StateStore(file,legacy).load().preferences.themeId,'bg5');
  assert.equal(store.list().length,1);
  assert.equal(fs.readFileSync(path.join(store.folder,store.list()[0].name),'utf8'),original);
  store.save(store.load());
  assert.equal(store.load().schemaVersion,1);
  assert.equal(store.list().filter(item=>item.name.includes('-before-upgrade-')).length,1);
});

test('daily backup uses local calendar day and repeats only after local midnight',t=>{
  let now=new Date(2026,8,17,0,15);
  const {store}=fixture(t,fs,()=>now);
  store.save(data('first'));store.save(data('second'));store.save(data('third'));
  let daily=store.list().filter(item=>item.name.includes('-daily-'));
  assert.equal(daily.length,1);assert.ok(daily[0].name.startsWith('diary-2026-09-17T00-15'));
  now=new Date(2026,8,18,0,1);store.save(data('fourth'));
  daily=store.list().filter(item=>item.name.includes('-daily-'));
  assert.equal(daily.length,2);assert.ok(daily[0].name.startsWith('diary-2026-09-18T00-01'));
});

for(const failure of ['write','flush','rename'])test(`failed ${failure} leaves primary unchanged and never recovers uncommitted draft`,t=>{
  const {file,legacy,store}=fixture(t);store.save(data('original'));
  const original=fs.readFileSync(file,'utf8');
  const adapter={...fs};
  if(failure==='write')adapter.writeFileSync=(target,contents,encoding)=>{fs.writeFileSync(target,contents,encoding);throw Error('disk full');};
  if(failure==='flush')adapter.fsyncSync=()=>{throw Error('flush failed');};
  if(failure==='rename')adapter.renameSync=()=>{throw Error('rename denied');};
  const failing=new StateStore(file,legacy,adapter);
  assert.throws(()=>failing.save(data('draft')));
  assert.equal(fs.readFileSync(file,'utf8'),original);
  assert.equal(fs.existsSync(file+'.tmp'),false);
  assert.equal(new StateStore(file,legacy).load().tasks[0].title,'original');
});

test('failed restore preserves corrupt original, recovery copy, and read-only status until successful flush',t=>{
  const {file,legacy,store}=fixture(t);fs.writeFileSync(file,'BROKEN ORIGINAL');
  const failing=new StateStore(file,legacy,{...fs,fsyncSync(){throw Error('flush denied');}});
  assert.equal(failing.load(),null);const issue=failing.issue;
  assert.throws(()=>failing.replace(data('restored')));
  assert.equal(failing.issue,issue);assert.equal(failing.readOnly,true);
  assert.equal(fs.readFileSync(file,'utf8'),'BROKEN ORIGINAL');
  assert.equal(fs.existsSync(file+'.restore.tmp'),false);
  const copy=fs.readdirSync(store.folder).find(name=>name.startsWith('unreadable-'));
  assert.equal(fs.readFileSync(path.join(store.folder,copy),'utf8'),'BROKEN ORIGINAL');
  const restart=new StateStore(file,legacy);restart.load();restart.replace(data('restored'));
  assert.equal(restart.readOnly,false);assert.equal(restart.issue,null);assert.equal(restart.load().tasks[0].title,'restored');
});

test('invalid writes and imports never modify valid state; migration keeps arbitrary old fields',t=>{
  const {file,store}=fixture(t);store.save(data('original'));const original=fs.readFileSync(file,'utf8');
  assert.throws(()=>store.save({tasks:[{id:'a'}]}));
  assert.throws(()=>store.replace({tasks:[],habits:'invalid'}));
  assert.equal(fs.readFileSync(file,'utf8'),original);
  assert.deepEqual(store.load().customLegacy,{keep:true});
});

test('corrupt primary never falls back to old legacy data; missing primary can read legacy safely',t=>{
  const {file,legacy,store}=fixture(t);fs.writeFileSync(legacy,JSON.stringify(data('legacy')));
  assert.equal(store.load().tasks[0].title,'legacy');
  fs.writeFileSync(file,'BROKEN');
  assert.equal(store.load(),null);assert.equal(store.readOnly,true);
  assert.equal(fs.readFileSync(file,'utf8'),'BROKEN');
});

test('backup read is allow-listed and cannot traverse directories',t=>{
  const {store}=fixture(t);store.save(data('safe'));const name=store.backup();
  assert.equal(store.fromBackup(name).tasks[0].title,'safe');
  for(const value of ['../done-data.json','..\\done-data.json','C:\\other.json',name+'/..'])assert.throws(()=>store.fromBackup(value));
});
