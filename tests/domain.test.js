const test = require("node:test");
const assert = require("node:assert/strict");
const domain = require("../src/shared/domain.js");

test("weeks begin on Monday and end on Sunday", () => {
  const value = new Date("2026-09-04T12:00:00");
  assert.equal(domain.toLocalDateInput(domain.startOfWeek(value)), "2026-08-31");
  assert.equal(domain.toLocalDateInput(domain.endOfWeek(value)), "2026-09-06");
});

test("filters tasks into today and custom ranges", () => {
  const now = new Date("2026-09-04T12:00:00");
  const task = { dueAt: "2026-09-04T19:00:00" };
  assert.equal(domain.isTaskInView(task, "today", null, now), true);
  assert.equal(domain.isTaskInView(task, "week", null, now), true);
  assert.equal(domain.isTaskInView(task, "range", { start: "2026-09-05", end: "2026-09-10" }, now), false);
});

test("sorts open and important tasks before completed tasks", () => {
  const tasks = [
    { id: "done", completed: true, priority: "high", dueAt: "2026-09-01", createdAt: "2026-09-01" },
    { id: "low", completed: false, priority: "low", dueAt: "2026-09-02", createdAt: "2026-09-01" },
    { id: "high", completed: false, priority: "high", dueAt: "2026-09-03", createdAt: "2026-09-01" }
  ];
  assert.deepEqual(domain.sortTasks(tasks).map((task) => task.id), ["high", "low", "done"]);
});

test("calculates zero-safe progress", () => {
  assert.deepEqual(domain.calculateProgress([]), { complete: 0, total: 0, percent: 0 });
  assert.equal(domain.calculateProgress([{ completed: true }, { completed: false }]).percent, 50);
});

test("stage view also contains tasks waiting to be scheduled", () => {
  assert.equal(domain.isTaskInView({ dueAt: null }, "stage"), true);
  assert.equal(domain.isTaskInView({ dueAt: null, inStage: false }, "stage"), false);
});

test("ongoing stage tasks appear every day and week without becoming overdue", () => {
  const now = new Date("2026-09-04T12:00:00");
  const ongoing = { scheduleMode: "ongoing", dueAt: null, completed: false };
  assert.equal(domain.isTaskInView(ongoing, "today", null, now), true);
  assert.equal(domain.isTaskInView(ongoing, "week", null, now), true);
  assert.equal(domain.isTaskInView(ongoing, "stage", null, now), true);
  assert.equal(domain.getTaskStatus(ongoing, now), "ongoing");
});

test("auto schedule fills today first, respects priority and preserves fixed tasks", () => {
  const now = new Date("2026-09-04T09:00:00");
  const tasks = [
    { id: "fixed", title: "fixed", completed: false, dueAt: "2026-09-04T10:00:00", scheduleMode: "fixed", priority: "normal", createdAt: "2026-09-01" },
    { id: "low", title: "low", completed: false, dueAt: null, scheduleMode: "backlog", priority: "low", createdAt: "2026-09-01" },
    { id: "high", title: "high", completed: false, dueAt: null, scheduleMode: "backlog", priority: "high", createdAt: "2026-09-02" }
  ];
  const result = domain.buildSchedule(tasks, { start: "2026-09-01", end: "2026-09-12", dailyCapacity: 2 }, now);
  assert.equal(result.updates.length, 2);
  assert.equal(result.updates[0].id, "high");
  assert.equal(domain.toLocalDateInput(result.updates[0].dueAt), "2026-09-04");
  assert.equal(domain.toLocalDateInput(result.updates[1].dueAt), "2026-09-05");
  assert.equal(tasks[0].dueAt, "2026-09-04T10:00:00");
});

test("auto schedule leaves ongoing work without a fixed execution time", () => {
  const now = new Date("2026-09-04T09:00:00");
  const tasks = [
    { id: "ongoing", completed: false, dueAt: null, scheduleMode: "ongoing", priority: "high", createdAt: "2026-09-01" },
    { id: "backlog", completed: false, dueAt: null, scheduleMode: "backlog", priority: "normal", createdAt: "2026-09-01" }
  ];
  const result = domain.buildSchedule(tasks, { start: "2026-09-01", end: "2026-09-12", dailyCapacity: 2 }, now);
  assert.deepEqual(result.updates.map((item) => item.id), ["backlog"]);
  assert.equal(tasks[0].dueAt, null);
});

test("stage plans must be longer than one week", () => {
  assert.throws(
    () => domain.buildSchedule([], { start: "2026-09-01", end: "2026-09-07", dailyCapacity: 3 }, new Date("2026-09-01")),
    /至少 8 天/
  );
});

test("event reminders trigger the chosen number of minutes before due time", () => {
  const reminderAt = domain.calculateNextReminderAt({
    reminderMode: "event",
    reminderMinutes: 10,
    dueAt: "2026-09-04T14:00:00"
  }, new Date("2026-09-04T10:00:00"));
  assert.equal(reminderAt, new Date("2026-09-04T13:50:00").toISOString());
});

test("interval reminders and running focus timers use wall-clock deadlines", () => {
  const now = new Date("2026-09-04T10:00:00");
  const reminderAt = domain.calculateNextReminderAt({ reminderMode: "interval", reminderMinutes: 120, reminderActive: true }, now);
  assert.equal(reminderAt, new Date("2026-09-04T12:00:00").toISOString());
  assert.equal(domain.getFocusRemainingSeconds({ status: "running", endsAt: "2026-09-04T10:24:30" }, now), 1470);
});

test("daily and interval habits calculate their next reminder", () => {
  const now = new Date("2026-09-04T07:30:00");
  assert.equal(
    domain.calculateNextHabitReminderAt({ active: true, scheduleType: "daily", time: "08:00" }, now),
    new Date("2026-09-04T08:00:00").toISOString()
  );
  assert.equal(
    domain.calculateNextHabitReminderAt({ active: true, scheduleType: "interval", intervalMinutes: 60 }, now),
    new Date("2026-09-04T08:30:00").toISOString()
  );
  assert.equal(domain.calculateNextHabitReminderAt({ active: false }, now), null);
});

test("a daily habit rolls over to tomorrow after today's time passes", () => {
  const next = domain.calculateNextHabitReminderAt(
    { active: true, scheduleType: "daily", time: "08:00" },
    new Date("2026-09-04T09:00:00")
  );
  assert.equal(next, new Date("2026-09-05T08:00:00").toISOString());
});

test("habit intervals honor the displayed one-minute minimum", () => {
  const now = new Date("2026-09-22T13:00:00");
  for (const minutes of [1, 2, 5, 30, 1440]) {
    assert.equal(
      Date.parse(domain.calculateNextHabitReminderAt({active:true,scheduleType:'interval',intervalMinutes:minutes}, now)),
      now.getTime() + minutes * 60000
    );
  }
});

test("deadline startup reminders respect configurable lead days and only fire once per day", () => {
  const now = new Date("2026-09-04T09:00:00");
  const task = { completed: false, deadlineDate: "2026-09-07", deadlineReminderDays: 3 };
  const info = domain.deadlineReminderInfo(task, now);
  assert.equal(info.daysRemaining, 3);
  assert.equal(info.shouldRemind, true);
  assert.equal(domain.shouldRemindDeadlineOnStartup(task, null, now), true);
  assert.equal(domain.shouldRemindDeadlineOnStartup(task, "2026-09-04", now), false);
  assert.equal(domain.deadlineReminderInfo({ ...task, deadlineReminderDays: 2 }, now).shouldRemind, false);
  assert.equal(domain.deadlineReminderInfo({ ...task, completed: true }, now).shouldRemind, false);
});

test("unfinished overdue deadlines continue to remind on a new day", () => {
  const now = new Date("2026-09-10T09:00:00");
  const task = { completed: false, deadlineDate: "2026-09-07", deadlineReminderDays: 3 };
  assert.equal(domain.deadlineReminderInfo(task, now).daysRemaining, -3);
  assert.equal(domain.shouldRemindDeadlineOnStartup(task, "2026-09-09", now), true);
});

test("theme ids are whitelisted and resolve to six independent named palettes", () => {
  assert.equal(domain.normalizeThemeId("bg5"), "bg5");
  assert.equal(domain.normalizeThemeId("../../bad"), "bg1");
  assert.equal(domain.themeFamily("bg1"), "star-dream");
  assert.equal(domain.themeFamily("bg2"), "sky-peach");
  assert.equal(domain.themeFamily("bg3"), "berry-love");
  assert.equal(domain.themeFamily("bg4"), "matcha-roast");
  assert.equal(domain.themeFamily("bg5"), "soda-coast");
  assert.equal(domain.themeFamily("bg6"), "neon-sakura");
  assert.deepEqual(domain.THEME_IDS.map(domain.themeName), [
    "星糖梦境", "晴空蜜桃", "莓果心动", "奶杏布丁", "青柠糖球", "蜜桃心语"
  ]);
});

test("presence status accepts only the four approved away messages", () => {
  for (const status of ["吃饭中", "开会中", "上厕所", "有事暂离"]) {
    assert.equal(domain.normalizePresenceStatus(status), status);
  }
  assert.equal(domain.normalizePresenceStatus("下班啦"), null);
});

test("screensaver selection excludes the immediately previous image", () => {
  for (const last of domain.SCREEN_IDS) {
    assert.notEqual(domain.chooseNextScreenId(last, () => 0), last);
    assert.notEqual(domain.chooseNextScreenId(last, () => 0.999), last);
  }
  assert.equal(domain.SCREEN_IDS.includes(domain.chooseNextScreenId(null, () => 0.5)), true);
});

test("theme and away state survive a JSON persistence round trip", () => {
  const source = {
    preferences: { themeId: "bg5" },
    presence: { active: true, status: "开会中", startedAt: "2026-09-04T10:00:00.000Z", screenId: "screen3" }
  };
  const restored = JSON.parse(JSON.stringify(source));
  assert.equal(domain.normalizeThemeId(restored.preferences.themeId), "bg5");
  assert.equal(domain.normalizePresenceStatus(restored.presence.status), "开会中");
  assert.equal(domain.SCREEN_IDS.includes(restored.presence.screenId), true);
  assert.equal(Number.isNaN(new Date(restored.presence.startedAt).getTime()), false);
});
