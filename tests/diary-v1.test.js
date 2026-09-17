const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const diary=require('../src/shared/diary-v1'),domain=require('../src/shared/domain'),runtime=require('../src/shared/runtime');
const {StateStore}=require('../src/state-store');
const date=value=>new Date(value);
const base=()=>({tasks:[],habits:[],pendingReminders:[],preferences:{},presence:{active:false},focusTimer:{status:'idle'}});

test('v1 migration preserves legacy fullscreens, preferences, tasks, and does not mutate input',()=>{
  const raw={tasks:[{id:'a',title:'老任务',dueAt:'2026-09-17T15:00:00',deadlineDate:'2026-09-20',reminderMode:'interval',reminderMinutes:30}],habits:[{id:'h',active:true}],preferences:{themeId:'bg5',notifications:false},focusHistory:[{id:'record'}]};
  const copy=structuredClone(raw),state=diary.migrate(raw);
  assert.deepEqual(raw,copy);assert.equal(state.preferences.themeId,'bg5');assert.equal(state.preferences.notifications,false);
  assert.equal(state.tasks[0].reminderPresentation,'fullscreen');assert.equal(state.habits[0].active,true);assert.equal(state.schemaVersion,1);assert.equal(state.preferences.onboardingDone,true);
  assert.throws(()=>diary.migrate({...raw,schemaVersion:2}));
});

test('migration validates trash before restore and preserves full notes and unrelated task fields',()=>{
  const task={id:'saved-task',title:'保留',notes:'完整备注'.repeat(10000),priority:'not-a-priority',completed:'false',custom:{keep:true},steps:[{id:'s',title:'步骤',completed:true}]};
  const raw={tasks:[task],trash:[{task:structuredClone(task),deletedAt:'2026-09-17T12:00:00'}],pendingReminders:[{key:'old-key'}],focusTimer:{sessionId:'old-session'}};
  const result=diary.migrate(raw);
  assert.equal(result.tasks[0].priority,'normal');assert.equal(result.tasks[0].completed,false);
  assert.equal(result.trash[0].task.notes,task.notes);assert.deepEqual(result.tasks[0].custom,task.custom);assert.deepEqual(result.tasks[0].steps,task.steps);
  assert.deepEqual(result.pendingReminders,raw.pendingReminders);assert.deepEqual(result.focusTimer,raw.focusTimer);
  for(const patch of [{id:'../invalid'},{id:'bad id'},{title:undefined}]) {
    const broken=structuredClone(raw);Object.assign(broken.trash[0].task,patch);assert.throws(()=>diary.migrate(broken));
  }
  assert.throws(()=>diary.migrate({...raw,trash:[...raw.trash,...raw.trash]}));
  assert.throws(()=>diary.migrate({...raw,trash:[{task,deletedAt:'invalid'}]}));
  for(const schemaVersion of ['bad',-1,1.5])assert.throws(()=>diary.migrate({...raw,schemaVersion}));
  assert.throws(()=>diary.migrate({tasks:[],habits:[{id:'h',time:'25:99'}]}));
});
test('day-only task is in today without fake time; tomorrow stays out and past carries over',()=>{
  const now=date('2026-09-17T12:00:00');
  const task={planDate:'2026-09-17',completed:false,scheduleMode:'day'};
  assert.equal(domain.isTaskInView(task,'today',null,now),true);assert.equal(domain.getTaskStatus(task,now),'flexible');
  assert.equal(domain.isTaskInView({...task,planDate:'2026-09-18'},'today',null,now),false);
  assert.equal(domain.isCarryoverTask({...task,planDate:'2026-09-16'},now),true);
  assert.equal(domain.isTaskInView({scheduleMode:'backlog',priorityDate:'2026-09-17'},'today',null,now),true);
});
test('Chinese capture recognizes explicit local date/time/lead; preserves unparsed ambiguity',()=>{
  const now=date('2026-09-17T23:55:00');
  const parsed=diary.parseCapture('明天下午3点项目讨论，提前10分钟提醒',now);
  assert.equal(parsed.title,'项目讨论');assert.equal(parsed.planDate,'2026-09-18');assert.equal(parsed.time,'15:00');assert.equal(parsed.reminderMinutes,10);
  assert.equal(diary.parseCapture('明天阅读论文',now).time,null);
  const unsure=diary.parseCapture('3点讨论',now);assert.equal(unsure.time,null);assert.ok(unsure.title.includes('3点'));assert.ok(unsure.notes.length);
  assert.equal(diary.parseCapture('下周一上午9点开会',now).planDate,'2026-09-21');
  assert.equal(diary.parseCapture('今天25:99实验',now).time,null);
});
test('monthly recurrence retains month-end anchor, skips missed periods, only spawns one',()=>{
  const task={id:'a',title:'月报',planDate:'2026-01-31',completed:true,recurrence:{kind:'monthly'},steps:[{id:'s',completed:true}],deadlineDate:'2026-01-31'};
  const state={tasks:[task]};let n=0;const child=diary.spawnNext(state,task,()=>String(++n),date('2026-02-01T12:00:00'));
  assert.equal(child.planDate,'2026-02-28');assert.equal(child.deadlineDate,null);assert.equal(child.steps[0].completed,false);
  assert.equal(diary.spawnNext(state,task,()=>String(++n)),null);assert.equal(state.tasks.length,2);
  assert.equal(diary.nextOccurrence(child,date('2026-03-01T12:00:00')).planDate,'2026-03-31');
  assert.equal(diary.nextOccurrence({...task,recurrence:{kind:'daily'}},date('2026-09-17T12:00:00')).planDate,'2026-09-17');
});
test('workday repetition skips weekends and timed repeats retain clock time',()=>{
  const result=diary.nextOccurrence({dueAt:'2026-09-18T09:30:00',recurrence:{kind:'weekdays'}},date('2026-09-18T10:00:00'));
  assert.equal(new Date(result.dueAt).getDay(),1);assert.equal(new Date(result.dueAt).getHours(),9);assert.equal(new Date(result.dueAt).getMinutes(),30);
});

test('workday repeat intervals count business days; invalid dates do not produce another occurrence',()=>{
  const result=diary.nextOccurrence({planDate:'2026-09-18',recurrence:{kind:'weekdays',interval:2}},date('2026-09-18T10:00:00'));
  assert.equal(result.planDate,'2026-09-22');
  assert.equal(diary.nextOccurrence({dueAt:'invalid',recurrence:{kind:'daily'}},date('2026-09-18T10:00:00')),null);
});

test('unallocated auto task keeps its old load reserved instead of overbooking unchanged tasks',()=>{
  const tasks=[{id:'missed',title:'原日程保留',planDate:'2026-09-18',deadlineDate:'2026-09-16',estimateMinutes:120,scheduleMode:'auto'},
    {id:'new',title:'新任务',estimateMinutes:60,scheduleMode:'backlog'}];
  const result=diary.plan(tasks,{start:'2026-09-18',end:'2026-09-18',dailyMinutes:120,dailyCapacity:3},date('2026-09-17T08:00:00'));
  assert.equal(result.updates.length,0);assert.equal(result.conflicts.length,2);
  assert.equal(result.loads[0].minutes,120);assert.equal(result.loads[0].count,1);
});

test('timed planning does not create an already-passed appointment today',()=>{
  const tasks=[{id:'timed',title:'定时事项',dueAt:'2026-09-16T09:00:00',reminderMode:'event',scheduleMode:'auto',estimateMinutes:25}];
  const result=diary.plan(tasks,{start:'2026-09-17',end:'2026-09-18'},date('2026-09-17T12:00:00'));
  assert.equal(domain.toLocalDateInput(result.updates[0].dueAt),'2026-09-18');
  assert.equal(new Date(result.updates[0].dueAt).getHours(),9);
});
test('capacity planning prioritizes deadlines, counts locked load, and does not mutate tasks',()=>{
  const tasks=[{id:'locked',title:'会议',dueAt:'2026-09-17T11:00:00',scheduleMode:'fixed',estimateMinutes:60},
    {id:'first',title:'当日截止',deadlineDate:'2026-09-17',estimateMinutes:60,scheduleMode:'backlog'},
    {id:'conflict',title:'超出容量',deadlineDate:'2026-09-17',estimateMinutes:90,scheduleMode:'backlog'},
    {id:'later',title:'明天可做',estimateMinutes:45,scheduleMode:'backlog'}];
  const original=structuredClone(tasks),plan=diary.plan(tasks,{start:'2026-09-17',end:'2026-09-18',dailyMinutes:120,dailyCapacity:3},date('2026-09-17T08:00:00'));
  assert.deepEqual(tasks,original);assert.equal(plan.updates[0].id,'first');assert.equal(plan.updates[0].planDate,'2026-09-17');assert.equal(plan.updates[0].dueAt,null);
  assert.equal(plan.conflicts[0].id,'conflict');assert.equal(plan.updates.at(-1).planDate,'2026-09-18');assert.ok(!plan.updates.some(t=>t.id==='locked'));
});
test('quiet spans midnight, emergency exception is explicit, focus completion still shows',()=>{
  const state=base();state.preferences={quietEnabled:true,quietStart:'22:00',quietEnd:'08:00'};state.tasks=[{id:'a',urgentReminder:true}];
  const now=date('2026-09-17T23:00:00').getTime();assert.ok(diary.deferredReason(state,{taskId:'a',type:'event'},now));
  state.preferences.urgentThroughQuiet=true;assert.equal(diary.deferredReason(state,{taskId:'a',type:'event'},now),'');
  state.preferences.remindersEnabled=false;assert.ok(diary.deferredReason(state,{taskId:'a',type:'event'},now));assert.equal(diary.deferredReason(state,{type:'focus'},now),'');
  assert.equal(diary.quiet({quietEnabled:true,quietStart:'22:00',quietEnd:'08:00'},date('2026-09-18T08:00:00')),false);
});
test('habits respect weekdays and working window, never pretend impossible daily time is scheduled',()=>{
  const habit={active:true,scheduleType:'interval',intervalMinutes:60,days:[1,2,3,4,5],windowEnabled:true,windowStart:'09:00',windowEnd:'18:00'};
  const next=new Date(diary.nextHabit(habit,date('2026-09-18T17:30:00')));assert.equal(next.getDay(),1);assert.equal(next.getHours(),9);assert.equal(next.getMinutes(),0);
  assert.equal(diary.nextHabit({...habit,scheduleType:'daily',time:'20:00'},date('2026-09-17T10:00:00')),null);
});
test('quiet or disabled reminders remain persisted and deduped until allowed',()=>{
  const state=base();state.tasks=[{id:'a',reminderActive:true,reminderMode:'interval',reminderMinutes:30,nextReminderAt:'2026-09-17T13:30:00'}];state.preferences.remindersEnabled=false;
  for(const time of ['2026-09-17T13:30:00','2026-09-17T14:00:00','2026-09-17T14:35:00'])for(const reminder of runtime.collectDue(state,+date(time)))runtime.enqueue(state,reminder);
  assert.equal(state.pendingReminders.length,1);assert.equal(runtime.pickNext(state,+date('2026-09-17T14:35:00')),null);
  state.preferences.remindersEnabled=true;const pending=runtime.pickNext(state,+date('2026-09-17T14:35:00'));assert.ok(pending);
  runtime.acknowledge(state,pending.key,'dismiss',null,+date('2026-09-17T14:35:00'));
  assert.equal(new Date(state.tasks[0].nextReminderAt).getMinutes(),5);assert.equal(state.reminderHistory.length,1);
});
test('store saves atomically, exports valid backups, refuses corruption and explicit restore keeps original',()=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'diary-storage-test-'));
  try{
    const file=path.join(folder,'done-data.json'),store=new StateStore(file,path.join(folder,'missing.json'));
    store.save(diary.migrate({tasks:[{id:'a',title:'task'}]}));const name=store.backup();assert.equal(store.fromBackup(name).tasks[0].id,'a');
    fs.writeFileSync(file,'BROKEN');const restart=new StateStore(file,path.join(folder,'missing.json'));
    assert.equal(restart.load(),null);assert.equal(restart.readOnly,true);assert.throws(()=>restart.save({tasks:[]}));assert.equal(fs.readFileSync(file,'utf8'),'BROKEN');
    assert.throws(()=>restart.fromBackup('../done-data.json'));
    restart.replace(restart.fromBackup(name));assert.equal(restart.readOnly,false);assert.ok(fs.readdirSync(path.join(folder,'backups')).some(n=>n.startsWith('unreadable-')));
  }finally{fs.rmSync(folder,{recursive:true,force:true});}
});
test('acknowledged advance alert schedules the due-time alert, unhandled advance alert remains one',()=>{
  const state=base();state.tasks=[{id:'a',title:'会议',dueAt:'2026-09-17T14:30:00',reminderMode:'event',reminderActive:true,nextReminderAt:'2026-09-17T14:20:00'}];
  const before=+date('2026-09-17T14:20:00');for(const r of runtime.collectDue(state,before))runtime.enqueue(state,r);
  assert.equal(state.pendingReminders[0].eventPhase,'before');assert.equal(runtime.collectDue(state,+date('2026-09-17T14:35:00')).length,0);
  runtime.acknowledge(state,state.pendingReminders[0].key,'dismiss',null,before+60000);
  assert.equal(state.tasks[0].nextReminderAt,state.tasks[0].dueAt);
  for(const r of runtime.collectDue(state,+date('2026-09-17T14:30:00')))runtime.enqueue(state,r);
  assert.equal(state.pendingReminders.length,1);assert.equal(state.pendingReminders[0].eventPhase,'due');
});
