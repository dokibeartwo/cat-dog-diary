export type SyncEntityType = 'task' | 'step' | 'habit' | 'habit_event' | 'category' | 'stage_plan' | 'reminder_rule' | 'focus_session' | 'preference';
export type MutationOperation = 'upsert' | 'restore' | 'delete';

export type SyncEntity<T = Record<string, unknown>> = {
  payload: T;
  entityId: string;
  entityType: SyncEntityType;
  updatedAt: string;
  deletedAt: string | null;
  revision: number;
  deviceId: string;
  lastMutationId: string | null;
};

export type SyncMutation = {
  mutationId: string;
  entityType: SyncEntityType;
  entityId: string;
  operation: MutationOperation;
  patch: Record<string, unknown>;
  /** Snapshot of the fields this mutation was based on, used by the server for field-level merges. */
  basePayload?: Record<string, unknown>;
  baseRevision: number;
  deviceId: string;
  createdAt: string;
};

export type SyncCursor = { updatedAt: string; entityId: string } | null;
export type SyncStatus = 'offline' | 'idle' | 'syncing' | 'error';

export type LocalStore = {
  listEntities<T>(entityType: SyncEntityType): Promise<SyncEntity<T>[]>;
  getEntity<T>(entityType: SyncEntityType, entityId: string): Promise<SyncEntity<T> | null>;
  applyEntity<T>(entity: SyncEntity<T>): Promise<void>;
  enqueueMutation(mutation: SyncMutation): Promise<void>;
  listPendingMutations(): Promise<SyncMutation[]>;
  removeMutations(ids: string[]): Promise<void>;
  getCursor(): Promise<SyncCursor>;
  setCursor(cursor: SyncCursor): Promise<void>;
};

export type SyncAdapter = {
  identity(): Promise<string>;
  push(mutations: SyncMutation[]): Promise<{ mutationId: string; status: string; [key: string]: unknown }[]>;
  pull(cursor: SyncCursor): Promise<{ entities: SyncEntity[]; cursor: SyncCursor; hasMore: boolean }>;
};
