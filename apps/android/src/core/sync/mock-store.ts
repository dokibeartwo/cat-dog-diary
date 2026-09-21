import type { LocalStore, SyncCursor, SyncEntity, SyncEntityType, SyncMutation } from './types';

export class MemoryStore implements LocalStore {
  private entities = new Map<string, SyncEntity>();
  private mutations = new Map<string, SyncMutation>();
  private cursor: SyncCursor = null;

  async listEntities<T>(entityType: SyncEntityType): Promise<SyncEntity<T>[]> {
    return [...this.entities.values()].filter((item) => item.entityType === entityType) as SyncEntity<T>[];
  }
  async getEntity<T>(entityType: SyncEntityType, entityId: string): Promise<SyncEntity<T> | null> {
    const item = this.entities.get(`${entityType}:${entityId}`);
    return (item as SyncEntity<T> | undefined) ?? null;
  }
  async applyEntity<T>(entity: SyncEntity<T>): Promise<void> { this.entities.set(`${entity.entityType}:${entity.entityId}`, entity as SyncEntity); }
  async enqueueMutation(mutation: SyncMutation): Promise<void> { this.mutations.set(mutation.mutationId, mutation); }
  async listPendingMutations(): Promise<SyncMutation[]> { return [...this.mutations.values()]; }
  async removeMutations(ids: string[]): Promise<void> { ids.forEach((id) => this.mutations.delete(id)); }
  async getCursor(): Promise<SyncCursor> { return this.cursor; }
  async setCursor(cursor: SyncCursor): Promise<void> { this.cursor = cursor; }
}
