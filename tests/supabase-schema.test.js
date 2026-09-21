const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migration = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20260921000000_sync.sql'), 'utf8');

test('Supabase migration contains the private sync schema and RPC surface', () => {
  for (const table of ['profiles', 'sync_entities', 'sync_mutations', 'sync_conflicts', 'habit_events', 'device_sessions']) {
    assert.match(migration, new RegExp(`create table if not exists public\\.${table}\\b`, 'i'), `${table} table`);
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`, 'i'), `${table} RLS`);
  }
  for (const fn of ['push_mutations', 'pull_changes', 'resolve_conflict', 'ack_sync_cursor', 'record_habit_event', 'acquire_focus_lease', 'release_focus_lease', 'delete_account']) {
    assert.match(migration, new RegExp(`create or replace function public\\.${fn}\\b`, 'i'), `${fn} RPC`);
    assert.match(migration, new RegExp(`grant execute on function public\\.${fn}`, 'i'), `${fn} grant`);
  }
  assert.match(migration, /base_payload jsonb/i);
  assert.match(migration, /mutation_hash text/i);
  assert.match(migration, /operation in \('upsert', 'restore', 'delete'\)/i);
  assert.match(migration, /pg_advisory_xact_lock/i);
});

test('Supabase migration has no private credentials or anonymous write grants', () => {
  assert.doesNotMatch(migration, /(service[_-]?role\s*[:=]|eyJ[a-zA-Z0-9_-]{20,}|supabase_password\s*[:=]|postgresql:\/\/)/i);
  assert.match(migration, /revoke insert, update, delete on public\.sync_entities/i);
  assert.match(migration, /using \(user_id = auth\.uid\(\)\)/i);
  assert.match(migration, /to authenticated/i);
  assert.doesNotMatch(migration, /to anon[\s\S]{0,80}(insert|update|delete)/i);
});
