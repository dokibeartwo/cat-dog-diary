const test = require('node:test');
const assert = require('node:assert/strict');
const p = require('../src/shared/productivity');
const d = require('../src/shared/domain');
const r = require('../src/shared/runtime');
const time = (text) => new Date(text).getTime();
const today = time('2026-09-09T00:00:00');
const tomorrow = time('2026-09-10T00:00:00');
function state() { return { focusTimer:r.normalizeFocus(), focusHistory:[], tasks:[], habits:[], pendingReminders:[] }; }
function start(s, now, task = { id:'a', title:'实验' }) { r.updateFocus(s.focusTimer, {action:'start'}, now); p.beginTracking(s.focusTimer, task, now, true); }

test('task focus records precise invested time, not the whole preset duration on early stop', () => {
  const s = state(); start(s, today);
  p.recordSession(s, 'interrupted', today + 300000); r.updateFocus(s.focusTimer, {action:'stop'}, today + 300000);
  assert.equal(s.focusHistory[0].taskId, 'a'); assert.equal(s.focusHistory[0].durationSeconds, 300);
  assert.equal(s.focusTimer.sessionsCompleted, 0);
  assert.deepEqual(p.summarize(s.focusHistory, s.focusTimer, today, tomorrow), {seconds:300, rounds:0});
});
test('pause gaps are not counted; resume is same round and completion does not double count', () => {
  const s = state(); start(s, today);
  p.closeSegment(s.focusTimer, today+300000); r.updateFocus(s.focusTimer,{action:'pause'},today+300000);
  assert.equal(p.summarize([],s.focusTimer,today,tomorrow,today+900000).seconds,300);
  r.updateFocus(s.focusTimer,{action:'start'},today+1200000); p.beginTracking(s.focusTimer,null,today+1200000,false);
  const finish = r.finishFocus(s, today+2400000);
  assert.ok(finish); assert.equal(s.focusHistory[0].durationSeconds,1500);
  assert.equal(s.focusHistory[0].taskTitle,'实验');
  assert.equal(r.finishFocus(s,today+2500000),null);
  assert.deepEqual(p.summarize(s.focusHistory,s.focusTimer,today,tomorrow),{seconds:1500,rounds:1});
});
test('midnight splits time into the correct days, round belongs to completion day', () => {
  const s = state(); const begin=today-600000; start(s,begin);
  r.finishFocus(s,today+900000);
  assert.deepEqual(p.summarize(s.focusHistory,s.focusTimer,today-86400000,today),{seconds:600,rounds:0});
  assert.deepEqual(p.summarize(s.focusHistory,s.focusTimer,today,tomorrow),{seconds:900,rounds:1});
});
test('sleep or late tick is capped at the timer end and current live totals work', () => {
  const s=state(); start(s,today);
  assert.equal(p.summarize([],s.focusTimer,today,tomorrow,today+120000).seconds,120);
  r.finishFocus(s,today+10000000);
  assert.equal(s.focusHistory[0].durationSeconds,1500);
  assert.equal(s.focusHistory[0].endedAt,new Date(today+1500000).toISOString());
});
test('tracking and history survive restart, session IDs prevent duplicate records', () => {
  const s=state(); start(s,today);
  s.focusTimer=r.normalizeFocus(JSON.parse(JSON.stringify(s.focusTimer)));
  p.recordSession(s,'interrupted',today+120000);
  assert.equal(p.recordSession(s,'interrupted',today+120000),false);
  const history=p.normalizeHistory(JSON.parse(JSON.stringify([...s.focusHistory,...s.focusHistory])));
  assert.equal(history.length,1); assert.equal(history[0].durationSeconds,120);
});
test('legacy rounds are not assigned invented time, breaks are excluded', () => {
  const s=state(); s.focusTimer=r.normalizeFocus({status:'running',endsAt:new Date(today+1500000).toISOString(),sessionsCompleted:12});
  r.finishFocus(s,today+1500000); assert.equal(s.focusHistory.length,0); assert.equal(s.focusTimer.sessionsCompleted,13);
  r.updateFocus(s.focusTimer,{action:'select',mode:'shortBreak'}); start(s,today);
  r.finishFocus(s,today+300000); assert.equal(s.focusHistory.length,0);
});
test('substeps normalize, reject duplicate IDs and are searchable without changing parent state', () => {
  const task={title:'跑实验',notes:'baseline',steps:p.normalizeSteps([{id:'a',title:'准备数据'},{id:'a',title:'重复'},{id:'b',title:'运行代码',completed:true}])};
  assert.equal(task.steps.length,2); assert.equal(p.matchesSearch(task,'BASELINE 代码'),true);
  assert.equal(p.matchesSearch(task,'准备 不存在'),false); assert.equal(task.completed,undefined);
});
test('earlier unfinished tasks stay in today without changing original schedule', () => {
  const task={id:'a',dueAt:'2026-09-01T10:00:00',completed:false};
  assert.equal(d.isCarryoverTask(task,new Date(today)),true); assert.equal(d.isTaskInView(task,'today',null,new Date(today)),true);
  assert.equal(task.dueAt,'2026-09-01T10:00:00');
  task.completed=true; task.completedAt='2026-09-09T09:00:00';
  assert.equal(d.isCarryoverTask(task,new Date(today)),false); assert.equal(d.isTaskInView(task,'today',null,new Date(today)),true);
  assert.equal(d.isTaskInView(task,'today',null,new Date(tomorrow)),false);
});
test('focus task completion stops timing, saves partial effort and completes all substeps', () => {
  const s=state(); start(s,today);
  s.tasks=[{id:'a',steps:[{id:'s',title:'一步',completed:false}]}];
  s.pendingReminders=[{key:'x',type:'deadline',taskId:'a'}];
  r.acknowledge(s,'x','complete',null,today+60000);
  assert.equal(s.focusTimer.status,'idle'); assert.equal(s.focusHistory[0].durationSeconds,60);
  assert.equal(s.tasks[0].steps[0].completed,true);
});
