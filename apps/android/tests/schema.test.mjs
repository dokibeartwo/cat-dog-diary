import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

test('Android package declares Expo, Supabase, SQLite and notifications', () => {
  const pkg = JSON.parse(read('package.json'));
  for (const name of ['expo', '@supabase/supabase-js', 'expo-sqlite', 'expo-notifications']) assert.ok(pkg.dependencies[name]);
  assert.ok(pkg.dependencies['expo-secure-store']);
  assert.equal(pkg.scripts.test, 'node --test tests/*.test.mjs');
});

test('Android client is local-first and does not ship demo task data or fake login success', () => {
  const app = read('App.tsx');
  const db = read('src/services/local-db.ts');
  assert.match(db, /CREATE TABLE IF NOT EXISTS entities/);
  assert.match(db, /CREATE TABLE IF NOT EXISTS mutations/);
  assert.match(db, /basePayload/);
  assert.match(db, /row\.entity_id/);
  assert.doesNotMatch(app, /丹丹|demo-1|整理今天最重要/);
  assert.match(read('src/services/auth.ts'), /尚未配置同步服务/);
  assert.match(read('src/services/supabase.ts'), /expo-secure-store/);
});

test('focus persists absolute end time and does not sync device notification fields', () => {
  const app = read('App.tsx');
  const db = read('src/services/local-db.ts');
  assert.match(app, /endsAt/);
  assert.match(app, /focus\.state/);
  assert.match(db, /nextReminderAt/);
  assert.match(db, /localNotificationId/);
});

test('sync schema includes soft delete, revision and idempotency fields', () => {
  const source = read('src/core/sync/types.ts');
  for (const field of ['entityId', 'entityType', 'updatedAt', 'deletedAt', 'revision', 'deviceId', 'lastMutationId', 'mutationId', 'baseRevision']) assert.match(source, new RegExp(field));
});

test('all six approved themes and Android reminder permissions are present', () => {
  const tokens = read('src/theme/tokens.ts');
  for (const id of ['bg1', 'bg2', 'bg3', 'bg4', 'bg5', 'bg6']) assert.match(tokens, new RegExp(`\\b${id}\\b`));
  const config = read('app.json');
  for (const permission of ['POST_NOTIFICATIONS', 'VIBRATE', 'SCHEDULE_EXACT_ALARM', 'USE_FULL_SCREEN_INTENT']) assert.match(config, new RegExp(permission));
});

test('real Supabase keys are never committed in the Android source', () => {
  const env = read('.env.example');
  assert.match(env, /your-publishable-key/);
  assert.doesNotMatch(env, /eyJ[A-Za-z0-9_-]{20,}/);
});
