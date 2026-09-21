import type { LocalStore, SyncAdapter, SyncCursor, SyncEntity, SyncMutation } from '../core/sync/types';
import { supabase } from './supabase';

export class SyncService {
  constructor(private readonly store: LocalStore, private readonly adapter: SyncAdapter) {}

  async run(): Promise<{ uploaded: number; downloaded: number; conflicts: number }> {
    const pending = await this.store.listPendingMutations();
    const pushed = pending.length ? await this.adapter.push(pending) : { accepted: [], conflicts: [] as SyncEntity[] };
    const conflictIds = pushed.conflicts.map((item) => item.lastMutationId).filter((id): id is string => Boolean(id));
    if (pushed.accepted.length || conflictIds.length) await this.store.removeMutations([...pushed.accepted, ...conflictIds]);
    const cursor = await this.store.getCursor();
    const pulled = await this.adapter.pull(cursor);
    for (const entity of pulled.entities) await this.store.applyEntity(entity);
    await this.store.setCursor(pulled.cursor);
    return { uploaded: pushed.accepted.length, downloaded: pulled.entities.length, conflicts: pushed.conflicts.length };
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
