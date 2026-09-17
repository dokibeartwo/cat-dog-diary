const test = require('node:test');
const assert = require('node:assert/strict');
const runtime = require('../src/shared/runtime');
const domain = require('../src/shared/domain');
const at = (time) => new Date(`2026-09-08T${time}:00`).getTime();
function fixture() {
  return {
    tasks: [{ id: 'a', title: '实验', reminderMode: 'interval', reminderMinutes: 30, reminderActive: true, nextReminderAt: new Date(at('13:30')).toISOString() }],
    habits: [], pendingReminders: [], presence: { active: false }, focusTimer: runtime.normalizeFocus()
  };
}
function collect(state, now) { for (const item of runtime.collectDue(state, now)) runtime.enqueue(state, item); }

test('13:30 reminder waits until 14:35 acknowledgement then next reminder is 15:05', () => {
  const state = fixture();
  collect(state, at('13:30'));
  const first = structuredClone(state.pendingReminders[0]);
  for (let now = at('13:31'); now <= at('14:35'); now += 60000) collect(state, now);
  assert.deepEqual(state.pendingReminders, [first]);
  assert.equal(state.tasks[0].nextReminderAt, null);
  runtime.acknowledge(state, first.key, 'dismiss', null, at('14:35'));
  assert.equal(state.tasks[0].nextReminderAt, new Date(at('15:05')).toISOString());
  collect(state, at('15:04')); assert.equal(state.pendingReminders.length, 0);
  collect(state, at('15:05')); assert.equal(state.pendingReminders.length, 1);
});
test('away queue keeps one item per source and preserves distinct sources', () => {
  const state = fixture();
  state.presence.active = true;
  state.tasks.push({ ...state.tasks[0], id: 'b' });
  collect(state, at('13:30')); collect(state, at('15:30'));
  assert.equal(state.pendingReminders.length, 2);
  assert.equal(runtime.pickNext(state, at('15:30')), null);
  state.presence.active = false;
  assert.equal(runtime.pickNext(state, at('15:30')).taskId, 'a');
});
test('focus and paused focus defer gentle reminders, events and deadlines interrupt', () => {
  const state = fixture();
  collect(state, at('13:30'));
  runtime.updateFocus(state.focusTimer, { action: 'start' }, at('13:30'));
  assert.equal(runtime.pickNext(state), null);
  runtime.updateFocus(state.focusTimer, { action: 'pause' }, at('13:31'));
  assert.equal(runtime.pickNext(state), null);
  runtime.enqueue(state, { key: 'meeting', type: 'event', taskId: 'b' });
  assert.equal(runtime.pickNext(state).key, 'meeting');
  runtime.removeMatching(state, (item) => item.key === 'meeting');
  runtime.enqueue(state, { key: 'deadline', type: 'deadline', taskId: 'a' });
  assert.equal(runtime.pickNext(state).key, 'deadline');
  runtime.updateFocus(state.focusTimer, { action: 'stop' });
  runtime.removeMatching(state, (item) => item.key === 'deadline');
  assert.equal(runtime.pickNext(state).taskId, 'a');
});
test('completion first, then waiting reminders; short breaks do not defer reminders', () => {
  const state = fixture(); collect(state, at('13:30'));
  runtime.updateFocus(state.focusTimer, { action: 'start' }, at('13:30'));
  runtime.enqueue(state, runtime.finishFocus(state, at('14:00')));
  const complete = runtime.pickNext(state, at('14:00'));
  assert.equal(complete.type, 'focus');
  runtime.acknowledge(state, complete.key, 'dismiss', null, at('14:00'));
  runtime.updateFocus(state.focusTimer, { action: 'select', mode: 'shortBreak' });
  runtime.updateFocus(state.focusTimer, { action: 'start' });
  assert.equal(runtime.pickNext(state).taskId, 'a');
});
test('snooze keeps one source, rotates interaction key, and cannot be dismissed by stale click', () => {
  const state = fixture(); collect(state, at('13:30'));
  const key = state.pendingReminders[0].key;
  runtime.acknowledge(state, key, 'snooze', 10, at('14:35'));
  assert.equal(runtime.acknowledge(state, key, 'complete'), false);
  collect(state, at('15:30'));
  assert.equal(state.pendingReminders.length, 1);
  assert.equal(runtime.pickNext(state, at('14:44')), null);
  assert.ok(runtime.pickNext(state, at('14:45')));
});
test('deadline snooze must not replace a task interval schedule', () => {
  const state = fixture();
  runtime.enqueue(state, { key: 'deadline', type: 'deadline', taskId: 'a' });
  runtime.acknowledge(state, 'deadline', 'snooze', 10, at('13:00'));
  assert.equal(state.tasks[0].nextReminderAt, new Date(at('13:30')).toISOString());
});
test('task completion removes all its notifications, but not another task', () => {
  const state = fixture(); collect(state, at('13:30'));
  runtime.enqueue(state, { key: 'deadline', type: 'deadline', taskId: 'a' });
  runtime.enqueue(state, { key: 'other', type: 'event', taskId: 'b' });
  runtime.acknowledge(state, state.pendingReminders[0].key, 'complete', null, at('14:00'));
  assert.equal(state.tasks[0].completed, true);
  assert.deepEqual(state.pendingReminders.map((item) => item.key), ['other']);
});
test('interval habit completion schedules from acknowledgement; daily habits keep clock time', () => {
  const state = fixture(); state.tasks = [];
  state.habits = [{ id: 'water', title: '喝水', active: true, scheduleType: 'interval', intervalMinutes: 30, nextReminderAt: new Date(at('13:30')).toISOString() }];
  collect(state, at('13:30')); collect(state, at('15:30'));
  runtime.acknowledge(state, state.pendingReminders[0].key, 'complete', null, at('15:35'));
  assert.equal(state.habits[0].completionCount, 1);
  assert.equal(state.habits[0].nextReminderAt, new Date(at('16:05')).toISOString());
  state.habits[0].scheduleType = 'daily'; state.habits[0].time = '08:00';
  state.habits[0].nextReminderAt = new Date(at('08:00')).toISOString();
  collect(state, at('16:00'));
  runtime.acknowledge(state, state.pendingReminders[0].key, 'dismiss', null, at('16:00'));
  assert.equal(state.habits[0].nextReminderAt, new Date('2026-09-09T08:00:00').toISOString());
});
test('persisted queue restores with duplicate/deleted/paused items removed', () => {
  let state = fixture(); collect(state, at('13:30'));
  state.pendingReminders.push({ ...state.pendingReminders[0], key: 'duplicate' });
  state.pendingReminders.push({ key: 'missing', type: 'habit', habitId: 'deleted' });
  state = JSON.parse(JSON.stringify(state)); runtime.reconcile(state);
  assert.equal(state.pendingReminders.length, 1);
  collect(state, at('16:00')); assert.equal(state.pendingReminders.length, 1);
  state.tasks[0].reminderActive = false; runtime.reconcile(state);
  assert.equal(state.pendingReminders.length, 0);
});
test('focus pauses and resumes wall clock, restores, completes once, stale commands ignored', () => {
  const state = fixture();
  runtime.updateFocus(state.focusTimer, { action: 'start' }, at('13:00'));
  const session = state.focusTimer.sessionId;
  runtime.updateFocus(state.focusTimer, { action: 'pause' }, at('13:10'));
  assert.equal(state.focusTimer.pausedRemainingSeconds, 900);
  runtime.updateFocus(state.focusTimer, { action: 'start' }, at('14:00'));
  state.focusTimer = runtime.normalizeFocus(JSON.parse(JSON.stringify(state.focusTimer)));
  assert.equal(state.focusTimer.sessionId, session);
  assert.equal(runtime.finishFocus(state, at('14:14')), null);
  assert.ok(runtime.finishFocus(state, at('15:00')));
  assert.equal(runtime.finishFocus(state, at('15:01')), null);
  assert.equal(state.focusTimer.sessionsCompleted, 1);
  runtime.updateFocus(state.focusTimer, { action: 'start' }, at('15:02'));
  assert.equal(runtime.updateFocus(state.focusTimer, { action: 'stop', sessionId: session }), false);
  assert.equal(state.focusTimer.status, 'running');
});
test('paused zero remains zero, early stop does not count and changes cannot reset an active timer', () => {
  const state = fixture();
  runtime.updateFocus(state.focusTimer, { action: 'start' }, at('13:00'));
  assert.throws(() => runtime.updateFocus(state.focusTimer, { action: 'select', mode: 'longBreak' }));
  runtime.updateFocus(state.focusTimer, { action: 'pause' }, at('14:00'));
  assert.equal(domain.getFocusRemainingSeconds(state.focusTimer), 0);
  runtime.updateFocus(state.focusTimer, { action: 'stop' });
  assert.equal(state.focusTimer.sessionsCompleted, 0);
});
test('plan time is ready, not overdue, and late event reminder says current actual time', () => {
  const task = { dueAt: new Date(at('13:00')).toISOString() };
  assert.equal(domain.getTaskStatus(task, new Date(at('13:01'))), 'ready');
  assert.equal(runtime.eventSubtitle(task, at('13:01')), '已到计划时间');
  assert.equal(runtime.eventSubtitle(task, at('12:55')), '还有 5 分钟开始');
});
