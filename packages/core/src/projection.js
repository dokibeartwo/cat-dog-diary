'use strict';

/*
 * The desktop state contains a sizeable amount of presentation/runtime data.
 * This module is the one place where that state crosses the sync boundary.
 * Keep this file dependency free: it is bundled by React Native as well as
 * loaded by Node in the Windows client.
 */
const {
  clone, validIso, timestamp, assertEntityType, assertEntityId
} = require('./schema');

const ENTITY_TYPES = Object.freeze([
  'task', 'step', 'habit', 'habit_event', 'category', 'stage_plan',
  'reminder_rule', 'focus_session', 'preference'
]);

const TASK_FIELDS = Object.freeze([
  'title', 'notes', 'dueAt', 'deadlineDate', 'deadlineReminderDays',
  'priority', 'scheduleMode', 'reminderMode', 'reminderMinutes',
  'reminderActive', 'planDate', 'priorityDate', 'category',
  'estimateMinutes', 'recurrence', 'recurrenceNextId',
  'reminderPresentation', 'urgentReminder', 'seriesId', 'completed',
  'completedAt', 'createdAt', 'inStage'
]);
const STEP_FIELDS = Object.freeze(['taskId', 'title', 'completed', 'completedAt', 'position']);
const HABIT_FIELDS = Object.freeze([
  'title', 'icon', 'scheduleType', 'intervalMinutes', 'time', 'active',
  'days', 'windowEnabled', 'windowStart', 'windowEnd',
  'reminderPresentation', 'urgentReminder', 'createdAt'
]);
const FOCUS_FIELDS = Object.freeze([
  'taskId', 'taskTitle', 'startedAt', 'endedAt', 'outcome', 'durationSeconds', 'segments'
]);

const LOCAL_TASK_FIELDS = Object.freeze([
  'nextReminderAt', 'reminderFiredForDueAt', 'deadlineLastRemindedDate'
]);
const LOCAL_HABIT_FIELDS = Object.freeze(['nextReminderAt', 'lastCompletedAt', 'completionCount']);

function own(source, key) { return Object.prototype.hasOwnProperty.call(source || {}, key); }

function cleanObject(source, fields) {
  const input = source && typeof source === 'object' ? source : {};
  const output = {};
  for (const field of fields) {
    if (own(input, field)) output[field] = clone(input[field]);
  }
  return output;
}

function validId(value, fallback) {
  return typeof value === 'string' && /^[\w:-]{1,128}$/.test(value) ? value : fallback;
}

function stableId(prefix, value) {
  const text = String(value || '');
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function entityTime(value, fallback) {
  return validIso(value) ? new Date(value).toISOString() : timestamp(fallback);
}

function entity(type, id, payload, options = {}) {
  assertEntityType(type);
  const entityId = validId(id, null);
  if (!entityId) throw new Error(`同步实体编号无效：${type}`);
  return {
    entityType: type,
    entityId,
    payload: clone(payload) || {},
    updatedAt: entityTime(options.updatedAt, options.now),
    deletedAt: options.deletedAt ? entityTime(options.deletedAt, options.now) : null,
    revision: Number.isInteger(options.revision) && options.revision >= 0 ? options.revision : 0,
    deviceId: options.deviceId || null,
    lastMutationId: options.lastMutationId || null
  };
}

function taskPayload(task) { return cleanObject(task, TASK_FIELDS); }
function stepPayload(step, taskId) {
  const value = cleanObject(step, STEP_FIELDS);
  value.taskId = taskId || value.taskId || null;
  return value;
}
function habitPayload(habit) { return cleanObject(habit, HABIT_FIELDS); }

function reminderRuleEntities(state, now) {
  const result = [];
  for (const rule of Array.isArray(state?.reminderRules) ? state.reminderRules : []) {
    const id = validId(rule?.id, null);
    if (!id) continue;
    result.push(entity('reminder_rule', id, cleanObject(rule, [
      'targetType', 'targetId', 'mode', 'minutes', 'time', 'active', 'presentation', 'urgent'
    ]), { now, updatedAt: rule.updatedAt || rule.createdAt }));
  }
  for (const task of Array.isArray(state?.tasks) ? state.tasks : []) {
    if (!task || !task.id || !task.reminderMode || task.reminderMode === 'none') continue;
    result.push(entity('reminder_rule', `task:${task.id}`, {
      targetType: 'task', targetId: task.id, mode: task.reminderMode,
      minutes: Number(task.reminderMinutes) || 0, active: task.reminderActive !== false,
      presentation: task.reminderPresentation || 'fullscreen',
      urgent: task.urgentReminder === true
    }, { now, updatedAt: task.updatedAt || task.createdAt }));
  }
  for (const habit of Array.isArray(state?.habits) ? state.habits : []) {
    if (!habit || !habit.id || habit.active === false) continue;
    result.push(entity('reminder_rule', `habit:${habit.id}`, {
      targetType: 'habit', targetId: habit.id, mode: habit.scheduleType || 'interval',
      minutes: Number(habit.intervalMinutes) || 0, time: habit.time || null,
      active: habit.active !== false, presentation: habit.reminderPresentation || 'fullscreen',
      urgent: habit.urgentReminder === true
    }, { now, updatedAt: habit.updatedAt || habit.createdAt }));
  }
  return result;
}

/**
 * Return durable entities as a Map keyed by `entityType|entityId`.
 * Values intentionally include transport metadata but payload is allowlisted.
 */
function projectState(state = {}, { now = new Date(), deviceId = null } = {}) {
  const result = new Map();
  const add = (type, id, payload, source) => {
    const value = entity(type, id, payload, { now, deviceId, updatedAt: source?.updatedAt || source?.createdAt });
    result.set(`${type}|${value.entityId}`, value);
  };

  for (const task of Array.isArray(state.tasks) ? state.tasks : []) {
    if (!task || typeof task !== 'object') continue;
    const id = validId(task.id, null);
    if (!id) continue;
    add('task', id, taskPayload(task), task);
    for (const step of Array.isArray(task.steps) ? task.steps : []) {
      const stepId = validId(step?.id, null);
      if (stepId) add('step', stepId, stepPayload(step, id), step);
    }
  }
  for (const habit of Array.isArray(state.habits) ? state.habits : []) {
    const id = validId(habit?.id, null);
    if (id) add('habit', id, habitPayload(habit), habit);
  }
  for (const event of Array.isArray(state.habitEvents) ? state.habitEvents : []) {
    const id = validId(event?.id, stableId('event', `${event?.habitId || ''}|${event?.occurredAt || event?.completedAt || ''}`));
    if (id) add('habit_event', id, cleanObject(event, ['habitId', 'occurredAt', 'completed', 'source']), event);
  }
  // Older desktop builds called this list habitCompletions. It is an event
  // list, not a mutable completionCount, so it remains safe to merge.
  for (const event of Array.isArray(state.habitCompletions) ? state.habitCompletions : []) {
    const id = validId(event?.id, stableId('event', `${event?.habitId || ''}|${event?.occurredAt || event?.completedAt || ''}`));
    if (id && !result.has(`habit_event|${id}`)) add('habit_event', id, cleanObject(event, ['habitId', 'occurredAt', 'completed', 'source']), event);
  }
  for (const category of Array.isArray(state.categories) ? state.categories : []) {
    const id = validId(category?.id || (typeof category === 'string' ? category : null), stableId('category', typeof category === 'string' ? category : category?.name));
    if (id) add('category', id, typeof category === 'string' ? { name: category } : cleanObject(category, ['name', 'color', 'icon', 'position']), category);
  }
  add('stage_plan', 'account', cleanObject(state.stagePlan, ['start', 'end', 'dailyCapacity', 'dailyMinutes', 'workdaysOnly', 'lastPlannedAt']), state.stagePlan);
  for (const focus of Array.isArray(state.focusHistory) ? state.focusHistory : []) {
    const id = validId(focus?.id || focus?.sessionId, null);
    if (id) add('focus_session', id, cleanObject(focus, FOCUS_FIELDS), focus);
  }
  const themeId = typeof state.preferences?.themeId === 'string' ? state.preferences.themeId : 'bg1';
  add('preference', 'account', { themeId }, state.preferences);
  for (const rule of reminderRuleEntities(state, now)) result.set(`reminder_rule|${rule.entityId}`, rule);
  return result;
}

function entitiesArray(entities) {
  if (entities instanceof Map) return [...entities.values()];
  if (Array.isArray(entities)) return entities;
  if (entities && typeof entities === 'object') return Object.values(entities);
  return [];
}

function validateEntity(input) {
  if (!input || typeof input !== 'object') throw new Error('同步实体格式无效');
  assertEntityType(input.entityType);
  assertEntityId(input.entityId);
  if (!input.payload || typeof input.payload !== 'object' || Array.isArray(input.payload)) throw new Error('同步实体内容无效');
  if (input.updatedAt && !validIso(input.updatedAt)) throw new Error('同步实体更新时间无效');
  if (input.deletedAt && !validIso(input.deletedAt)) throw new Error('同步实体删除时间无效');
  return input;
}

function mergeLocal(item, fields) {
  const output = {};
  for (const field of fields) if (own(item, field)) output[field] = clone(item[field]);
  return output;
}

/** Apply remote durable entities while retaining device-local runtime state. */
function applyEntities(state = {}, entities) {
  const next = clone(state) || {};
  next.tasks = Array.isArray(next.tasks) ? next.tasks : [];
  next.habits = Array.isArray(next.habits) ? next.habits : [];
  next.focusHistory = Array.isArray(next.focusHistory) ? next.focusHistory : [];
  // A page is sorted by server cursor, not by parent/child dependency.
  const order = { task: 0, habit: 0, step: 1, habit_event: 1, reminder_rule: 2 };
  const list = entitiesArray(entities).map(validateEntity).sort((a, b) => (order[a.entityType] ?? 1) - (order[b.entityType] ?? 1));

  for (const item of list) {
    const { entityType: type, entityId: id, payload, deletedAt } = item;
    if (type === 'task') {
      const index = next.tasks.findIndex(value => value?.id === id);
      if (deletedAt) {
        if (index >= 0) next.tasks.splice(index, 1);
        // Steps are child entities. A task tombstone must not leave an
        // unreachable child that could be resurrected by an older device.
        for (const task of next.tasks) {
          if (Array.isArray(task.steps)) task.steps = task.steps.filter(step => step?.taskId !== id);
        }
        continue;
      }
      const local = index >= 0 ? next.tasks[index] : {};
      next.tasks[index >= 0 ? index : next.tasks.length] = {
        ...taskPayload(payload), ...mergeLocal(local, LOCAL_TASK_FIELDS), steps: clone(local.steps || []), id
      };
    } else if (type === 'step') {
      const taskId = validId(payload.taskId, null);
      if (!taskId) continue;
      const task = next.tasks.find(value => value?.id === taskId);
      if (!task) continue;
      task.steps = Array.isArray(task.steps) ? task.steps : [];
      const index = task.steps.findIndex(value => value?.id === id);
      if (deletedAt) { if (index >= 0) task.steps.splice(index, 1); }
      else task.steps[index >= 0 ? index : task.steps.length] = { ...payload, id };
    } else if (type === 'habit') {
      const index = next.habits.findIndex(value => value?.id === id);
      if (deletedAt) { if (index >= 0) next.habits.splice(index, 1); continue; }
      const local = index >= 0 ? next.habits[index] : {};
      next.habits[index >= 0 ? index : next.habits.length] = { ...habitPayload(payload), ...mergeLocal(local, LOCAL_HABIT_FIELDS), id };
    } else if (type === 'habit_event') {
      next.habitEvents = Array.isArray(next.habitEvents) ? next.habitEvents : [];
      const index = next.habitEvents.findIndex(value => value?.id === id);
      if (deletedAt) { if (index >= 0) next.habitEvents.splice(index, 1); }
      else next.habitEvents[index >= 0 ? index : next.habitEvents.length] = { ...payload, id };
    } else if (type === 'category') {
      next.categories = Array.isArray(next.categories) ? next.categories : [];
      const index = next.categories.findIndex(value => (typeof value === 'string' ? value : value?.id) === id);
      if (deletedAt) { if (index >= 0) next.categories.splice(index, 1); }
      else next.categories[index >= 0 ? index : next.categories.length] = { ...payload, id };
    } else if (type === 'stage_plan') {
      if (!deletedAt) next.stagePlan = { ...(next.stagePlan || {}), ...payload };
    } else if (type === 'focus_session') {
      const index = next.focusHistory.findIndex(value => value?.id === id || value?.sessionId === id);
      if (deletedAt) { if (index >= 0) next.focusHistory.splice(index, 1); }
      else next.focusHistory[index >= 0 ? index : next.focusHistory.length] = { ...payload, id };
    } else if (type === 'preference') {
      if (!deletedAt && own(payload, 'themeId')) next.preferences = { ...(next.preferences || {}), themeId: payload.themeId };
    } else if (type === 'reminder_rule') {
      next.reminderRules = Array.isArray(next.reminderRules) ? next.reminderRules : [];
      const index = next.reminderRules.findIndex(value => value?.id === id);
      // These IDs are legacy projections of the task/habit fields, not a
      // second authority. An older rule must never undo a new pause/edit.
      if (id === `task:${payload.targetId}` || id === `habit:${payload.targetId}`) {
        if (index >= 0) next.reminderRules.splice(index, 1);
        continue;
      }
      if (deletedAt) {
        if (index >= 0) next.reminderRules.splice(index, 1);
        const targetId = validId(payload.targetId, null);
        if (payload.targetType === 'task' && targetId) {
          const task = next.tasks.find(value => value?.id === targetId);
          if (task) task.reminderActive = false;
        } else if (payload.targetType === 'habit' && targetId) {
          const habit = next.habits.find(value => value?.id === targetId);
          if (habit) habit.active = false;
        }
      }
      else {
        next.reminderRules[index >= 0 ? index : next.reminderRules.length] = { ...payload, id };
        const targetType = payload.targetType;
        const targetId = validId(payload.targetId, null);
        if (targetType === 'task' && targetId) {
          const task = next.tasks.find(value => value?.id === targetId);
          if (task) Object.assign(task, {
            reminderMode: payload.mode || task.reminderMode || 'none',
            reminderMinutes: Number(payload.minutes) || task.reminderMinutes,
            reminderActive: payload.active !== false,
            reminderPresentation: payload.presentation || task.reminderPresentation,
            urgentReminder: payload.urgent === true
          });
        } else if (targetType === 'habit' && targetId) {
          const habit = next.habits.find(value => value?.id === targetId);
          if (habit) Object.assign(habit, {
            scheduleType: payload.mode || habit.scheduleType,
            intervalMinutes: Number(payload.minutes) || habit.intervalMinutes,
            time: payload.time || habit.time,
            active: payload.active !== false,
            reminderPresentation: payload.presentation || habit.reminderPresentation,
            urgentReminder: payload.urgent === true
          });
        }
      }
    }
  }
  for (const task of next.tasks) if (Array.isArray(task.steps)) task.steps.sort((a, b) => (a.position || 0) - (b.position || 0));
  for (const habit of next.habits) {
    const events = (next.habitEvents || []).filter(event => event.habitId === habit.id && event.completed !== false);
    if (events.length) {
      habit.completionCount = Math.max(Number(habit.completionCount) || 0, events.length);
      habit.lastCompletedAt = events.map(event => event.occurredAt).filter(Boolean).sort().at(-1) || habit.lastCompletedAt;
    }
  }
  return next;
}

module.exports = {
  ENTITY_TYPES, TASK_FIELDS, STEP_FIELDS, HABIT_FIELDS, FOCUS_FIELDS,
  LOCAL_TASK_FIELDS, LOCAL_HABIT_FIELDS, stableId, cleanObject, taskPayload, stepPayload,
  habitPayload, projectState, applyEntities, validateEntity
};
