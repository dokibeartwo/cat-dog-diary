import * as SQLite from 'expo-sqlite';
import type { LocalStore, SyncCursor, SyncEntity, SyncEntityType, SyncMutation } from '../core/sync/types';

export type TaskRecord = { id: string; title: string; due?: string; dueAt?: string; done: boolean; notes?: string; updatedAt: string; nextReminderAt?: string | null; localNotificationId?: string | null; [key: string]: unknown };
export type LocalTask = TaskRecord;
const db = SQLite.openDatabaseSync('cat-dog-diary.db');
let initialized = false;

function init(): void {
  if (initialized) return;
  db.execSync(`PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS entities (account_id TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, payload TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL, deleted_at TEXT, device_id TEXT NOT NULL, last_mutation_id TEXT, PRIMARY KEY(account_id, entity_type, entity_id));
    CREATE TABLE IF NOT EXISTS mutations (mutation_id TEXT PRIMARY KEY, account_id TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, operation TEXT NOT NULL, patch TEXT NOT NULL, basePayload TEXT NOT NULL, baseRevision INTEGER NOT NULL, device_id TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS metadata (account_id TEXT PRIMARY KEY, cursor_updated_at TEXT, cursor_entity TEXT, device_id TEXT NOT NULL);`);
    db.execSync('CREATE TABLE IF NOT EXISTS local_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);');
  initialized = true;
}

const now = () => new Date().toISOString();
const json = (value: unknown) => JSON.stringify(value ?? {});
function sanitizeTask(task: LocalTask): Record<string, unknown> {
  const { nextReminderAt: _nextReminderAt, localNotificationId: _localNotificationId, ...durable } = task;
  return durable;
}

export async function loadTasks(accountId = 'local'): Promise<LocalTask[]> {
  init();
  const rows = db.getAllSync<{ payload: string; entity_id: string }>('SELECT payload, entity_id FROM entities WHERE account_id = ? AND entity_type = ? AND deleted_at IS NULL ORDER BY updated_at DESC', [accountId, 'task']);
  // The sync payload deliberately omits the transport id. Re-attach the
  // SQLite primary key for the UI so toggling/editing a task never targets an
  // undefined id after a reload.
  return rows.map((row) => ({ ...JSON.parse(row.payload), id: row.entity_id }) as LocalTask);
}

export function getDeviceId(): string {
  init(); const row = db.getFirstSync<{ value: string }>('SELECT value FROM local_meta WHERE key = ?', ['device.id']);
  if (row?.value) return row.value;
  const id = `android-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  db.runSync('INSERT INTO local_meta(key,value) VALUES (?,?)', ['device.id', id]); return id;
}
export function getMeta<T>(key: string, fallback: T): T { init(); const row = db.getFirstSync<{ value: string }>('SELECT value FROM local_meta WHERE key = ?', [key]); if (!row) return fallback; try { return JSON.parse(row.value) as T; } catch { return fallback; } }
export function setMeta<T>(key: string, value: T): void { init(); db.runSync('INSERT OR REPLACE INTO local_meta(key,value) VALUES (?,?)', [key, JSON.stringify(value)]); }
export async function listTasks(accountId = 'local'): Promise<TaskRecord[]> { return loadTasks(accountId); }
export async function listHabits(accountId = 'local'): Promise<Record<string, unknown>[]> { init(); const rows = db.getAllSync<{ payload: string; entity_id: string }>('SELECT payload, entity_id FROM entities WHERE account_id = ? AND entity_type = ? AND deleted_at IS NULL ORDER BY updated_at DESC', [accountId, 'habit']); return rows.map((row) => ({ ...JSON.parse(row.payload), id: row.entity_id }) as Record<string, unknown>); }

export async function saveEntity(entityType: SyncEntityType, value: Record<string, unknown>, accountId = 'local', deviceId = getDeviceId()): Promise<void> {
  init(); const id = entityType === 'preference' ? 'account' : String(value.id ?? `${entityType}-${Date.now()}`); const updatedAt = now();
  const payload = entityType === 'task' ? sanitizeTask(value as LocalTask) : { ...value }; delete payload.id;
  const old = db.getFirstSync<{ payload: string; revision: number }>('SELECT payload, revision FROM entities WHERE account_id = ? AND entity_type = ? AND entity_id = ?', [accountId, entityType, id]); const mutationId = `${deviceId}:${Date.now()}:${entityType}:${id}`;
  db.runSync('INSERT OR REPLACE INTO entities(account_id,entity_type,entity_id,payload,revision,updated_at,deleted_at,device_id,last_mutation_id) VALUES (?,?,?,?,?,?,?,?,?)', [accountId, entityType, id, json(payload), old?.revision ?? 0, updatedAt, null, deviceId, mutationId]);
  db.runSync('INSERT OR REPLACE INTO mutations(mutation_id,account_id,entity_type,entity_id,operation,patch,basePayload,baseRevision,device_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)', [mutationId, accountId, entityType, id, 'upsert', json(payload), old?.payload ?? '{}', old?.revision ?? 0, deviceId, updatedAt]);
}

export async function saveTask(task: LocalTask, accountId = 'local', deviceId = 'android-local'): Promise<void> {
  init();
  const updatedAt = now();
  const payload = { ...sanitizeTask(task), updatedAt };
  const old = db.getFirstSync<{ payload: string; revision: number }>('SELECT payload, revision FROM entities WHERE account_id = ? AND entity_type = ? AND entity_id = ?', [accountId, 'task', task.id]);
  const mutationId = `${deviceId}:${Date.now()}:${task.id}`;
  db.runSync('INSERT OR REPLACE INTO entities(account_id,entity_type,entity_id,payload,revision,updated_at,deleted_at,device_id,last_mutation_id) VALUES (?,?,?,?,?,?,?,?,?)', [accountId, 'task', task.id, json(payload), old?.revision ?? 0, updatedAt, null, deviceId, mutationId]);
  db.runSync('INSERT OR REPLACE INTO mutations(mutation_id,account_id,entity_type,entity_id,operation,patch,basePayload,baseRevision,device_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)', [mutationId, accountId, 'task', task.id, 'upsert', json(payload), old?.payload ?? '{}', old?.revision ?? 0, deviceId, updatedAt]);
}

export async function deleteTask(id: string, accountId = 'local', deviceId = 'android-local'): Promise<void> {
  init();
  const old = db.getFirstSync<{ payload: string; revision: number }>('SELECT payload, revision FROM entities WHERE account_id = ? AND entity_type = ? AND entity_id = ?', [accountId, 'task', id]);
  const timestamp = now(); const mutationId = `${deviceId}:${Date.now()}:delete:${id}`;
  db.runSync('UPDATE entities SET deleted_at = ?, updated_at = ?, device_id = ?, last_mutation_id = ? WHERE account_id = ? AND entity_type = ? AND entity_id = ?', [timestamp, timestamp, deviceId, mutationId, accountId, 'task', id]);
  db.runSync('INSERT OR REPLACE INTO mutations(mutation_id,account_id,entity_type,entity_id,operation,patch,basePayload,baseRevision,device_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)', [mutationId, accountId, 'task', id, 'delete', '{}', old?.payload ?? '{}', old?.revision ?? 0, deviceId, timestamp]);
}

export class SqliteStore implements LocalStore {
  constructor(private readonly accountId: string, private readonly deviceId: string) { init(); }
  async listEntities<T>(entityType: SyncEntityType): Promise<SyncEntity<T>[]> {
    const rows = db.getAllSync<any>('SELECT * FROM entities WHERE account_id = ? AND entity_type = ?', [this.accountId, entityType]);
    return rows.map((row) => ({ ...JSON.parse(row.payload), entityId: row.entity_id, entityType: row.entity_type, payload: JSON.parse(row.payload), updatedAt: row.updated_at, deletedAt: row.deleted_at, revision: row.revision, deviceId: row.device_id, lastMutationId: row.last_mutation_id } as SyncEntity<T>));
  }
  async getEntity<T>(entityType: SyncEntityType, entityId: string): Promise<SyncEntity<T> | null> { return (await this.listEntities<T>(entityType)).find((item) => item.entityId === entityId) ?? null; }
  async applyEntity<T>(entity: SyncEntity<T>): Promise<void> { db.runSync('INSERT OR REPLACE INTO entities(account_id,entity_type,entity_id,payload,revision,updated_at,deleted_at,device_id,last_mutation_id) VALUES (?,?,?,?,?,?,?,?,?)', [this.accountId, entity.entityType, entity.entityId, json(entity.payload), entity.revision, entity.updatedAt, entity.deletedAt, entity.deviceId, entity.lastMutationId]); }
  async enqueueMutation(mutation: SyncMutation): Promise<void> { db.runSync('INSERT OR REPLACE INTO mutations(mutation_id,account_id,entity_type,entity_id,operation,patch,basePayload,baseRevision,device_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)', [mutation.mutationId, this.accountId, mutation.entityType, mutation.entityId, mutation.operation, json(mutation.patch), json(mutation.basePayload ?? {}), mutation.baseRevision, mutation.deviceId, mutation.createdAt]); }
  async listPendingMutations(): Promise<SyncMutation[]> { const rows = db.getAllSync<any>('SELECT * FROM mutations WHERE account_id = ? ORDER BY created_at', [this.accountId]); return rows.map((row) => ({ mutationId: row.mutation_id, accountId: this.accountId, entityType: row.entity_type, entityId: row.entity_id, operation: row.operation, patch: JSON.parse(row.patch), basePayload: JSON.parse(row.basePayload), baseRevision: row.baseRevision, deviceId: row.device_id, createdAt: row.created_at } as SyncMutation)); }
  async removeMutations(ids: string[]): Promise<void> { for (const id of ids) db.runSync('DELETE FROM mutations WHERE mutation_id = ?', [id]); }
  async getCursor(): Promise<SyncCursor> { const row = db.getFirstSync<any>('SELECT cursor_updated_at, cursor_entity FROM metadata WHERE account_id = ?', [this.accountId]); return row?.cursor_updated_at ? { updatedAt: row.cursor_updated_at, entityId: row.cursor_entity ?? '' } : null; }
  async setCursor(cursor: SyncCursor): Promise<void> { db.runSync('INSERT OR REPLACE INTO metadata(account_id,cursor_updated_at,cursor_entity,device_id) VALUES (?,?,?,?)', [this.accountId, cursor?.updatedAt ?? null, cursor?.entityId ?? '', this.deviceId]); }
}

export const localStore = new SqliteStore('local', getDeviceId());
