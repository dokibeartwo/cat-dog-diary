'use strict';

const { clone, entityKey, makeEntity, makeMutation } = require('./schema');

// This class is the API contract used by the mobile adapter. Production can
// back the same methods with SQLite; tests and first-run migration use this
// dependency-free implementation so no native module is needed in Node.
class MemorySyncStore {
  constructor({ accountId, deviceId, now = () => new Date() } = {}) {
    if (!accountId || !deviceId) throw new Error('本地同步存储需要账号和设备标识');
    this.accountId = accountId;
    this.deviceId = deviceId;
    this.now = now;
    this.entities = new Map();
    this.outbox = new Map();
    this.conflicts = [];
    this.cursor = 0;
  }

  putEntity(entity) {
    if (entity.accountId !== this.accountId) throw new Error('账号隔离失败：实体不属于当前账号');
    const normalized = makeEntity(entity);
    this.entities.set(entityKey(this.accountId, normalized.entityType, normalized.entityId), normalized);
    return clone(normalized);
  }

  getEntity(entityType, entityId) {
    return clone(this.entities.get(entityKey(this.accountId, entityType, entityId)) || null);
  }

  listEntities({ includeDeleted = false, entityType } = {}) {
    return [...this.entities.values()]
      .filter(item => (!entityType || item.entityType === entityType) && (includeDeleted || !item.deletedAt))
      .map(clone);
  }

  enqueue(mutation) {
    const normalized = makeMutation(mutation);
    if (normalized.accountId !== this.accountId || normalized.deviceId !== this.deviceId) {
      throw new Error('账号或设备不匹配');
    }
    if (!this.outbox.has(normalized.mutationId)) this.outbox.set(normalized.mutationId, normalized);
    return clone(this.outbox.get(normalized.mutationId));
  }

  pendingMutations() { return [...this.outbox.values()].map(clone); }

  acknowledgeMutations(ids) {
    for (const id of ids || []) this.outbox.delete(id);
  }

  addConflict(conflict) {
    const copy = clone(conflict);
    if (!this.conflicts.some(item => item.conflictId === copy.conflictId)) this.conflicts.push(copy);
    return clone(copy);
  }

  listConflicts() { return clone(this.conflicts); }

  setCursor(cursor) {
    if (!Number.isInteger(cursor) || cursor < this.cursor) throw new Error('同步游标只能向前移动');
    this.cursor = cursor;
    return this.cursor;
  }

  getCursor() { return this.cursor; }

  snapshot() {
    return { accountId: this.accountId, deviceId: this.deviceId, cursor: this.cursor,
      entities: this.listEntities({ includeDeleted: true }), outbox: this.pendingMutations(), conflicts: this.listConflicts() };
  }
}

module.exports = { MemorySyncStore };
