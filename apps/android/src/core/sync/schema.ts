import type { SyncEntity, SyncEntityType, SyncMutation } from './types';

const ENTITY_TYPES: SyncEntityType[] = ['task', 'step', 'habit', 'habit_event', 'category', 'stage_plan', 'reminder_rule', 'focus_session', 'preference'];

export function isEntityType(value: unknown): value is SyncEntityType {
  return typeof value === 'string' && ENTITY_TYPES.includes(value as SyncEntityType);
}

export function isSyncEntity(value: unknown): value is SyncEntity {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return typeof item.entityId === 'string'
    && isEntityType(item.entityType)
    && !!item.payload && typeof item.payload === 'object'
    && typeof item.updatedAt === 'string'
    && (item.deletedAt === null || typeof item.deletedAt === 'string')
    && Number.isInteger(item.revision) && (item.revision as number) >= 0
    && typeof item.deviceId === 'string'
    && (item.lastMutationId === null || typeof item.lastMutationId === 'string');
}

export function isSyncMutation(value: unknown): value is SyncMutation {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return typeof item.mutationId === 'string'
    && isEntityType(item.entityType)
    && typeof item.entityId === 'string'
    && (item.operation === 'upsert' || item.operation === 'restore' || item.operation === 'delete')
    && !!item.patch && typeof item.patch === 'object'
    && Number.isInteger(item.baseRevision) && (item.baseRevision as number) >= 0
    && typeof item.deviceId === 'string'
    && typeof item.createdAt === 'string';
}

export function migrateV1Record(record: Record<string, unknown>, deviceId: string, now = new Date().toISOString()): SyncEntity[] {
  const result: SyncEntity[] = [];
  const sources: Array<[SyncEntityType, unknown]> = [
    ['task', record.tasks], ['habit', record.habits], ['category', record.categories]
  ];
  for (const [entityType, entries] of sources) {
    if (!Array.isArray(entries)) continue;
    entries.forEach((entry, index) => {
      if (!entry || typeof entry !== 'object') return;
      const source = entry as Record<string, unknown>;
      const entityId = typeof source.id === 'string' ? source.id : `${entityType}-${index + 1}`;
      const payload = { ...source }; delete payload.id;
      result.push({ payload, entityId, entityType, updatedAt: now, deletedAt: null, revision: 0, deviceId, lastMutationId: `migration-${entityId}` });
    });
  }
  const stagePlan = record.stagePlan ?? record.stagePlans;
  if (stagePlan && typeof stagePlan === 'object' && !Array.isArray(stagePlan)) {
    const payload = { ...(stagePlan as Record<string, unknown>) };
    delete payload.id;
    result.push({ payload, entityId: 'account', entityType: 'stage_plan', updatedAt: now, deletedAt: null, revision: 0, deviceId, lastMutationId: 'migration-stage-plan' });
  }
  return result;
}
