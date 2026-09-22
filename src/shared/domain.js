(function exposeDomain(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.TaskDomain = api;
})(typeof window !== "undefined" ? window : globalThis, function createDomain() {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const THEME_IDS = Object.freeze(["bg1", "bg2", "bg3", "bg4", "bg5", "bg6"]);
  const THEME_NAMES = Object.freeze({
    bg1: "星糖梦境",
    bg2: "晴空蜜桃",
    bg3: "莓果心动",
    bg4: "奶杏布丁",
    bg5: "青柠糖球",
    bg6: "蜜桃心语"
  });
  const THEME_FAMILIES = Object.freeze({
    bg1: "star-dream",
    bg2: "sky-peach",
    bg3: "berry-love",
    bg4: "matcha-roast",
    bg5: "soda-coast",
    bg6: "neon-sakura"
  });
  const PRESENCE_STATUSES = Object.freeze(["吃饭中", "开会中", "上厕所", "有事暂离"]);
  const SCREEN_IDS = Object.freeze(["screen1", "screen2", "screen3", "screen4"]);

  function normalizeThemeId(value) {
    return THEME_IDS.includes(value) ? value : "bg1";
  }

  function themeFamily(themeId) {
    return THEME_FAMILIES[normalizeThemeId(themeId)];
  }

  function themeName(themeId) {
    return THEME_NAMES[normalizeThemeId(themeId)];
  }

  function normalizePresenceStatus(value) {
    return PRESENCE_STATUSES.includes(value) ? value : null;
  }

  function normalizeLocalDate(value) {
    const text = String(value || "");
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    if (!match) return null;
    const date = new Date(`${text}T00:00:00`);
    return !Number.isNaN(date.getTime()) && toLocalDateInput(date) === text ? text : null;
  }

  function chooseNextScreenId(lastScreenId, random = Math.random) {
    const candidates = SCREEN_IDS.filter((id) => id !== lastScreenId);
    const value = Number(random());
    const safeValue = Number.isFinite(value) ? Math.min(0.999999, Math.max(0, value)) : 0;
    return candidates[Math.floor(safeValue * candidates.length)] || SCREEN_IDS[0];
  }

  function startOfDay(value = new Date()) {
    const date = new Date(value);
    date.setHours(0, 0, 0, 0);
    return date;
  }

  function endOfDay(value = new Date()) {
    const date = new Date(value);
    date.setHours(23, 59, 59, 999);
    return date;
  }

  function startOfWeek(value = new Date()) {
    const date = startOfDay(value);
    const mondayOffset = (date.getDay() + 6) % 7;
    date.setDate(date.getDate() - mondayOffset);
    return date;
  }

  function endOfWeek(value = new Date()) {
    const date = startOfWeek(value);
    date.setDate(date.getDate() + 6);
    return endOfDay(date);
  }

  function toLocalDateInput(value = new Date()) {
    const date = new Date(value);
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
    return local.toISOString().slice(0, 10);
  }

  function isSameDay(a, b) {
    return toLocalDateInput(a) === toLocalDateInput(b);
  }

  function getRange(view, customRange, now = new Date()) {
    if (view === "today") return [startOfDay(now), endOfDay(now)];
    if (view === "week") return [startOfWeek(now), endOfWeek(now)];
    if (view === "range" && customRange?.start && customRange?.end) {
      return [startOfDay(`${customRange.start}T00:00:00`), endOfDay(`${customRange.end}T00:00:00`)];
    }
    return null;
  }

  function isTaskInView(task, view, customRange, now = new Date()) {
    if (view === "all") return true;
    if (view === 'backlog') return !task.completed && !task.dueAt && !task.planDate && task.scheduleMode !== 'ongoing';
    if (view === "stage") return task.inStage !== false;
    const range = getRange(view, customRange, now);
    if (!range) return false;
    if (view === 'today' && task.priorityDate === toLocalDateInput(now)) return true;
    if (view === 'today' && isCarryoverTask(task, now)) return true;
    if (view === 'today' && task.completed && task.completedAt && isSameDay(task.completedAt, now)) return true;
    if (task.scheduleMode === "ongoing") {
      const reference = task.completed ? task.completedAt : now;
      if (!reference) return false;
      const activeDate = new Date(reference);
      return activeDate >= range[0] && activeDate <= range[1];
    }
    if (task.planDate && !task.dueAt) {
      const planned = new Date(task.planDate+'T00:00:00');
      return planned >= range[0] && planned <= range[1];
    }
    if (!task.dueAt) return false;
    const due = new Date(task.dueAt);
    return due >= range[0] && due <= range[1];
  }

  function isCarryoverTask(task, now = new Date()) {
    const planned = task.dueAt || (task.planDate && task.planDate+'T00:00:00');
    return !task.completed && task.scheduleMode !== 'ongoing' && Boolean(planned)
      && new Date(planned) < startOfDay(now);
  }

  function getTaskStatus(task, now = new Date()) {
    if (task.completed) return "completed";
    if (task.scheduleMode === "ongoing") return "ongoing";
    if (task.planDate && !task.dueAt) return 'flexible';
    if (!task.dueAt) return "unscheduled";
    const due = new Date(task.dueAt);
    if (due < now) return "ready";
    if (isSameDay(due, now)) return "today";
    return "upcoming";
  }

  function priorityWeight(priority) {
    return { high: 0, normal: 1, low: 2 }[priority] ?? 1;
  }

  function sortTasks(tasks) {
    return [...tasks].sort((a, b) => {
      if (a.completed !== b.completed) return Number(a.completed) - Number(b.completed);
      const priorityDiff = priorityWeight(a.priority) - priorityWeight(b.priority);
      if (priorityDiff) return priorityDiff;
      const aTime = a.dueAt ? new Date(a.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
      const bTime = b.dueAt ? new Date(b.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
      if (aTime !== bTime) return aTime - bTime;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }

  function calculateProgress(tasks) {
    if (!tasks.length) return { complete: 0, total: 0, percent: 0 };
    const complete = tasks.filter((task) => task.completed).length;
    return { complete, total: tasks.length, percent: Math.round((complete / tasks.length) * 100) };
  }

  function calendarDays(start, end) {
    const days = [];
    const cursor = startOfDay(start);
    const finalDay = endOfDay(end);
    while (cursor <= finalDay) {
      days.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    return days;
  }

  function buildSchedule(tasks, plan, now = new Date()) {
    if (!plan?.start || !plan?.end) throw new Error("请先设置阶段的开始和结束日期");
    const stageDays = calendarDays(`${plan.start}T00:00:00`, `${plan.end}T00:00:00`);
    if (stageDays.length <= 7) throw new Error("阶段计划需要超过一周（至少 8 天）");

    const capacity = Math.min(12, Math.max(1, Number(plan.dailyCapacity) || 3));
    const today = startOfDay(now);
    const availableDays = stageDays.filter((day) => day >= today);
    if (!availableDays.length) throw new Error("这个阶段已经结束，请调整结束日期");

    const loadByDate = new Map(availableDays.map((day) => [toLocalDateInput(day), 0]));
    for (const task of tasks) {
      if (task.completed || !task.dueAt || task.scheduleMode === "auto") continue;
      const key = toLocalDateInput(task.dueAt);
      if (loadByDate.has(key)) loadByDate.set(key, loadByDate.get(key) + 1);
    }

    const queue = sortTasks(tasks.filter((task) => (
      !task.completed
      && task.inStage !== false
      && task.scheduleMode !== "ongoing"
      && (!task.dueAt || task.scheduleMode === "auto")
    )));
    const updates = [];
    const overflow = [];

    for (const task of queue) {
      const target = availableDays.find((day) => loadByDate.get(toLocalDateInput(day)) < capacity);
      if (!target) {
        overflow.push(task.id);
        continue;
      }
      const due = new Date(target);
      due.setHours(18, 0, 0, 0);
      const key = toLocalDateInput(due);
      loadByDate.set(key, loadByDate.get(key) + 1);
      updates.push({ id: task.id, dueAt: due.toISOString(), scheduleMode: "auto" });
    }

    return { updates, overflow, totalDays: stageDays.length, capacity };
  }

  function deadlineReminderInfo(task, now = new Date()) {
    const deadlineDate = normalizeLocalDate(task?.deadlineDate);
    if (!deadlineDate) return null;
    const reminderDays = Math.min(365, Math.max(0, Number(task?.deadlineReminderDays) || 0));
    const [year, month, day] = deadlineDate.split("-").map(Number);
    const todayText = toLocalDateInput(now);
    const [todayYear, todayMonth, todayDay] = todayText.split("-").map(Number);
    const deadlineSerial = Date.UTC(year, month - 1, day) / DAY_MS;
    const todaySerial = Date.UTC(todayYear, todayMonth - 1, todayDay) / DAY_MS;
    const daysRemaining = Math.round(deadlineSerial - todaySerial);
    return {
      deadlineDate,
      reminderDays,
      daysRemaining,
      shouldRemind: task?.completed !== true && daysRemaining <= reminderDays
    };
  }

  function shouldRemindDeadlineOnStartup(task, lastRemindedDate, now = new Date()) {
    const info = deadlineReminderInfo(task, now);
    return Boolean(info?.shouldRemind && normalizeLocalDate(lastRemindedDate) !== toLocalDateInput(now));
  }

  function calculateNextReminderAt(task, now = new Date()) {
    const mode = task?.reminderMode;
    const minutes = Math.min(10_080, Math.max(1, Number(task?.reminderMinutes) || (mode === "interval" ? 120 : 10)));
    const nowMs = new Date(now).getTime();
    if (mode === "event") {
      if (!task.dueAt) return null;
      const target = new Date(task.dueAt).getTime() - minutes * 60_000;
      return new Date(Math.max(target, nowMs + 2_000)).toISOString();
    }
    if (mode === "interval" && task.reminderActive !== false) {
      return new Date(nowMs + minutes * 60_000).toISOString();
    }
    return null;
  }

  function calculateNextHabitReminderAt(habit, now = new Date()) {
    if (!habit || habit.active === false) return null;
    const nowDate = new Date(now);
    const nowMs = nowDate.getTime();
    if (habit.scheduleType === "daily") {
      const match = /^(\d{2}):(\d{2})$/.exec(String(habit.time || "08:00"));
      const hours = Math.min(23, Math.max(0, Number(match?.[1]) || 0));
      const minutes = Math.min(59, Math.max(0, Number(match?.[2]) || 0));
      const target = new Date(nowDate);
      target.setHours(hours, minutes, 0, 0);
      if (target.getTime() <= nowMs + 1_000) target.setDate(target.getDate() + 1);
      return target.toISOString();
    }
    const intervalMinutes = Math.min(1_440, Math.max(1, Number(habit.intervalMinutes) || 60));
    return new Date(nowMs + intervalMinutes * 60_000).toISOString();
  }

  function getFocusRemainingSeconds(timer, now = new Date()) {
    if (timer?.status === "running" && timer.endsAt) {
      return Math.max(0, Math.ceil((new Date(timer.endsAt).getTime() - new Date(now).getTime()) / 1000));
    }
    const remaining = Number(timer?.pausedRemainingSeconds);
    return Math.max(0, Number.isFinite(remaining) ? remaining : Number(timer?.durationMinutes || 25) * 60);
  }

  return {
    DAY_MS,
    THEME_IDS,
    THEME_NAMES,
    PRESENCE_STATUSES,
    SCREEN_IDS,
    normalizeThemeId,
    themeFamily,
    themeName,
    normalizePresenceStatus,
    normalizeLocalDate,
    chooseNextScreenId,
    startOfDay,
    endOfDay,
    startOfWeek,
    endOfWeek,
    toLocalDateInput,
    isSameDay,
    getRange,
    isTaskInView,
    isCarryoverTask,
    getTaskStatus,
    sortTasks,
    calculateProgress,
    calendarDays,
    buildSchedule,
    deadlineReminderInfo,
    shouldRemindDeadlineOnStartup,
    calculateNextReminderAt,
    calculateNextHabitReminderAt,
    getFocusRemainingSeconds
  };
});
