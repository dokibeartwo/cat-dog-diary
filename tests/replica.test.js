const test=require('node:test');
const assert=require('node:assert/strict');
const j=require('../packages/core/src/replica');
const {applyEntities}=require('../packages/core/src/projection');
const rules=require('../packages/core/src/mobile-rules');
const diary=require('../src/shared/diary-v1');
const entity=(id,payload,revision=1)=>({entityType:'task',entityId:id,payload,revision,updatedAt:'2026-09-22T00:00:00.123456Z',deletedAt:null});
test('remote task edits preserve steps and pages may arrive child-first',()=>{
  const state={tasks:[{id:'t',title:'old',steps:[{id:'s',title:'step'}]}]};
  let next=applyEntities(state,[entity('t',{title:'new'})]);assert.equal(next.tasks[0].steps[0].title,'step');
  next=applyEntities({},[{...entity('s',{taskId:'t',title:'child'}),entityType:'step'},entity('t',{title:'parent'})]);assert.equal(next.tasks[0].steps[0].id,'s');
});
test('legacy reminder projection cannot re-enable a paused reminder',()=>{
  const next=applyEntities({},[entity('t',{title:'Task',reminderMode:'interval',reminderActive:false}),{...entity('task:t',{targetType:'task',targetId:'t',mode:'interval',active:true}),entityType:'reminder_rule'}]);
  assert.equal(next.tasks[0].reminderActive,false);
});
test('mutations contain changed fields and sent IDs remain immutable across concurrent edits',()=>{
  const r=j.emptyReplica(),before=entity('t',{title:'A',notes:'old'});r.remote['task|t']=before;
  j.enqueue(r,before,entity('t',{title:'B',notes:'old'}),{deviceId:'win',mutationId:'m1'});
  assert.deepEqual(r.outbox[0].patch,{title:'B'});r.outbox[0].attempted=true;const wire=j.transportMutation(r.outbox[0]);
  j.enqueue(r,entity('t',{title:'B',notes:'old'}),entity('t',{title:'C',notes:'old'}),{deviceId:'win',mutationId:'m2'});
  assert.deepEqual(j.transportMutation(r.outbox[0]),wire);
  j.commitExchange(r,[{mutationId:'m1',status:'applied'}],[entity('t',{title:'B',notes:'remote'},2)],null);
  assert.equal(j.materialize(r)[0].payload.title,'C');assert.equal(j.materialize(r)[0].payload.notes,'remote');
});
test('first merge is conservative and never revives a cloud tombstone',()=>{
  const remote=entity('gone',{title:'deleted'});remote.deletedAt='2026-01-01T00:00:00Z';
  const r=j.prepareMerge([entity('gone',{title:'stale'}),entity('same',{title:'phone'})],[remote,entity('same',{title:'pc'},8)],()=> 'm1','android');
  assert.ok(j.materialize(r).find(e=>e.entityId==='gone').deletedAt);assert.equal(r.outbox.length,1);assert.equal(r.outbox[0].baseRevision,0);assert.deepEqual(r.outbox[0].basePayload,{});
});
test('independent devices produce identical recurring task and step IDs',()=>{
  const task={id:'series',completed:true,dueAt:'2026-09-22T10:00:00Z',recurrence:{kind:'daily',interval:1},steps:[{id:'step-old',title:'child'}]};
  const a={tasks:[structuredClone(task)]},b={tasks:[structuredClone(task)]};
  const x=diary.spawnNext(a,a.tasks[0],()=> 'uuid-a',new Date('2026-09-22T11:00:00Z'));
  const y=diary.spawnNext(b,b.tasks[0],()=> 'uuid-b',new Date('2026-09-22T11:00:30Z'));
  assert.equal(x.id,y.id);assert.equal(x.steps[0].id,y.steps[0].id);
});
test('mobile reminder reconciliation dedupes missed periods, defers habits while paused, invalidates edits',()=>{
  const start=Date.parse('2026-09-22T13:00:00+08:00');
  const t={id:'t',title:'Task',reminderMode:'interval',reminderMinutes:30,reminderActive:true};
  let rows=rules.reconcileReminders([],rules.reminderSpecs([t],[],null,start),start);
  rows=rules.reconcileReminders(rows,rules.reminderSpecs([t],[],null,start+95*60000),start+95*60000);
  assert.equal(rows.length,1);assert.equal(rows[0].at,new Date(start+30*60000).toISOString());assert.equal(rows[0].pending,true);
  rows=rules.reconcileReminders(rows,rules.reminderSpecs([t],[],null,start+95*60000),start+95*60000,{sessionId:'focus',mode:'focus',running:false,completed:false});
  assert.equal(rows[0].deferred,true);
  assert.equal(rules.reconcileReminders(rows,rules.reminderSpecs([{...t,completed:true}],[],null,start),start).length,0);
});
test('today includes earlier unfinished and ongoing, excludes unscheduled and future',()=>{
  const now=new Date('2026-09-22T12:00:00');
  const tasks=[{id:'a',planDate:'2026-09-21'},{id:'b',planDate:'2026-09-23'},{id:'c',scheduleMode:'ongoing'},{id:'d',scheduleMode:'backlog'}];
  assert.deepEqual(rules.todayTasks(tasks,now).map(t=>t.id),['a','c']);
});
