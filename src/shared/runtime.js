// Pure scheduling rules. All times are supplied by the caller so long absences,
// suspend/resume and restart behaviour can be tested without waiting in real time.
const domain = require('./domain.js');
const crypto = require('node:crypto');
const productivity = require('./productivity.js');
const diary = require('./diary-v1.js');

function sourceKey(item) {
  if (item.taskId) return `${item.type}:task:${item.taskId}`;
  if (item.habitId) return `habit:${item.habitId}`;
  return item.key;
}

function blocksGentleReminders(state) {
  return state.focusTimer?.mode === 'focus' && ['running', 'paused'].includes(state.focusTimer.status);
}

function enqueue(state, reminder) {
  const source = sourceKey(reminder);
  if (state.pendingReminders.some((item) => sourceKey(item) === source)) return false;
  state.pendingReminders.push({ ...reminder, sourceKey: source });
  return true;
}

function removeMatching(state, predicate) {
  state.pendingReminders = state.pendingReminders.filter((item) => !predicate(item));
}

function isValid(state, reminder) {
  if (reminder.taskId) {
    const task = state.tasks.find((item) => item.id === reminder.taskId);
    if (!task || task.completed) return false;
    if (reminder.type === 'deadline') return Boolean(task.deadlineDate);
    return task.reminderActive && task.reminderMode === reminder.type;
  }
  if (reminder.habitId) return state.habits.some((item) => item.id === reminder.habitId && item.active);
  return reminder.type === 'focus' || reminder.type === 'test' || Boolean(reminder.key?.startsWith('capture-') || reminder.key?.startsWith('presence-queued-'));
}

function reconcile(state) {
  const seen = new Set();
  removeMatching(state, (item) => {
    const key = sourceKey(item);
    if (!item.key || !isValid(state, item) || seen.has(key)) return true;
    seen.add(key);
    return false;
  });
}

function pickNext(state, now = Date.now()) {
  if (state.presence?.active) return null;
  const eligible = state.pendingReminders.filter((item) =>
    !diary.deferredReason(state,item,now) &&
    (!item.availableAt || new Date(item.availableAt).getTime() <= now)
    && !(blocksGentleReminders(state) && ['interval', 'habit'].includes(item.type)));
  // A completed focus session gets its acknowledgement before releasing the
  // gentle reminders held during that session. Existing visible alerts stay put.
  return eligible.find((item) => item.type === 'focus') || eligible[0] || null;
}

function eventSubtitle(task, now = Date.now()) {
  const minutes = Math.ceil((new Date(task.dueAt).getTime() - now) / 60000);
  return minutes > 0 ? `还有 ${minutes} 分钟开始` : '已到计划时间';
}

function collectDue(state, now = Date.now()) {
  const items = [];
  const alreadyPending = (item) => state.pendingReminders.some((pending) => sourceKey(pending) === sourceKey(item));
  for (const task of state.tasks) {
    const identity = { type: task.reminderMode, taskId: task.id };
    if (task.completed || !task.reminderActive || !task.nextReminderAt || alreadyPending(identity)) continue;
    if (new Date(task.nextReminderAt).getTime() > now) continue;
    const scheduledAt = task.nextReminderAt;
    task.nextReminderAt = null;
    if (task.reminderMode === 'event') task.reminderFiredForDueAt = task.dueAt;
    items.push({
      ...identity, key: `task:${task.id}:${scheduledAt}`, title: task.title,
      eventPhase: task.reminderMode==='event' && new Date(task.dueAt).getTime()>now ? 'before' : 'due',
      subtitle: task.reminderMode === 'event' ? eventSubtitle(task, now) : `阶段检查 · 每 ${task.reminderMinutes} 分钟`,
      detail: task.notes || '停一下，检查进度，然后决定下一步。', dueAt: task.dueAt,
      occurredAt: new Date(now).toISOString()
    });
  }
  for (const habit of state.habits) {
    const identity = { type: 'habit', habitId: habit.id };
    if (!habit.active || !habit.nextReminderAt || alreadyPending(identity)) continue;
    if (new Date(habit.nextReminderAt).getTime() > now) continue;
    const scheduledAt = habit.nextReminderAt;
    if (!diary.habitAllowed(habit, now)) { habit.nextReminderAt=diary.nextHabit(habit,new Date(now));continue; }
    habit.nextReminderAt = null;
    habit.lastRemindedAt = new Date(now).toISOString();
    items.push({
      ...identity, key: `habit:${habit.id}:${scheduledAt}`, title: habit.title,
      subtitle: habit.scheduleType === 'daily' ? `每天 ${habit.time}` : `每隔 ${habit.intervalMinutes} 分钟`,
      detail: '这是你为自己设下的小约定。停一下，照顾身体，也照顾长期进步。',
      occurredAt: new Date(now).toISOString()
    });
  }
  return items;
}

function acknowledge(state, key, action, minutes, now = Date.now()) {
  const reminder = state.pendingReminders.find((item) => item.key === key);
  if (!reminder || !['dismiss', 'complete', 'snooze', 'start-break', 'start-focus'].includes(action)) return false;
  const task = state.tasks.find((item) => item.id === reminder.taskId);
  const habit = state.habits.find((item) => item.id === reminder.habitId);
  diary.history(state,reminder,action,now);
  if (action === 'snooze') {
    if (!task && !habit) return false;
    const delay = Math.min(240, Math.max(1, Number(minutes) || 10));
    reminder.availableAt = new Date(now + delay * 60000).toISOString();
    // A fresh interaction token makes late double-clicks harmless.
    reminder.key = `snooze:${crypto.randomUUID()}`;
    if (task && reminder.type !== 'deadline') task.nextReminderAt = reminder.availableAt;
    if (habit) habit.nextReminderAt = reminder.availableAt;
    return true;
  }
  removeMatching(state, (item) => item.key === key);
  if (task && action === 'complete') {
    if (state.focusTimer?.taskId === task.id && state.focusTimer.status !== 'idle') {
      productivity.recordSession(state, 'interrupted', now);
      updateFocus(state.focusTimer, { action: 'stop' }, now);
    }
    task.completed = true;
    task.completedAt = new Date(now).toISOString();
    task.steps = (task.steps || []).map((step) => ({ ...step, completed: true }));
    task.nextReminderAt = null;
    removeMatching(state, (item) => item.taskId === task.id);
  } else if (task && reminder.type === 'interval' && task.reminderActive) {
    task.nextReminderAt = new Date(now + task.reminderMinutes * 60000).toISOString();
  } else if(task && reminder.type==='event' && reminder.eventPhase==='before' && new Date(task.dueAt).getTime()>now) {
    // Acknowledging the advance alert doesn't consume the appointment itself.
    // If it stays open, source deduplication continues to keep a single card.
    task.nextReminderAt=task.dueAt;
  }
  if (habit) {
    if (action === 'complete') {
      habit.lastCompletedAt = new Date(now).toISOString();
      habit.completionCount = (Number(habit.completionCount) || 0) + 1;
    }
    habit.nextReminderAt = diary.nextHabit(habit, new Date(now));
  }
  return true;
}

function normalizeFocus(timer = {}) {
  const mode = ['focus', 'shortBreak', 'longBreak'].includes(timer.mode) ? timer.mode : 'focus';
  const defaults = { focus: 25, shortBreak: 5, longBreak: 15 };
  const duration = Math.min(180, Math.max(1, Math.round(Number(timer.durationMinutes) || defaults[mode])));
  let status = ['idle', 'running', 'paused'].includes(timer.status) ? timer.status : 'idle';
  const endsAt = timer.endsAt && Number.isFinite(new Date(timer.endsAt).getTime()) ? timer.endsAt : null;
  if (status === 'running' && !endsAt) status = 'idle';
  const remaining = Number(timer.pausedRemainingSeconds);
  return {
    ...productivity.normalizeTracking({ ...timer, status }),
    mode, durationMinutes: duration, status, endsAt: status === 'running' ? endsAt : null,
    pausedRemainingSeconds: Number.isFinite(remaining) ? Math.max(0, Math.min(duration * 60, remaining)) : duration * 60,
    sessionsCompleted: Math.max(0, Math.floor(Number(timer.sessionsCompleted) || 0)),
    sessionId: status === 'idle' ? null : String(timer.sessionId || crypto.randomUUID()),
    screenId: domain.SCREEN_IDS.includes(timer.screenId) ? timer.screenId : null
  };
}

function updateFocus(timer, command, now = Date.now()) {
  const action = command?.action;
  if (!['select', 'start', 'pause', 'reset', 'stop'].includes(action)) throw new Error('无效的计时操作');
  if (command.sessionId !== undefined && command.sessionId !== timer.sessionId) return false;
  if (action === 'select') {
    if (timer.status !== 'idle') throw new Error('请先结束当前一轮，再修改模式或时长');
    const next = normalizeFocus({ mode: command.mode, durationMinutes: command.durationMinutes, sessionsCompleted: timer.sessionsCompleted });
    Object.assign(timer, next);
  } else if (action === 'start' && timer.status !== 'running') {
    const remaining = timer.status === 'paused' ? Math.max(0, timer.pausedRemainingSeconds) : timer.durationMinutes * 60;
    if (timer.status === 'idle') timer.sessionId = crypto.randomUUID();
    timer.status = 'running';
    timer.endsAt = new Date(now + remaining * 1000).toISOString();
  } else if (action === 'pause' && timer.status === 'running') {
    timer.pausedRemainingSeconds = domain.getFocusRemainingSeconds(timer, now);
    timer.status = 'paused';
    timer.endsAt = null;
  } else if (action === 'reset' || action === 'stop') {
    timer.status = 'idle';
    timer.endsAt = null;
    timer.sessionId = null;
    timer.screenId = null;
    timer.taskId = null;
    timer.taskTitle = '';
    timer.startedAt = null;
    timer.activeStartedAt = null;
    timer.segments = [];
    timer.pausedRemainingSeconds = timer.durationMinutes * 60;
  }
  return true;
}

function finishFocus(state, now = Date.now()) {
  const timer = state.focusTimer;
  if (timer.status !== 'running' || domain.getFocusRemainingSeconds(timer, now) > 0) return null;
  const { mode, sessionId, screenId, taskTitle } = timer;
  productivity.recordSession(state, 'completed', now);
  if (mode === 'focus') timer.sessionsCompleted += 1;
  updateFocus(timer, { action: 'reset' }, now);
  return {
    key: `focus:${sessionId}`, type: 'focus', mode, screenId,
    title: mode === 'focus' ? '专注完成啦！' : '休息结束啦！',
    subtitle: mode === 'focus' ? '这一轮注意力，你守住了。' : '准备好，开始下一轮。',
    detail: mode === 'focus' ? `${taskTitle ? `刚才专注于「${taskTitle}」。` : ''}活动一下身体，让下一轮更轻松。` : '只看下一步，然后开始。',
    occurredAt: new Date(now).toISOString()
  };
}

module.exports = { sourceKey, blocksGentleReminders, enqueue, removeMatching, reconcile, pickNext, eventSubtitle, collectDue, acknowledge, normalizeFocus, updateFocus, finishFocus };
