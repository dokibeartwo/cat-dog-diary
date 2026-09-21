'use strict';

// Keep the migration dependency-free so this module can be bundled on Android.
const { V2_SCHEMA, makeEntity, assertAccountId, assertDeviceId, clone, timestamp } = require('./schema');
const { projectState, applyEntities } = require('./projection');

const SYNCABLE_LISTS = Object.freeze([
  ['tasks', 'task'], ['habits', 'habit'], ['categories', 'category'],
  ['focusHistory', 'focus_session'], ['habitEvents', 'habit_event'],
  ['habitCompletions', 'habit_event']
]);

function idFor(item, index, type) {
  const candidate = item && (item.id || item.sessionId);
  return typeof candidate === 'string' && /^[\w:-]{1,128}$/.test(candidate) ? candidate : `${type}-${index + 1}`;
}
function migrationTime(raw, now) {
  for (const value of [raw?.updatedAt, raw?.modifiedAt, raw?.createdAt, raw?.startedAt]) {
    if (value && Number.isFinite(new Date(value).getTime())) return new Date(value).toISOString();
  }
  return timestamp(now);
}
function validRaw(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.tasks)) throw Error('不是有效的猫狗日记数据文件');
  if (raw.habits !== undefined && !Array.isArray(raw.habits)) throw Error('习惯数据不是有效列表，原数据未更改');
  if (raw.trash !== undefined && !Array.isArray(raw.trash)) throw Error('回收站数据不是有效列表，原数据未更改');
  const version = Number(raw.schemaVersion ?? 0);
  if (!Number.isInteger(version) || version < 0 || version > 1) throw Error('数据版本标识无效，原数据未更改');
  return clone(raw);
}

function migrateV1ToV2(raw, { accountId, deviceId = 'migration', now = new Date() } = {}) {
  assertAccountId(accountId); assertDeviceId(deviceId);
  const source = validRaw(raw), entities = [], seen = new Set();
  const add = (type, item, index) => {
    const entityId = idFor(item, index, type), key = `${type}|${entityId}`;
    if (seen.has(key)) throw new Error(`同步实体编号重复：${type}/${entityId}`);
    const input = type === 'task' ? { tasks: [{ ...item, id: entityId }] }
      : type === 'habit' ? { habits: [{ ...item, id: entityId }] }
        : type === 'category' ? { categories: [{ ...item, id: entityId }] }
          : type === 'focus_session' ? { focusHistory: [{ ...item, id: entityId }] }
            : { habitEvents: [{ ...item, id: entityId }] };
    const projected = projectState(input, { now, deviceId });
    const values = type === 'task'
      ? [...projected.values()].filter(value => ['task', 'step', 'reminder_rule'].includes(value.entityType))
      : type === 'habit'
        ? [...projected.values()].filter(value => ['habit', 'reminder_rule'].includes(value.entityType))
        : [projected.get(`${type}|${entityId}`)];
    for (const value of values) {
      if (!value) continue;
      const valueKey = `${value.entityType}|${value.entityId}`;
      if (seen.has(valueKey)) throw new Error(`同步实体编号重复：${value.entityType}/${value.entityId}`);
      seen.add(valueKey);
      entities.push(makeEntity({ accountId, deviceId, entityType: value.entityType, entityId: value.entityId,
        payload: value.payload, updatedAt: migrationTime(item, now), revision: 1 }));
    }
  };
  for (const [listName, type] of SYNCABLE_LISTS) (Array.isArray(source[listName]) ? source[listName] : []).forEach(add.bind(null, type));
  const stage = projectState({ stagePlan: source.stagePlan || {} }, { now, deviceId }).get('stage_plan|account');
  entities.push(makeEntity({ accountId, deviceId, entityType: 'stage_plan', entityId: 'account', payload: stage.payload,
    updatedAt: migrationTime(source.stagePlan, now), revision: 1 }));
  const preference = projectState({ preferences: source.preferences || {} }, { now, deviceId }).get('preference|account');
  entities.push(makeEntity({ accountId, deviceId, entityType: 'preference', entityId: 'account', payload: preference.payload,
    updatedAt: migrationTime(source.preferences, now), revision: 1 }));
  return { schemaVersion: V2_SCHEMA, accountId, deviceId, migratedFrom: Number(raw.schemaVersion || 0), migratedAt: timestamp(now), entities,
    sync: { cursor: 0, outbox: [], conflicts: [] } };
}

function projectV2ToV1(snapshot, { includeDeleted = false } = {}) {
  if (!snapshot || Number(snapshot.schemaVersion) !== V2_SCHEMA || !Array.isArray(snapshot.entities)) throw new Error('不是有效的猫狗日记 v2 数据快照');
  const state = { schemaVersion: 1, tasks: [], habits: [], categories: [], habitEvents: [], stagePlan: {}, focusHistory: [], preferences: { themeId: 'bg1' }, pendingReminders: [], reminderHistory: [], presence: { active: false } };
  const projected = applyEntities(state, snapshot.entities.filter(item => includeDeleted || !item.deletedAt));
  projected.habitCompletions = clone(projected.habitEvents || []);
  projected.schemaVersion = 1;
  return projected;
}

function entityFromLegacyItem(item, { accountId, deviceId, entityType, now = new Date() }) {
  assertAccountId(accountId); assertDeviceId(deviceId);
  const entityId = idFor(item, 0, entityType);
  const input = entityType === 'task' ? { tasks: [{ ...item, id: entityId }] }
    : entityType === 'habit' ? { habits: [{ ...item, id: entityId }] }
      : entityType === 'category' ? { categories: [{ ...item, id: entityId }] }
        : entityType === 'habit_event' ? { habitEvents: [{ ...item, id: entityId }] }
          : entityType === 'focus_session' ? { focusHistory: [{ ...item, id: entityId }] }
            : entityType === 'stage_plan' ? { stagePlan: item }
              : entityType === 'preference' ? { preferences: item }
                : entityType === 'reminder_rule' ? { reminderRules: [{ ...item, id: entityId }] } : {};
  const value = projectState(input, { now, deviceId }).get(`${entityType}|${entityId}`);
  if (!value) throw new Error(`无法转换同步实体：${entityType}`);
  return makeEntity({ accountId, deviceId, entityType, entityId, payload: value.payload, updatedAt: migrationTime(item, now), revision: 1 });
}

module.exports = { SYNCABLE_LISTS, migrateV1ToV2, projectV2ToV1, entityFromLegacyItem };
