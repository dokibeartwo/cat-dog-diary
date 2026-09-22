import * as SQLite from 'expo-sqlite';
import type { SyncEntity, SyncEntityType, SyncMutation } from '../core/sync/types';

const journal = require('../../../../packages/core/src/replica');
const projection = require('../../../../packages/core/src/projection');
export type Replica = { remote: Record<string, SyncEntity>; outbox: (SyncMutation & { attempted?: boolean })[]; conflicts: any[]; cursor: { updatedAt: string; entityId: string } | null; migrated: boolean; lastSyncedAt?: string; storageRevision?: number };
export type TaskRecord = { id: string; title: string; dueAt?: string | null; completed: boolean; notes?: string; planDate?: string | null; scheduleMode?: string; [key: string]: any };
export type LocalTask = TaskRecord;
const db = SQLite.openDatabaseSync('cat-dog-diary.db');
let initialized = false;
function init(): void {
  if (initialized) return;
  db.execSync(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS entities(account_id TEXT NOT NULL,entity_type TEXT NOT NULL,entity_id TEXT NOT NULL,payload TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL,deleted_at TEXT,device_id TEXT NOT NULL,last_mutation_id TEXT,PRIMARY KEY(account_id,entity_type,entity_id));
    CREATE TABLE IF NOT EXISTS mutations(mutation_id TEXT PRIMARY KEY,account_id TEXT NOT NULL,entity_type TEXT NOT NULL,entity_id TEXT NOT NULL,operation TEXT NOT NULL,patch TEXT NOT NULL,basePayload TEXT NOT NULL,baseRevision INTEGER NOT NULL,device_id TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS local_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sync_journals(account_id TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sync_backups(id TEXT PRIMARY KEY,account_id TEXT NOT NULL,created_at TEXT NOT NULL,value TEXT NOT NULL);`);
  initialized = true;
}
export function getMeta<T>(key: string, fallback: T): T {
  init(); const row = db.getFirstSync<{value:string}>('SELECT value FROM local_meta WHERE key=?',[key]);
  if (!row) return fallback;
  try { return JSON.parse(row.value) as T; } catch { return fallback; }
}
export function setMeta<T>(key: string,value: T): void { init(); db.runSync('INSERT OR REPLACE INTO local_meta(key,value) VALUES (?,?)',[key,JSON.stringify(value)]); }
export function newId(prefix: string): string { return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,12)}`; }
export function getDeviceId(): string {
  let id = getMeta<string>('device.id','');
  if (!id) { id=newId('android'); setMeta('device.id',id); }
  return id;
}
export function activeDataset(): string { return getMeta('dataset.current','local'); }
export function selectAccount(userId: string): void {
  const current=activeDataset(),owner=getMeta<string>(`dataset.owner.${current}`,'');
  const dataset=getMeta<string>(`account.dataset.${userId}`,'') || (!owner ? current : `account-${userId}`);
  db.withTransactionSync(() => {
    setMeta(`dataset.owner.${dataset}`,userId); setMeta(`account.dataset.${userId}`,dataset); setMeta('dataset.current',dataset);
  });
}
export function accountDeleted(): void {
  const dataset=activeDataset(), owner=getMeta<string>(`dataset.owner.${dataset}`,'');
  const r=readReplica(dataset); r.migrated=false; r.cursor=null;
  writeReplica(r,dataset); setMeta(`account.dataset.${owner}`,''); setMeta(`dataset.owner.${dataset}`,'');
}
function clean(type: SyncEntityType,value: Record<string,any>): Record<string,unknown> {
  if (type==='task') return projection.taskPayload({ ...value, completed:value.completed ?? value.done ?? false });
  if (type==='habit') return projection.habitPayload(value);
  const fields: Partial<Record<SyncEntityType,string[]>> = {
    step:projection.STEP_FIELDS, focus_session:projection.FOCUS_FIELDS,
    habit_event:['habitId','occurredAt','completed','source'], category:['name','color','icon','position'],
    stage_plan:['start','end','dailyCapacity','dailyMinutes','workdaysOnly','lastPlannedAt'], preference:['themeId'],
    reminder_rule:['targetType','targetId','mode','minutes','time','active','presentation','urgent']
  };
  // nextReminderAt and localNotificationId stay on this device.
  return projection.cleanObject(value,fields[type] || []);
}
export function readReplica(dataset=activeDataset()): Replica {
  init(); const saved=db.getFirstSync<{value:string}>('SELECT value FROM sync_journals WHERE account_id=?',[dataset]);
  if (saved) return JSON.parse(saved.value) as Replica;
  const replica: Replica=journal.emptyReplica();
  const rows=db.getAllSync<any>('SELECT * FROM entities WHERE account_id=?',[dataset]);
  for (const row of rows) {
    const entity={entityType:row.entity_type,entityId:row.entity_id,payload:clean(row.entity_type,JSON.parse(row.payload)),revision:row.revision,updatedAt:row.updated_at,deletedAt:row.deleted_at,deviceId:row.device_id,lastMutationId:row.last_mutation_id};
    replica.remote[journal.keyOf(entity)]=entity;
  }
  // Old previews are first-merge candidates, not automatic full-row uploads.
  writeReplica(replica,dataset); return replica;
}
export function writeReplica(replica: Replica,dataset=activeDataset()): void {
  init();
  const expected=replica.storageRevision || 0;
  db.withTransactionSync(() => {
    const saved=db.getFirstSync<{value:string}>('SELECT value FROM sync_journals WHERE account_id=?',[dataset]);
    const actual=saved ? JSON.parse(saved.value).storageRevision || 0 : 0;
    if(actual!==expected)throw Error('后台刚更新了数据，请重试；原修改未被覆盖');
    db.runSync('INSERT OR REPLACE INTO sync_journals(account_id,value) VALUES (?,?)',[dataset,JSON.stringify({...replica,storageRevision:expected+1})]);
    db.runSync('DELETE FROM entities WHERE account_id=?',[dataset]);
    for (const entity of journal.materialize(replica) as SyncEntity[]) db.runSync('INSERT INTO entities(account_id,entity_type,entity_id,payload,revision,updated_at,deleted_at,device_id,last_mutation_id) VALUES (?,?,?,?,?,?,?,?,?)',
      [dataset,entity.entityType,entity.entityId,JSON.stringify(entity.payload),entity.revision,entity.updatedAt || new Date().toISOString(),entity.deletedAt || null,entity.deviceId || getDeviceId(),entity.lastMutationId || null]);
  });
  replica.storageRevision=expected+1;
}
export function backupReplica(reason: string,dataset=activeDataset()): string {
  const id=newId(reason), replica=readReplica(dataset);
  db.runSync('INSERT INTO sync_backups(id,account_id,created_at,value) VALUES (?,?,?,?)',[id,dataset,new Date().toISOString(),JSON.stringify(replica)]);
  return id;
}
export function commitFirstMerge(replica: Replica,dataset: string): void {
  init(); const before=readReplica(dataset);
  db.runSync('INSERT INTO sync_backups(id,account_id,created_at,value) VALUES (?,?,?,?)',[newId('before-merge'),dataset,new Date().toISOString(),JSON.stringify(before)]);
  // The backup is durable BEFORE the atomic journal/projection replacement.
  // Compare-and-swap also protects a simultaneous WorkManager write.
  replica.storageRevision=before.storageRevision;
  writeReplica(replica,dataset);
}
export async function listEntities(type: SyncEntityType,dataset=activeDataset()): Promise<any[]> {
  return (journal.materialize(readReplica(dataset)) as SyncEntity[]).filter(e => e.entityType===type && !e.deletedAt).map(e => ({ ...e.payload,id:e.entityId }));
}
export async function listTasks(dataset=activeDataset()): Promise<TaskRecord[]> { return listEntities('task',dataset); }
export const loadTasks=listTasks;
export async function listHabits(dataset=activeDataset()): Promise<any[]> { return listEntities('habit',dataset); }
export async function saveEntity(type: SyncEntityType,value: Record<string,any>,dataset=activeDataset(),deviceId=getDeviceId()): Promise<void> {
  const r=readReplica(dataset),id=type==='preference'||type==='stage_plan' ? 'account' : String(value.id || newId(type));
  const before=(journal.materialize(r) as SyncEntity[]).find(e => e.entityType===type && e.entityId===id);
  if (before?.deletedAt) throw Error('这条记录已删除，请从回收站明确恢复');
  journal.enqueue(r,before,{entityType:type,entityId:id,payload:clean(type,value)}, {deviceId,mutationId:newId(deviceId)});
  writeReplica(r,dataset);
}
export async function deleteEntity(type: SyncEntityType,id: string,dataset=activeDataset()): Promise<void> {
  const r=readReplica(dataset), items=journal.materialize(r) as SyncEntity[];
  const target=items.find(e => e.entityType===type && e.entityId===id && !e.deletedAt);
  if (!target) return;
  for (const entity of items.filter(e => e===target || (type==='task' && e.entityType==='step' && e.payload.taskId===id))) journal.enqueue(r,entity,null,{deviceId:getDeviceId(),mutationId:newId('delete')});
  writeReplica(r,dataset);
}
export async function restoreEntity(type: SyncEntityType,id: string): Promise<void> {
  const r=readReplica(), entity=(journal.materialize(r) as SyncEntity[]).find(e => e.entityType===type && e.entityId===id);
  if (!entity?.deletedAt) throw Error('只能恢复已删除的记录');
  journal.enqueue(r,entity,{...entity,deletedAt:null},{deviceId:getDeviceId(),mutationId:newId('restore'),operation:'restore'}); writeReplica(r);
}
export async function saveTask(task: TaskRecord): Promise<void> { await saveEntity('task',task); }
export async function deleteTask(id: string): Promise<void> { await deleteEntity('task',id); }
export const localStore = { readReplica,writeReplica,activeDataset };
