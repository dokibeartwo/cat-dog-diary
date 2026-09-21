'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../packages/core');

const now = new Date('2026-09-21T10:00:00.000Z');
const rawV1 = {
  schemaVersion: 1,
  tasks: [{ id: 'task-a', title: '整理资料', notes: '电脑', dueAt: '2026-09-21T11:00:00.000Z',
    seriesId: 'series-a', recurrence: { kind: 'daily' }, completed: false }],
  habits: [{ id: 'habit-a', title: '喝水', active: true, scheduleType: 'daily', time: '08:00' }],
  preferences: { themeId: 'bg5' },
  stagePlan: { start: '2026-09-21', end: '2026-09-30', dailyCapacity: 3 },
  focusHistory: []
};

test('v1 migration creates account-scoped v2 entities and projects back losslessly', () => {
  const before = structuredClone(rawV1);
  const snapshot = core.migrateV1ToV2(rawV1, { accountId: 'user-1', deviceId: 'windows-1', now });
  assert.deepEqual(rawV1, before);
  assert.equal(snapshot.schemaVersion, 2);
  assert.equal(snapshot.entities.find(e => e.entityType === 'task').payload.title, '整理资料');
  assert.equal(snapshot.entities.find(e => e.entityType === 'preference').payload.themeId, 'bg5');
  const projected = core.projectV2ToV1(snapshot);
  assert.equal(projected.tasks[0].id, 'task-a');
  assert.equal(projected.tasks[0].title, '整理资料');
  assert.equal(projected.preferences.themeId, 'bg5');
  assert.equal(projected.stagePlan.start, '2026-09-21');
});

test('mutation IDs are idempotent and duplicate content cannot be reused', () => {
  const server = new core.InMemorySyncServer({ now: () => now });
  const a = new core.SyncEngine({ accountId: 'user-1', deviceId: 'device-a', server, now: () => now });
  a.localUpsert('task', 't1', { title: '一次' }, { mutationId: 'm-1' });
  assert.equal(a.sync().pushed, 1);
  assert.equal(a.sync().pushed, 0);
  const b = new core.SyncEngine({ accountId: 'user-1', deviceId: 'device-b', server, now: () => now });
  assert.equal(b.localUpsert('task', 't1', { title: '恶意复用' }, { mutationId: 'm-1' }).mutation.mutationId, 'm-1');
  assert.throws(() => b.sync(), /编号重复但内容不同/);
});

test('pull cursor advances monotonically and rejects rollback or invalid future cursors', () => {
  const server = new core.InMemorySyncServer({ now: () => now });
  const a = new core.SyncEngine({ accountId: 'user-1', deviceId: 'device-a', server, now: () => now });
  a.localUpsert('task', 't1', { title: '一' }, { mutationId: 'm-1' });
  const first = a.sync();
  assert.equal(first.cursor, 1);
  assert.equal(server.pull('user-1', 1).changes.length, 0);
  assert.throws(() => a.store.setCursor(0), /只能向前移动/);
  assert.throws(() => server.pull('user-1', 99), /无效的同步游标/);
});

test('deleting an entity is a soft delete and cannot be resurrected by a stale upsert', () => {
  const server = new core.InMemorySyncServer({ now: () => now });
  const a = new core.SyncEngine({ accountId: 'user-1', deviceId: 'device-a', server, now: () => now });
  a.localUpsert('task', 't1', { title: '待删' }, { mutationId: 'm-1' }); a.sync();
  const stale = new core.SyncEngine({ accountId: 'user-1', deviceId: 'device-b', server, now: () => now });
  stale.sync();
  a.localDelete('task', 't1', { mutationId: 'm-2' }); a.sync();
  stale.localUpsert('task', 't1', { title: '旧设备修改' }, { mutationId: 'm-3' });
  const result = stale.sync();
  assert.equal(result.conflicts, 1);
  assert.equal(stale.store.pendingMutations().length, 0);
  assert.equal(server.pull('user-1', 0).changes.at(-1).entity.deletedAt !== null, true);
});

test('independent fields merge while same-field edits create a conflict record', () => {
  const server = new core.InMemorySyncServer({ now: () => now });
  const a = new core.SyncEngine({ accountId: 'user-1', deviceId: 'device-a', server, now: () => now });
  const b = new core.SyncEngine({ accountId: 'user-1', deviceId: 'device-b', server, now: () => now });
  a.localUpsert('task', 't1', { title: '原始', notes: '旧备注' }, { mutationId: 'm-1' }); a.sync(); b.sync();
  a.localUpsert('task', 't1', { title: '新标题' }, { mutationId: 'm-2' });
  b.localUpsert('task', 't1', { notes: '新备注' }, { mutationId: 'm-3' });
  a.sync();
  const merged = b.sync();
  assert.equal(merged.conflicts, 0);
  assert.equal(server.account('user-1').entities.get('user-1|task|t1').payload.notes, '新备注');
  a.sync();
  a.localUpsert('task', 't1', { title: '设备 A 标题' }, { mutationId: 'm-4' });
  b.localUpsert('task', 't1', { title: '设备 B 标题' }, { mutationId: 'm-5' });
  a.sync();
  const conflict = b.sync();
  assert.equal(conflict.conflicts, 1);
  assert.equal(b.store.listConflicts()[0].fields.includes('title'), true);
});

test('occurrence keys keep recurring tasks unique across devices', () => {
  const one = { id: 'task-1', seriesId: 'series-1', dueAt: '2026-09-21T09:00:00.000Z' };
  const two = { id: 'task-2', seriesId: 'series-1', dueAt: '2026-09-21T09:00:00.000Z' };
  assert.equal(core.occurrenceKey(one), core.occurrenceKey(two));
  assert.notEqual(core.occurrenceKey(one), core.occurrenceKey({ ...one, dueAt: '2026-09-22T09:00:00.000Z' }));
});

test('account isolation prevents cross-account reads, writes, and pulls', () => {
  const server = new core.InMemorySyncServer({ now: () => now });
  const a = new core.SyncEngine({ accountId: 'user-a', deviceId: 'device-a', server, now: () => now });
  const b = new core.SyncEngine({ accountId: 'user-b', deviceId: 'device-b', server, now: () => now });
  a.localUpsert('task', 'same-id', { title: '只属于 A' }, { mutationId: 'a-1' }); a.sync();
  b.sync();
  assert.equal(b.store.getEntity('task', 'same-id'), null);
  const foreign = core.makeMutation({ accountId: 'user-a', deviceId: 'device-a', mutationId: 'foreign-1',
    entityType: 'task', entityId: 'same-id', patch: { title: '越权' }, createdAt: now });
  assert.throws(() => server.push('user-b', [foreign]), /账号隔离/);
});

test('projection uses the canonical allowlist and keeps runtime fields local', () => {
  const state = {
    tasks: [{ id: 't', title: '任务', nextReminderAt: 'local', reminderFiredForDueAt: 'local',
      deadlineLastRemindedDate: 'local', steps: [{ id: 's', title: '步骤', completed: false }] }],
    habits: [{ id: 'h', title: '习惯', nextReminderAt: 'local', completionCount: 8, lastCompletedAt: 'local' }],
    stagePlan: { start: '2026-09-21' }, preferences: { themeId: 'bg5', widgetVisible: true }
  };
  const projected = core.projectState(state);
  assert.deepEqual(projected.get('task|t').payload, { title: '任务' });
  assert.equal(projected.get('step|s').payload.taskId, 't');
  assert.equal(projected.get('habit|h').payload.completionCount, undefined);
  assert.equal(projected.get('preference|account').payload.widgetVisible, undefined);
  const merged = core.applyEntities({ ...structuredClone(state), preferences: { ...state.preferences } }, projected);
  assert.equal(merged.tasks[0].nextReminderAt, 'local');
  assert.equal(merged.habits[0].completionCount, 8);
  assert.equal(merged.preferences.widgetVisible, true);
});

test('recurring occurrence ids are deterministic across devices', () => {
  const a = { id: 'a', seriesId: 'series', dueAt: '2026-09-21T09:00:00.000Z' };
  const b = { id: 'other-id', seriesId: 'series', dueAt: '2026-09-21T09:00:00.000Z' };
  assert.equal(core.occurrenceId(a), core.occurrenceId(b));
  assert.notEqual(core.occurrenceId(a), core.occurrenceId({ ...a, dueAt: '2026-09-22T09:00:00.000Z' }));
});
