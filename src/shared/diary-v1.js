(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./domain') : root.TaskDomain);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.DiaryV1 = api;
})(typeof window !== 'undefined' ? window : globalThis, function (domain) {
  'use strict';
  const SCHEMA = 1;
  const clamp = (n, lo, hi, fallback) => Number.isFinite(Number(n)) ? Math.min(hi, Math.max(lo, Math.round(Number(n)))) : fallback;
  const date = (v) => domain.normalizeLocalDate(v);
  const time = (v, fallback = '09:00') => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(v)) ? v : fallback;
  const presentation = (v) => v === 'light' ? 'light' : 'fullscreen';
  const iso = (v) => v && Number.isFinite(new Date(v).getTime()) ? new Date(v).toISOString() : null;

  function preferences(raw = {}) {
    return {
      remindersEnabled: raw.remindersEnabled !== false,
      quietEnabled: raw.quietEnabled === true,
      quietStart: time(raw.quietStart, '22:00'), quietEnd: time(raw.quietEnd, '08:00'),
      urgentThroughQuiet: raw.urgentThroughQuiet === true,
      quickShortcutEnabled: raw.quickShortcutEnabled !== false,
      habitsCollapsed: raw.habitsCollapsed === true,
      onboardingDone: raw.onboardingDone === true
    };
  }
  function recurrence(raw) {
    const kind = ['daily', 'weekdays', 'weekly', 'monthly'].includes(raw?.kind) ? raw.kind : 'none';
    return { kind, interval: clamp(raw?.interval ?? 1, 1, 365, 1), anchorDay: clamp(raw?.anchorDay ?? 0, 0, 31, 0) };
  }
  function taskFields(raw = {}) {
    return {
      planDate: date(raw.planDate), priorityDate: date(raw.priorityDate),
      category: String(raw.category || '').trim().slice(0, 30),
      estimateMinutes: clamp(raw.estimateMinutes ?? 25, 1, 1440, 25),
      reminderPresentation: presentation(raw.reminderPresentation),
      urgentReminder: raw.urgentReminder === true,
      recurrence: recurrence(raw.recurrence),
      recurrenceNextId: typeof raw.recurrenceNextId === 'string' ? raw.recurrenceNextId : null,
      seriesId: typeof raw.seriesId === 'string' ? raw.seriesId : null
    };
  }
  function habitFields(raw = {}) {
    return { reminderPresentation: presentation(raw.reminderPresentation),
      urgentReminder: raw.urgentReminder === true,
      days: Array.isArray(raw.days) ? [...new Set(raw.days.filter(n => Number.isInteger(n) && n >= 0 && n <= 6))] : [0,1,2,3,4,5,6],
      windowEnabled: raw.windowEnabled === true,
      windowStart: time(raw.windowStart, '09:00'), windowEnd: time(raw.windowEnd, '18:00') };
  }
  function migrate(raw) {
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.tasks)) throw Error('不是有效的猫狗日记数据文件');
    if (raw.habits !== undefined && !Array.isArray(raw.habits)) throw Error('习惯数据不是有效列表，原数据未更改');
    if (raw.trash !== undefined && !Array.isArray(raw.trash)) throw Error('回收站数据不是有效列表，原数据未更改');
    const version=Number(raw.schemaVersion ?? 0);
    if (!Number.isInteger(version) || version<0)throw Error('数据版本标识无效，原数据未更改');
    if (version > SCHEMA) throw Error('这份数据来自更新版本，请先升级软件，不能用旧版覆盖');
    const next = structuredClone(raw);
    const normalizeTask = (item,seen) => {
      if (!item || typeof item.id !== 'string' || !/^[\w:-]{1,128}$/.test(item.id) || seen.has(item.id) || typeof item.title !== 'string') throw Error('任务数据不完整或编号重复（包括回收站）');
      seen.add(item.id); Object.assign(item, taskFields(item));
      item.priority=['high','normal','low'].includes(item.priority)?item.priority:'normal';
      item.completed=item.completed===true;
      item.notes=String(item.notes ?? '');
    };
    const seen = new Set();
    for (const item of next.tasks)normalizeTask(item,seen);
    next.schemaVersion = SCHEMA;
    next.habits = Array.isArray(next.habits) ? next.habits.map(item => ({ ...item, ...habitFields(item) })) : [];
    const habitIds=new Set();
    for(const habit of next.habits){
      if(typeof habit.id!=='string'||!/^[\w:-]{1,128}$/.test(habit.id)||habitIds.has(habit.id))throw Error('习惯编号无效或重复');
      if(habit.time!==undefined && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(habit.time)))throw Error('习惯提醒时间无效，原数据未更改');
      habitIds.add(habit.id);
    }
    next.preferences = { ...next.preferences, ...preferences(next.preferences), onboardingDone: raw.preferences?.onboardingDone ?? true };
    next.reminderHistory = Array.isArray(next.reminderHistory) ? next.reminderHistory.filter(item => item && iso(item.handledAt)).slice(-1000) : [];
    next.trash = Array.isArray(next.trash) ? next.trash : [];
    const trashIds=new Set();
    for(const entry of next.trash) {
      if(!entry || !iso(entry.deletedAt))throw Error('回收站记录不完整，原数据未更改');
      normalizeTask(entry.task,trashIds);
    }
    return next;
  }
  function minuteOfDay(now) { return now.getHours() * 60 + now.getMinutes(); }
  function inTimeWindow(start, end, now) {
    const toMinutes = v => Number(v.slice(0,2))*60 + Number(v.slice(3));
    const a = toMinutes(start), b = toMinutes(end), value = minuteOfDay(now);
    if (a === b) return true;
    return a < b ? value >= a && value < b : value >= a || value < b;
  }
  function quiet(prefs, now = new Date()) {
    return prefs.quietEnabled && inTimeWindow(prefs.quietStart, prefs.quietEnd, new Date(now));
  }
  function habitAllowed(habit, now = new Date()) {
    const config = habitFields(habit), instant = new Date(now);
    return config.days.includes(instant.getDay()) && (!config.windowEnabled || inTimeWindow(config.windowStart, config.windowEnd, instant));
  }
  function nextHabit(habit, now = new Date()) {
    if (habit.active === false) return null;
    const config = habitFields(habit);
    if (!config.days.length) return null;
    let candidate = new Date(domain.calculateNextHabitReminderAt(habit, new Date(now)));
    if (habit.scheduleType === 'daily') {
      for (let n = 0; n < 8; n++, candidate.setDate(candidate.getDate()+1)) {
        if (habitAllowed(habit, candidate)) return candidate.toISOString();
      }
      return null;
    }
    // A bounded minute scan handles night shifts, weekends and DST locally.
    for (let n = 0; n < 8*1440; n++, candidate.setMinutes(candidate.getMinutes()+1)) {
      if (habitAllowed(habit, candidate)) return candidate.toISOString();
    }
    return null;
  }
  function source(state, item) {
    return item.taskId ? state.tasks.find(t => t.id === item.taskId) : item.habitId ? state.habits.find(h => h.id === item.habitId) : null;
  }
  function deferredReason(state, item, now = Date.now()) {
    if (state.presence?.active) return '离席中，回来后提醒';
    if (item.availableAt && new Date(item.availableAt).getTime() > now) return '已稍后提醒';
    if (item.type === 'focus' || item.type === 'test') return '';
    if (state.preferences?.remindersEnabled === false) return '提醒总开关已暂停';
    const origin = source(state, item);
    if (quiet(state.preferences || {}, now) && !(origin?.urgentReminder && state.preferences.urgentThroughQuiet)) return '勿扰时段，结束后提醒';
    if (state.focusTimer?.mode === 'focus' && ['running','paused'].includes(state.focusTimer.status) && ['habit','interval'].includes(item.type)) return '专注期间暂缓';
    if (item.habitId && origin && !habitAllowed(origin, now)) return '等待启用的日期与时段';
    return '';
  }
  function reminderStyle(state, item) { return presentation(source(state, item)?.reminderPresentation || item.presentation); }
  function history(state, reminder, action, now = Date.now()) {
    state.reminderHistory ||= [];
    if (state.reminderHistory.some(r => r.key === reminder.key && r.action === action)) return;
    state.reminderHistory.push({ key: reminder.key, sourceKey: reminder.sourceKey, taskId: reminder.taskId || null, habitId: reminder.habitId || null,
      title: reminder.title, type: reminder.type, action, occurredAt: reminder.occurredAt || null, handledAt: new Date(now).toISOString() });
    state.reminderHistory = state.reminderHistory.slice(-1000);
  }
  function nextOccurrence(task, now = new Date()) {
    const rule = recurrence(task.recurrence);
    if (rule.kind === 'none') return null;
    const base = task.dueAt ? new Date(task.dueAt) : date(task.planDate) ? new Date(task.planDate+'T00:00:00') : null;
    if (!base || !Number.isFinite(base.getTime())) return null;
    const cutoff = task.dueAt ? new Date(now) : domain.startOfDay(now);
    const anchor = rule.anchorDay || base.getDate();
    for (let n = 0; n < 36600; n++) {
      if (rule.kind === 'monthly') {
        base.setDate(1); base.setMonth(base.getMonth()+rule.interval);
        base.setDate(Math.min(anchor, new Date(base.getFullYear(), base.getMonth()+1, 0).getDate()));
      } else if (rule.kind === 'weekdays') {
        for(let remaining=rule.interval;remaining>0;) {
          base.setDate(base.getDate()+1);
          if(![0,6].includes(base.getDay()))remaining--;
        }
      } else {
        base.setDate(base.getDate() + (rule.kind === 'weekly' ? 7*rule.interval : rule.interval));
      }
      if (base > cutoff || (!task.dueAt && base.getTime() === cutoff.getTime())) return { dueAt: task.dueAt ? base.toISOString() : null, planDate: task.dueAt ? null : domain.toLocalDateInput(base), anchorDay: anchor };
    }
    return null;
  }
  function spawnNext(state, task, makeId, now = new Date()) {
    if (!task.completed || task.recurrenceNextId) return null;
    const next = nextOccurrence(task, now);
    if (!next) return null;
    // Both offline devices must create the SAME next occurrence and steps.
    const stableId = text => { let a=2166136261,b=5381; for(const ch of text){a=Math.imul(a^ch.charCodeAt(0),16777619);b=Math.imul(b,33)^ch.charCodeAt(0);}return `${(a>>>0).toString(16)}${(b>>>0).toString(16)}`; };
    const id = `occ-${stableId(`${task.seriesId||task.id}|${next.dueAt||next.planDate}`)}`; task.recurrenceNextId = id;
    if(state.tasks.some(item=>item.id===id))return null;
    const child = { ...structuredClone(task), id, ...next, recurrence: { ...task.recurrence, anchorDay: next.anchorDay },
      seriesId: task.seriesId || task.id, recurrenceNextId: null, completed: false, completedAt: null, createdAt: new Date(now).toISOString(),
      priorityDate: null, deadlineDate: null, deadlineLastRemindedDate: null, nextReminderAt: null, reminderFiredForDueAt: null,
      steps: (task.steps || []).map(step => ({ ...step, id: `step-${stableId(`${id}|${step.id}`)}`, completed: false, completedAt:null })) };
    delete child.anchorDay;
    state.tasks.push(child); return child;
  }
  function plan(tasks, request, now = new Date()) {
    const start = date(request.start), end = date(request.end);
    if (!start || !end || start > end) throw Error('请填写正确的阶段起止日期');
    const span = (new Date(end+'T12:00:00')-new Date(start+'T12:00:00'))/86400000;
    if (span > 366) throw Error('单次排期最多一年');
    const dailyMinutes = clamp(request.dailyMinutes ?? 120, 15, 1440, 120);
    const dailyCapacity = clamp(request.dailyCapacity ?? 3, 1, 12, 3);
    const days = domain.calendarDays(start+'T00:00:00', end+'T00:00:00').filter(d => d >= domain.startOfDay(now) && (!request.workdaysOnly || ![0,6].includes(d.getDay())));
    if (!days.length) throw Error('阶段内没有可安排的未来日期');
    const load = new Map(days.map(d => [domain.toLocalDateInput(d), { minutes:0, count:0 }]));
    const eligible = task => !task.completed && task.inStage !== false && task.scheduleMode !== 'ongoing' && (!task.dueAt && !task.planDate || task.scheduleMode === 'auto');
    const reserve = (task,direction) => {
      const key = task.planDate || (task.dueAt && domain.toLocalDateInput(task.dueAt));
      if (load.has(key)) { load.get(key).minutes += direction*taskFields(task).estimateMinutes; load.get(key).count+=direction; }
    };
    // Failed rescheduling keeps its old date, so its existing load must remain reserved.
    for (const task of tasks.filter(t => !t.completed))reserve(task,1);
    const ordered = tasks.filter(eligible).sort((a,b) => (a.deadlineDate || '9999').localeCompare(b.deadlineDate || '9999') || ({high:0,normal:1,low:2}[a.priority] ?? 1)-({high:0,normal:1,low:2}[b.priority] ?? 1) || String(a.createdAt).localeCompare(String(b.createdAt)));
    const updates = [], conflicts = [];
    for (const task of ordered) {
      const minutes = taskFields(task).estimateMinutes;
      const previousTime = task.dueAt ? new Date(task.dueAt).toTimeString().slice(0,5) : null;
      // Keep an explicitly timed reminder timed. Others get a date, not a fake 18:00 deadline.
      const timed = task.reminderMode === 'event';
      reserve(task,-1);
      const target = [...load.keys()].find(day => (!task.deadlineDate || day <= task.deadlineDate)
        && (!timed || new Date(day+'T'+(previousTime || '09:00')+':00')>now)
        && load.get(day).minutes+minutes <= dailyMinutes && load.get(day).count < dailyCapacity);
      if (!target) { reserve(task,1);conflicts.push({ id:task.id, title:task.title, reason:task.deadlineDate ? '截止前没有足够的可用容量或未来执行时间' : '阶段内没有足够的可用容量或未来执行时间' }); continue; }
      updates.push({ id:task.id, dueAt:timed ? new Date(target+'T'+(previousTime || '09:00')+':00').toISOString() : null, planDate:timed ? null : target, scheduleMode:'auto', estimateMinutes:minutes });
      load.get(target).minutes+=minutes; load.get(target).count++;
    }
    return { updates, conflicts, dailyMinutes, dailyCapacity, start, end, workdaysOnly:request.workdaysOnly === true, loads:[...load].map(([day,value]) => ({day,...value})) };
  }
  function parseCapture(text, now = new Date()) {
    const original = String(text || '').trim().slice(0,240);
    let title = original, planDate = null, clock = null, reminderMinutes = null;
    const notes = [];
    const consume = fragment => { title = title.replace(fragment, ' ').replace(/^[，,\s]+|[，,\s]+$/g,'').replace(/\s+/g,' '); };
    const relative = /(今天|明天|后天)/.exec(title);
    const weekday = /(下周|本周|周)([一二三四五六日天])/.exec(title);
    if (relative) {
      const d = new Date(now); d.setDate(d.getDate()+{今天:0,明天:1,后天:2}[relative[0]]); planDate=domain.toLocalDateInput(d);consume(relative[0]);
    } else if (weekday) {
      const n = '一二三四五六日天'.indexOf(weekday[2]);
      const d = domain.startOfWeek(now); d.setDate(d.getDate()+Math.min(n,6)+(weekday[1]==='下周'?7:0));
      if (weekday[1]==='周' && d<domain.startOfDay(now)) d.setDate(d.getDate()+7);
      planDate=domain.toLocalDateInput(d);consume(weekday[0]);
    }
    const match = /(上午|下午|晚上|早上|中午)?\s*(\d{1,2})(?:[:：](\d{2})|点(?:(\d{1,2})分?|半)?)/.exec(title);
    if (match) {
      let hour=Number(match[2]), minute=match[3] ? Number(match[3]) : /半/.test(match[0]) ? 30 : Number(match[4] || 0);
      if (['下午','晚上','中午'].includes(match[1]) && hour<12) hour+=12;
      if (hour<=23 && minute<=59 && (match[1] || /[:：]/.test(match[0]) || hour>12)) {
        clock=String(hour).padStart(2,'0')+':'+String(minute).padStart(2,'0'); consume(match[0]);
        if (!planDate) { planDate=domain.toLocalDateInput(now); notes.push('未写日期，暂按今天，请确认'); }
      } else notes.push('时间含糊或无效，请手动选择上午／下午与时间');
    }
    const lead=/提前\s*(\d{1,4})\s*(分钟|小时)提醒/.exec(title);
    if (lead && clock) { reminderMinutes=clamp(Number(lead[1])*(lead[2]==='小时'?60:1),1,10080,10);consume(lead[0]); }
    else if (lead) notes.push('提前提醒还需要具体执行时间');
    if (/每[天周月]|月底|下班|一会|晚上|下午|上午|点|\d+[月日号]/.test(title)) notes.push('还有未识别的时间或重复规则，保留原文，请手动核对');
    return { original, title:title || original, planDate, time:clock, reminderMinutes, notes, matched:Boolean(planDate || clock || reminderMinutes) };
  }
  return { SCHEMA, preferences, taskFields, habitFields, recurrence, migrate, quiet, habitAllowed, nextHabit, deferredReason, reminderStyle, history, nextOccurrence, spawnNext, plan, parseCapture };
});
