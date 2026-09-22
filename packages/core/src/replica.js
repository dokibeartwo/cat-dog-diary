'use strict';

// Shared, platform-neutral sync journal. Remote snapshots are kept separate
// from optimistic edits, so downloading can never erase an unsent change.
const copy = value => JSON.parse(JSON.stringify(value));
const keyOf = value => `${value.entityType}|${value.entityId}`;
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
  return JSON.stringify(value ?? null);
}
const equal = (a, b) => stable(a) === stable(b);
function difference(before = {}, after = {}) {
  const result = {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (!equal(before[key], after[key])) result[key] = after[key] === undefined ? null : copy(after[key]);
  }
  return result;
}
function emptyReplica() { return { remote: {}, outbox: [], conflicts: [], cursor: null, migrated: false }; }
function materialize(replica) {
  const rows = copy(replica.remote || {});
  for (const mutation of replica.outbox || []) {
    const key = keyOf(mutation), prior = rows[key] || { entityType: mutation.entityType, entityId: mutation.entityId, payload: {}, revision: 0 };
    // A tombstone wins over an old offline update; its content survives in
    // the immutable journal/server conflict, never as a resurrected task.
    if (prior.deletedAt && mutation.operation === 'upsert') continue;
    rows[key] = { ...prior, payload: mutation.operation === 'delete' ? prior.payload : { ...prior.payload, ...copy(mutation.patch) },
      updatedAt: mutation.createdAt, deletedAt: mutation.operation === 'delete' ? mutation.createdAt : null,
      deviceId: mutation.deviceId, lastMutationId: mutation.mutationId };
  }
  return Object.values(rows);
}
function enqueue(replica, before, after, { deviceId, mutationId, now = new Date().toISOString(), operation } = {}) {
  const item = after || before;
  if (!item) return;
  const key = keyOf(item), remote = replica.remote[key];
  const op = operation || (after ? 'upsert' : 'delete');
  const patch = op === 'delete' ? {} : difference(before?.payload || {}, after.payload);
  if (op === 'upsert' && Object.keys(patch).length === 0) return;
  // Only edits that have NEVER been sent may be coalesced. A timeout may
  // mean the server committed: reusing that ID with changed bytes is unsafe.
  const tail = [...replica.outbox].reverse().find(m => keyOf(m) === key);
  if (tail && !tail.attempted && tail.operation === op && op === 'upsert') {
    tail.patch = { ...tail.patch, ...patch };
    return;
  }
  replica.outbox.push({ mutationId, entityType: item.entityType, entityId: item.entityId, operation: op, patch,
    basePayload: copy(before?.payload || remote?.payload || {}), baseRevision: Number(remote?.revision || 0),
    deviceId, createdAt: now });
}
function transportMutation(mutation) {
  const { attempted, ...wire } = mutation;
  return copy(wire);
}
function commitExchange(replica, results, entities, cursor) {
  const processed = new Set();
  for (const result of results) {
    if (['applied', 'duplicate', 'conflict'].includes(result.status)) processed.add(result.mutationId);
    if (result.status === 'conflict' && !replica.conflicts.some(c => c.mutationId === result.mutationId)) {
      replica.conflicts.push({ ...copy(result), mutation: copy(replica.outbox.find(m => m.mutationId === result.mutationId) || {}) });
    }
  }
  for (const item of entities) {
    const key = keyOf(item), previous = replica.remote[key];
    if (!previous || item.revision >= previous.revision) replica.remote[key] = copy(item);
  }
  replica.outbox = replica.outbox.filter(m => !processed.has(m.mutationId));
  replica.cursor = cursor;
  return materialize(replica);
}
function fingerprint(entities) {
  return stable(entities.map(e => ({ key: keyOf(e), payload: e.payload, deletedAt: e.deletedAt || null })).sort((a, b) => a.key.localeCompare(b.key)));
}
function mergePreview(local, cloud) {
  const count = list => list.filter(e => !e.deletedAt).reduce((acc, e) => { acc[e.entityType] = (acc[e.entityType] || 0) + 1; return acc; }, {});
  return { local: count(local), cloud: count(cloud), localEntities: local.filter(e => !e.deletedAt).length,
    cloudEntities: cloud.filter(e => !e.deletedAt).length, fingerprint: fingerprint(local) };
}
// First merge deliberately bases colliding IDs on an empty ancestor: a
// difference must become an explicit server conflict, never "local wins".
function prepareMerge(local, cloud, createId, deviceId) {
  const replica = emptyReplica();
  replica.remote = Object.fromEntries(cloud.map(e => [keyOf(e), copy(e)]));
  for (const item of local) {
    const remote = replica.remote[keyOf(item)];
    if (item.deletedAt) {
      if (remote && !remote.deletedAt) {
        enqueue(replica, item, null, { deviceId, mutationId: createId() });
        replica.outbox.at(-1).baseRevision = 0;
      }
      continue;
    }
    if (remote?.deletedAt || (remote && equal(remote.payload, item.payload))) continue;
    enqueue(replica, null, item, { deviceId, mutationId: createId() });
    const mutation = replica.outbox.at(-1);
    if (mutation) { mutation.basePayload = {}; mutation.baseRevision = 0; }
  }
  replica.migrated = true;
  return replica;
}
module.exports = { keyOf, stable, equal, difference, emptyReplica, materialize, enqueue, transportMutation, commitExchange, fingerprint, mergePreview, prepareMerge };
