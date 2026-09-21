'use strict';

const { clone, entityKey, makeEntity, makeMutation, timestamp, assertAccountId, assertDeviceId } = require('./schema');
const { MemorySyncStore } = require('./local-store');

function mutationHash(mutation) {
  // Deterministic, dependency-free fingerprint. It is only used to reject a
  // reused mutation ID with different content; the mutation ID itself is the
  // idempotency key and is never used as a security credential.
  const text = JSON.stringify(mutation);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function changedFields(patch) { return Object.keys(patch || {}).filter(key => key !== 'id'); }

function occurrenceKey(task, occurrence = task) {
  const seriesId = String(task?.seriesId || task?.id || 'unknown');
  const date = occurrence?.dueAt ? new Date(occurrence.dueAt) : null;
  const dateKey = date && Number.isFinite(date.getTime()) ? date.toISOString() : String(occurrence?.planDate || 'unscheduled');
  return `${seriesId}|${dateKey}`;
}

// A stable child id is required when two devices complete the same recurring
// item while offline.  Do not use a random id for the next occurrence.
function occurrenceId(task, occurrence = task) {
  const key = occurrenceKey(task, occurrence);
  let hash = 2166136261;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `occ-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

class InMemorySyncServer {
  constructor({ now = () => new Date() } = {}) {
    this.now = now;
    this.accounts = new Map();
  }

  account(accountId) {
    assertAccountId(accountId);
    if (!this.accounts.has(accountId)) this.accounts.set(accountId, { entities: new Map(), mutations: new Map(), changes: [], cursor: 0 });
    return this.accounts.get(accountId);
  }

  seed(snapshot) {
    const account = this.account(snapshot.accountId);
    for (const item of snapshot.entities || []) {
      if (item.accountId !== snapshot.accountId) throw new Error('账号隔离失败：不能导入其他账号实体');
      const entity = makeEntity(item);
      account.entities.set(entityKey(snapshot.accountId, entity.entityType, entity.entityId), entity);
    }
    return this.pull(snapshot.accountId, 0);
  }

  push(accountId, mutations = []) {
    const account = this.account(accountId);
    const accepted = [], conflicts = [], duplicate = [];
    for (const raw of mutations) {
      const mutation = makeMutation(raw);
      if (mutation.accountId !== accountId) throw new Error('账号隔离失败：变更不属于当前账号');
      const prior = account.mutations.get(mutation.mutationId);
      if (prior) {
        if (prior.hash !== mutationHash(mutation)) throw new Error('变更编号重复但内容不同');
        duplicate.push(mutation.mutationId);
        continue;
      }
      const key = entityKey(accountId, mutation.entityType, mutation.entityId);
      const current = account.entities.get(key) || makeEntity({ accountId, deviceId: mutation.deviceId,
        entityType: mutation.entityType, entityId: mutation.entityId, payload: {}, revision: 0,
        updatedAt: mutation.createdAt });
      const fields = changedFields(mutation.patch);
      const remotePatch = current.payload || {};
      const concurrent = current.revision !== mutation.baseRevision;
      const basePayload = mutation.basePayload || {};
      // A field conflicts only when it changed on both sides after the
      // mutation's base revision. Merely existing on the remote entity is not
      // a conflict (this is what permits independent title/notes edits).
      const overlap = concurrent ? fields.filter(field =>
        Object.prototype.hasOwnProperty.call(remotePatch, field)
        && remotePatch[field] !== basePayload[field]
        && mutation.patch[field] !== remotePatch[field]) : [];
      if (current.deletedAt && mutation.operation === 'upsert') {
        const conflict = this.makeConflict(accountId, mutation, current, ['deletedAt'], mutation.patch);
        conflicts.push(conflict);
        account.mutations.set(mutation.mutationId, { hash: mutationHash(mutation), result: 'deleted-conflict' });
        continue;
      }
      if (overlap.length) {
        const conflict = this.makeConflict(accountId, mutation, current, overlap, mutation.patch);
        conflicts.push(conflict);
        account.mutations.set(mutation.mutationId, { hash: mutationHash(mutation), result: 'conflict' });
        continue;
      }
      const nextPayload = mutation.operation === 'delete' ? remotePatch : { ...remotePatch, ...clone(mutation.patch) };
      const deletedAt = mutation.operation === 'delete' ? timestamp(mutation.createdAt) : null;
      const next = makeEntity({ accountId, deviceId: mutation.deviceId, entityType: mutation.entityType,
        entityId: mutation.entityId, payload: nextPayload, updatedAt: mutation.createdAt,
        deletedAt, revision: current.revision + 1, lastMutationId: mutation.mutationId });
      account.entities.set(key, next);
      account.cursor += 1;
      const change = { cursor: account.cursor, entity: clone(next) };
      account.changes.push(change);
      account.mutations.set(mutation.mutationId, { hash: mutationHash(mutation), result: 'accepted', cursor: account.cursor });
      accepted.push({ mutationId: mutation.mutationId, cursor: account.cursor, entity: clone(next) });
    }
    return { accepted, conflicts, duplicate, cursor: account.cursor };
  }

  makeConflict(accountId, mutation, current, fields, localPatch) {
    return {
      conflictId: `${mutation.mutationId}:${current.revision}`, mutationId: mutation.mutationId,
      accountId, entityType: mutation.entityType, entityId: mutation.entityId,
      fields: [...new Set(fields)], local: clone(localPatch), remote: clone(current.payload),
      remoteRevision: current.revision, createdAt: timestamp(this.now())
    };
  }

  pull(accountId, cursor = 0) {
    const account = this.account(accountId);
    if (!Number.isInteger(cursor) || cursor < 0 || cursor > account.cursor) throw new Error('无效的同步游标');
    return { cursor: account.cursor, changes: account.changes.filter(item => item.cursor > cursor).map(clone) };
  }
}

class SyncEngine {
  constructor({ accountId, deviceId, store, server, now = () => new Date() } = {}) {
    assertAccountId(accountId); assertDeviceId(deviceId);
    this.accountId = accountId; this.deviceId = deviceId; this.now = now;
    this.store = store || new MemorySyncStore({ accountId, deviceId, now });
    this.server = server || null;
  }

  localUpsert(entityType, entityId, patch, { mutationId, occurrence = null, now = this.now() } = {}) {
    const current = this.store.getEntity(entityType, entityId);
    const nextPayload = { ...(current?.payload || {}), ...clone(patch) };
    const createdAt = timestamp(now);
    const mutation = makeMutation({ accountId: this.accountId, deviceId: this.deviceId,
      mutationId: mutationId || `${this.deviceId}:${createdAt}:${entityType}:${entityId}`,
      entityType, entityId, operation: 'upsert', patch: clone(patch), baseRevision: current?.revision || 0,
      basePayload: current?.payload || {},
      createdAt, occurrenceKey: entityType === 'task' ? occurrenceKey(nextPayload, occurrence || nextPayload) : null });
    const entity = makeEntity({ accountId: this.accountId, deviceId: this.deviceId, entityType, entityId,
      payload: nextPayload, updatedAt: createdAt, deletedAt: null, revision: current?.revision || 0,
      lastMutationId: mutation.mutationId });
    this.store.putEntity(entity); this.store.enqueue(mutation);
    return { entity, mutation };
  }

  localDelete(entityType, entityId, { mutationId, now = this.now() } = {}) {
    const current = this.store.getEntity(entityType, entityId);
    const createdAt = timestamp(now);
    const mutation = makeMutation({ accountId: this.accountId, deviceId: this.deviceId,
      mutationId: mutationId || `${this.deviceId}:${createdAt}:delete:${entityType}:${entityId}`,
      entityType, entityId, operation: 'delete', patch: {}, baseRevision: current?.revision || 0, createdAt });
    const entity = makeEntity({ accountId: this.accountId, deviceId: this.deviceId, entityType, entityId,
      payload: current?.payload || {}, updatedAt: createdAt, deletedAt: createdAt,
      revision: current?.revision || 0, lastMutationId: mutation.mutationId });
    this.store.putEntity(entity); this.store.enqueue(mutation);
    return { entity, mutation };
  }

  localRestore(entityType, entityId, patch = {}, { mutationId, now = this.now() } = {}) {
    const current = this.store.getEntity(entityType, entityId);
    if (!current?.deletedAt) throw new Error('只能恢复已删除的实体');
    const createdAt = timestamp(now);
    const nextPayload = { ...(current.payload || {}), ...clone(patch) };
    const mutation = makeMutation({ accountId: this.accountId, deviceId: this.deviceId,
      mutationId: mutationId || `${this.deviceId}:${createdAt}:restore:${entityType}:${entityId}`,
      entityType, entityId, operation: 'restore', patch: clone(patch),
      baseRevision: current.revision, basePayload: current.payload || {}, createdAt });
    const entity = makeEntity({ accountId: this.accountId, deviceId: this.deviceId, entityType, entityId,
      payload: nextPayload, updatedAt: createdAt, deletedAt: null, revision: current.revision,
      lastMutationId: mutation.mutationId });
    this.store.putEntity(entity); this.store.enqueue(mutation);
    return { entity, mutation };
  }

  sync() {
    if (!this.server) throw new Error('未配置同步服务');
    const outgoing = this.store.pendingMutations();
    const result = this.server.push(this.accountId, outgoing);
    // A conflict is recorded for explicit resolution; retaining the same
    // mutation in the outbox would replay it on every reconnect.
    this.store.acknowledgeMutations([
      ...result.accepted.map(item => item.mutationId),
      ...result.duplicate,
      ...result.conflicts.map(item => item.mutationId).filter(Boolean)
    ]);
    for (const conflict of result.conflicts) this.store.addConflict(conflict);
    const pulled = this.server.pull(this.accountId, this.store.getCursor());
    for (const change of pulled.changes) {
      const entity = change.entity;
      if (entity.accountId !== this.accountId) throw new Error('账号隔离失败：收到其他账号数据');
      const local = this.store.getEntity(entity.entityType, entity.entityId);
      if (!local || entity.revision >= local.revision) this.store.putEntity(entity);
    }
    this.store.setCursor(pulled.cursor);
    return { pushed: result.accepted.length, duplicates: result.duplicate.length,
      conflicts: result.conflicts.length, pulled: pulled.changes.length, cursor: pulled.cursor };
  }
}

module.exports = { occurrenceKey, occurrenceId, InMemorySyncServer, SyncEngine, mutationHash };
