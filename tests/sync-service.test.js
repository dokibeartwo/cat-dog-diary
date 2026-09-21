const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SyncService, projectState, applyEntities } = require('../src/sync-service');

function tempFile() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cat-dog-sync-')); return path.join(dir, 'sync-state.json'); }
function response(value, ok = true) { return { ok, status: ok ? 200 : 400, text: async () => JSON.stringify(value) }; }

test('sync service coalesces offline edits and keeps machine preferences local', () => {
  const service = new SyncService(tempFile(), { env: {} });
  service.meta.currentAccountId = 'account-a'; service.account(); service.meta.session = { accessToken: 'a', email: 'a@example.com' };
  const before = { tasks: [], habits: [], stagePlan: {}, focusHistory: [], preferences: { themeId: 'bg1', widgetVisible: true, soundEnabled: true } };
  const first = { ...before, tasks: [{ id: 't1', title: '第一版', notes: '' }] };
  const second = { ...first, tasks: [{ id: 't1', title: '最终版', notes: '备注' }] };
  service.capture(before, first); service.capture(first, second);
  const account = service.account();
  assert.equal(account.outbox.length, 1);
  assert.equal(account.outbox[0].patch.title, '最终版');
  assert.equal(projectState(second).get('preference|account').payload.widgetVisible, undefined);
});

test('sync service uses RPC, removes acknowledged mutations, and applies pulled entities', async () => {
  const calls = [];
  const service = new SyncService(tempFile(), { env: {} , fetchImpl: async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    if (url.endsWith('/auth/v1/verify')) return response({ access_token: 'access', refresh_token: 'refresh', user: { id: 'user-a', email: 'a@example.com' } });
    if (url.endsWith('/rpc/push_mutations')) return response([{ mutationId: 'm1', status: 'applied', revision: 1 }]);
    if (url.endsWith('/rpc/pull_changes')) return response({ items: [{ entityType: 'task', entityId: 'remote', payload: { title: '云端任务' }, revision: 1, updatedAt: new Date().toISOString(), deletedAt: null }], nextCursor: null, hasMore: false });
    throw new Error(`unexpected ${url}`);
  }});
  service.configure({ url: 'https://project.supabase.co', publishableKey: 'publishable-key-123' });
  await service.verifyOtp('a@example.com', '123456');
  service.account().outbox.push({ mutationId: 'm1', entityType: 'task', entityId: 'local', operation: 'upsert', patch: { title: '本地' }, basePayload: {}, baseRevision: 0, deviceId: service.meta.deviceId, createdAt: new Date().toISOString() });
  const result = await service.sync();
  assert.equal(result.pushed, 1); assert.equal(result.pulled.length, 1); assert.equal(service.account().outbox.length, 0);
  assert.equal(calls.some(call => call.url.endsWith('/rpc/push_mutations')), true);
  assert.equal(calls.some(call => call.url.endsWith('/rpc/pull_changes')), true);
  const merged = applyEntities({ tasks: [], habits: [], stagePlan: {}, focusHistory: [], preferences: {} }, result.pulled);
  assert.equal(merged.tasks[0].title, '云端任务');
});

test('sync service lists open conflicts and resolves a selected field', async () => {
  const calls = [];
  const service = new SyncService(tempFile(), { env: {}, fetchImpl: async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith('/auth/v1/verify')) return response({ access_token: 'access', refresh_token: 'refresh', user: { id: 'user-a', email: 'a@example.com' } });
    if (url.includes('/rest/v1/sync_conflicts')) return response([{ conflict_id: 'c1', entity_type: 'task', entity_id: 't1', conflict_fields: ['title'], local_patch: { title: '本机' }, remote_payload: { title: '云端' } }]);
    if (url.endsWith('/rpc/resolve_conflict')) return response({ resolved: true, revision: 3 });
    throw new Error(`unexpected ${url}`);
  }});
  service.configure({ url: 'https://project.supabase.co', publishableKey: 'publishable-key-123' });
  await service.verifyOtp('a@example.com', '123456');
  service.account().conflicts = [{ conflictId: 'c1' }];
  const conflicts = await service.listConflicts();
  assert.equal(conflicts[0].conflict_id, 'c1');
  const result = await service.resolveConflict('c1', { title: '本机' });
  assert.equal(result.resolved, true);
  assert.equal(service.account().conflicts.length, 0);
  assert.equal(calls.some(call => call.url.endsWith('/rpc/resolve_conflict')), true);
});
