import type { LocalStore, SyncAdapter, SyncCursor, SyncEntity, SyncEntityType, SyncMutation } from '../core/sync/types';
import { supabase } from './supabase';

const ENTITY_TYPES: SyncEntityType[] = ['task', 'step', 'habit', 'habit_event', 'category', 'stage_plan', 'reminder_rule', 'focus_session', 'preference'];
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const keyOf = (item: Pick<SyncEntity, 'entityType' | 'entityId'>) => `${item.entityType}|${item.entityId}`;

export class SyncService {
  constructor(private readonly store: LocalStore, private readonly adapter: SyncAdapter) {}
  private running: Promise<{ uploaded: number; downloaded: number; conflicts: number }> | null = null;

  private async localEntities(): Promise<SyncEntity[]> {
    const result: SyncEntity[] = [];
    for (const type of ENTITY_TYPES) result.push(...await this.store.listEntities(type));
    return result;
  }

  async preview(): Promise<{ localEntities: number; cloudEntities: number; local: Record<string, number>; cloud: Record<string, number> }> {
    const [local, remote] = await Promise.all([this.localEntities(), this.adapter.pull(null)]);
    const count = (items: SyncEntity[]) => items.reduce<Record<string, number>>((result, item) => { result[item.entityType] = (result[item.entityType] || 0) + (item.deletedAt ? 0 : 1); return result; }, {});
    return { localEntities: local.filter((item) => !item.deletedAt).length, cloudEntities: remote.entities.filter((item) => !item.deletedAt).length, local: count(local), cloud: count(remote.entities) };
  }

  /** Prepare a first-login merge without uploading until the caller confirms. */
  async merge(strategy: 'merge' | 'local' | 'cloud'): Promise<void> {
    const [local, remote] = await Promise.all([this.localEntities(), this.adapter.pull(null)]);
    const localMap = new Map(local.map((item) => [keyOf(item), item]));
    const remoteMap = new Map(remote.entities.map((item) => [keyOf(item), item]));
    const pending = await this.store.listPendingMutations();
    if (pending.length) await this.store.removeMutations(pending.map((item) => item.mutationId));
    const now = new Date().toISOString();
    if (strategy === 'cloud') {
      for (const item of local) if (!remoteMap.has(keyOf(item))) await this.store.applyEntity({ ...clone(item), deletedAt: now });
      for (const item of remote.entities) await this.store.applyEntity(item);
      await this.store.setCursor(remote.cursor);
      return;
    }
    // Cloud-only records are part of a normal merge. A local-only choice
    // intentionally creates tombstones for them below.
    if (strategy === 'merge') for (const item of remote.entities) if (!localMap.has(keyOf(item))) await this.store.applyEntity(item);
    for (const item of local) {
      if (item.deletedAt) continue;
      const remoteItem = remoteMap.get(keyOf(item));
      const same = remoteItem && JSON.stringify(remoteItem.payload) === JSON.stringify(item.payload);
      if (same) continue;
      await this.store.enqueueMutation({
        mutationId: `${item.deviceId || 'android'}:merge:${Date.now()}:${Math.random().toString(36).slice(2, 9)}`,
        entityType: item.entityType, entityId: item.entityId, operation: 'upsert', patch: clone(item.payload),
        basePayload: clone(remoteItem?.payload || {}), baseRevision: Number(remoteItem?.revision || 0),
        deviceId: item.deviceId, createdAt: now
      });
    }
    if (strategy === 'local') {
      for (const item of remote.entities) if (!localMap.has(keyOf(item)) && !item.deletedAt) {
        await this.store.enqueueMutation({
          mutationId: `android:merge-delete:${Date.now()}:${Math.random().toString(36).slice(2, 9)}`,
          entityType: item.entityType, entityId: item.entityId, operation: 'delete', patch: {},
          basePayload: clone(item.payload), baseRevision: Number(item.revision || 0), deviceId: item.deviceId || 'android', createdAt: now
        });
      }
    }
  }

  async run(): Promise<{ uploaded: number; downloaded: number; conflicts: number }> {
    if (this.running) return this.running;
    this.running = (async () => {
      const pending = await this.store.listPendingMutations();
      const pushed = pending.length ? await this.adapter.push(pending) : { accepted: [], conflicts: [] as SyncEntity[] };
      const conflictIds = pushed.conflicts.map((item) => item.lastMutationId).filter((id): id is string => Boolean(id));
      if (pushed.accepted.length || conflictIds.length) await this.store.removeMutations([...pushed.accepted, ...conflictIds]);
      const cursor = await this.store.getCursor();
      const pulled = await this.adapter.pull(cursor);
      for (const entity of pulled.entities) await this.store.applyEntity(entity);
      await this.store.setCursor(pulled.cursor);
      return { uploaded: pushed.accepted.length, downloaded: pulled.entities.length, conflicts: pushed.conflicts.length };
    })();
    try { return await this.running; } finally { this.running = null; }
  }
}

export function createSupabaseAdapter(): SyncAdapter | null {
  if (!supabase) return null;
  return {
    async push(mutations: SyncMutation[]) {
      const { data, error } = await supabase.rpc('push_mutations', { p_mutations: mutations });
      if (error) throw error;
      const rows = Array.isArray(data) ? data : [];
      return {
        accepted: rows.filter((row: any) => row.status === 'applied' || row.status === 'duplicate').map((row: any) => row.mutationId),
        conflicts: rows.filter((row: any) => row.status === 'conflict').map((row: any) => ({ entityId: String(row.entityId ?? ''), entityType: String(row.entityType ?? 'task'), updatedAt: new Date().toISOString(), deletedAt: null, revision: Number(row.revision ?? 0), deviceId: '', lastMutationId: String(row.mutationId ?? '') })) as SyncEntity[]
      };
    },
    async pull(cursor: SyncCursor) {
      const { data, error } = await supabase.rpc('pull_changes', {
        p_cursor: cursor?.updatedAt ?? null,
        p_cursor_entity: cursor?.entityId ?? '',
        p_limit: 500
      });
      if (error) throw error;
      const next = data?.nextCursor;
      return {
        entities: (data?.items ?? []).map((item: any) => ({ payload: item.payload ?? {}, entityType: item.entityType, entityId: item.entityId, updatedAt: item.updatedAt, deletedAt: item.deletedAt ?? null, revision: Number(item.revision ?? 0), deviceId: item.deviceId, lastMutationId: item.lastMutationId ?? null })) as SyncEntity[],
        cursor: next ? { updatedAt: next.updatedAt, entityId: next.entity } : cursor
      };
    }
  };
}

export async function acquireFocusLease(deviceId: string, sessionId: string): Promise<boolean> {
  if (!supabase) return true;
  const { data, error } = await supabase.rpc('acquire_focus_lease', { p_device_id: deviceId, p_session_id: sessionId, p_lease_seconds: 90 });
  if (error) throw error;
  return data?.ok === true;
}
export async function releaseFocusLease(deviceId: string, sessionId?: string): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.rpc('release_focus_lease', { p_device_id: deviceId, p_session_id: sessionId ?? null });
  if (error) throw error;
}
export async function deleteCloudAccount(): Promise<void> {
  if (!supabase) throw new Error('尚未配置同步服务。');
  const { error } = await supabase.rpc('delete_account');
  if (error) throw error;
  await supabase.auth.signOut();
}
