'use strict';

// This schema is deliberately storage-agnostic. It can be persisted in SQLite
// on a device or sent as JSON over the Supabase sync API.
const V2_SCHEMA = 2;
const ENTITY_TYPES = Object.freeze([
  // These names are the wire contract shared by Windows and Android.  Keep
  // runtime/presentation state out of this list: it is never uploaded.
  'task', 'step', 'habit', 'habit_event', 'category', 'stage_plan',
  'reminder_rule', 'focus_session', 'preference'
]);

function assertAccountId(accountId) {
  if (typeof accountId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(accountId)) {
    throw new Error('无效的账号标识');
  }
  return accountId;
}

function assertDeviceId(deviceId) {
  if (typeof deviceId !== 'string' || !/^[a-zA-Z0-9._-]{1,128}$/.test(deviceId)) {
    throw new Error('无效的设备标识');
  }
  return deviceId;
}

function assertEntityType(entityType) {
  if (!ENTITY_TYPES.includes(entityType)) throw new Error('不支持的同步实体类型');
  return entityType;
}

function assertEntityId(entityId) {
  if (typeof entityId !== 'string' || !/^[\w:-]{1,128}$/.test(entityId)) {
    throw new Error('无效的实体标识');
  }
  return entityId;
}

function validIso(value) {
  return value !== null && value !== undefined && Number.isFinite(new Date(value).getTime());
}

function timestamp(value, fallback = new Date().toISOString()) {
  const result = value || fallback;
  if (!validIso(result)) throw new Error('无效的同步时间');
  return new Date(result).toISOString();
}

function clone(value) {
  if (value === undefined) return undefined;
  if (typeof structuredClone === 'function') return structuredClone(value);
  // React Native versions without the global structuredClone still receive
  // JSON data from the sync API, so this fallback keeps the core portable.
  return JSON.parse(JSON.stringify(value));
}

function makeEntity({ accountId, entityType, entityId, payload = {}, updatedAt, deletedAt = null,
  revision = 0, deviceId, lastMutationId = null }) {
  assertAccountId(accountId);
  assertEntityType(entityType);
  assertEntityId(entityId);
  assertDeviceId(deviceId);
  if (!Number.isInteger(revision) || revision < 0) throw new Error('无效的实体版本');
  if (deletedAt !== null && !validIso(deletedAt)) throw new Error('无效的删除时间');
  return Object.freeze({
    accountId,
    entityType,
    entityId,
    payload: clone(payload) || {},
    updatedAt: timestamp(updatedAt),
    deletedAt: deletedAt ? timestamp(deletedAt) : null,
    revision,
    deviceId,
    lastMutationId: lastMutationId === null ? null : String(lastMutationId)
  });
}

function entityKey(accountId, entityType, entityId) {
  return `${assertAccountId(accountId)}|${assertEntityType(entityType)}|${assertEntityId(entityId)}`;
}

function makeMutation({ accountId, deviceId, mutationId, entityType, entityId, operation = 'upsert',
  patch = {}, baseRevision = 0, basePayload = {}, createdAt, occurrenceKey = null }) {
  assertAccountId(accountId);
  assertDeviceId(deviceId);
  assertEntityType(entityType);
  assertEntityId(entityId);
  if (typeof mutationId !== 'string' || !/^[a-zA-Z0-9._:-]{1,160}$/.test(mutationId)) {
    throw new Error('无效的变更编号');
  }
  if (!['upsert', 'delete', 'restore'].includes(operation)) throw new Error('不支持的同步操作');
  if (!Number.isInteger(baseRevision) || baseRevision < 0) throw new Error('无效的基础版本');
  return Object.freeze({
    mutationId, accountId, deviceId, entityType, entityId, operation,
    patch: clone(patch) || {}, basePayload: clone(basePayload) || {}, baseRevision, createdAt: timestamp(createdAt),
    occurrenceKey: occurrenceKey === null ? null : String(occurrenceKey)
  });
}

module.exports = {
  V2_SCHEMA, ENTITY_TYPES, assertAccountId, assertDeviceId, assertEntityType,
  assertEntityId, validIso, timestamp, clone, makeEntity, entityKey, makeMutation
};
