const domain = window.TaskDomain;
const productivity = window.Productivity;

const ui = {
  currentView: "today",
  statusFilter: "all",
  state: { tasks: [], habits: [], preferences: {} },
  suppressRenderUntil: 0,
  rewardIndex: 0
};
ui.search = '';
ui.openSteps = new Set();
ui.stepDrafts = new Map();
let lastListDate = domain.toLocalDateInput();
let addDateEdited = false;
let addBusy = false;
let addView = 'today';
let focusBusy = false;
let startupBusy = false;
let startupActual = { supported: false, enabled: false };
const stepBusy = new Set();
let renameStep = null;

const rewards = [
  ["漂亮！", "+1 完成力"],
  ["稳稳拿下。", "行动比完美更重要"],
  ["又往前一步。", "进度正在发生"],
  ["就是这个节奏！", "继续保持势能"],
  ["完成感，收到。", "你兑现了一个承诺"]
];

const $ = (selector, parent = document) => parent.querySelector(selector);
const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];

function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  })[char]);
}

function dateAtTime(dateInput, timeInput) {
  return new Date(`${dateInput}T${timeInput}:00`).toISOString();
}

function localDateAndTime(iso) {
  const date = new Date(iso || Date.now());
  return {
    date: domain.toLocalDateInput(date),
    time: `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`
  };
}

function formatDateLabel(iso) {
  if (!iso) return "未安排时间";
  const date = new Date(iso);
  const now = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const time = date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
  if (domain.isSameDay(date, now)) return `今天 ${time}`;
  if (domain.isSameDay(date, tomorrow)) return `明天 ${time}`;
  return `${date.getMonth() + 1}月${date.getDate()}日 ${time}`;
}

function formatDeadlineMeta(task) {
  const info = domain.deadlineReminderInfo(task);
  if (!info) return "";
  const date = new Date(`${info.deadlineDate}T00:00:00`);
  const dateLabel = `${date.getMonth() + 1}月${date.getDate()}日`;
  let label = `最晚 ${dateLabel} · 提前 ${info.reminderDays} 天提醒`;
  if (info.daysRemaining < 0) label = `已超过截止 ${Math.abs(info.daysRemaining)} 天`;
  else if (info.daysRemaining === 0) label = "今天截止";
  else if (info.daysRemaining === 1) label = "明天截止";
  else if (info.daysRemaining <= info.reminderDays) label = `还有 ${info.daysRemaining} 天截止`;
  const urgent = info.daysRemaining <= info.reminderDays;
  return `<span class="deadline-meta ${urgent ? "is-urgent" : ""}">⌛ ${label}</span>`;
}

function updateClock() {
  const now = new Date();
  $("#todayStamp").textContent = now.toLocaleDateString("zh-CN", {
    year: "numeric", month: "long", day: "numeric", weekday: "long"
  });
}

function applyTheme() {
  const themeId = domain.normalizeThemeId(ui.state.preferences?.themeId);
  document.documentElement.dataset.themeId = themeId;
  document.documentElement.dataset.previewFamily = domain.themeFamily(themeId);
  $("#themeCurrentLabel").textContent = domain.themeName(themeId);
  $$("[data-theme-id]").forEach((button) => {
    const active = button.dataset.themeId === themeId;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  });
}

function closeToolPopovers() {
  for (const [buttonId, popoverId] of [["themeMenuButton", "themePopover"], ["presenceMenuButton", "presencePopover"]]) {
    $(`#${buttonId}`).setAttribute("aria-expanded", "false");
    $(`#${popoverId}`).hidden = true;
  }
}

function positionToolPopover(button, popover) {
  const anchor = button.getBoundingClientRect();
  const margin = 10;
  const gap = 10;
  if (anchor.bottom <= margin || anchor.top >= innerHeight - margin) {
    closeToolPopovers();
    return;
  }
  const above = Math.max(0, anchor.top - gap - margin);
  const below = Math.max(0, innerHeight - anchor.bottom - gap - margin);
  // Prefer opening upwards from the dock, as in the previous compact layout.
  // When the dock is scrolled near the top, use the side with usable space.
  const useAbove = above >= Math.min(popover.scrollHeight, 380) || above >= below;
  popover.style.maxHeight = `${Math.max(0, useAbove ? above : below)}px`;
  const width = popover.offsetWidth;
  const height = popover.offsetHeight;
  popover.style.left = `${Math.max(margin, Math.min(anchor.left, innerWidth - width - margin))}px`;
  popover.style.top = `${useAbove ? anchor.top - gap - height : anchor.bottom + gap}px`;
}

function positionOpenToolPopovers() {
  for (const [buttonId, popoverId] of [["themeMenuButton", "themePopover"], ["presenceMenuButton", "presencePopover"]]) {
    const popover = $(`#${popoverId}`);
    if (!popover.hidden) positionToolPopover($(`#${buttonId}`), popover);
  }
}

function toggleToolPopover(buttonId, popoverId) {
  const button = $(`#${buttonId}`);
  const popover = $(`#${popoverId}`);
  const shouldOpen = popover.hidden;
  closeToolPopovers();
  if (shouldOpen) {
    popover.hidden = false;
    button.setAttribute("aria-expanded", "true");
    positionToolPopover(button, popover);
  }
}

function getViewTasks(view = ui.currentView) {
  return ui.state.tasks.filter((task) => domain.isTaskInView(task, view));
}

function getVisibleTasks() {
  let tasks = ui.search.trim() ? ui.state.tasks : getViewTasks();
  tasks = tasks.filter((task) => productivity.matchesSearch(task, ui.search));
  tasks = tasks.filter(window.Workbench.categoryMatches);
  if (ui.statusFilter === "open") tasks = tasks.filter((task) => !task.completed);
  if (ui.statusFilter === "done") tasks = tasks.filter((task) => task.completed);
  return domain.sortTasks(tasks);
}

function viewCopy() {
  const plan = ui.state.stagePlan;
  const stageLabel = plan?.start && plan?.end
    ? `${plan.start.replaceAll("-", ".")} — ${plan.end.replaceAll("-", ".")}`
    : "先定一个超过一周的阶段";
  return {
    today: ["TODAY · 今日工作台", "今天，专心做好一件事。", "有安排，也留一点余地。先从最重要的开始。"],
    backlog: ['INBOX · 待安排','先记下来，再慢慢安排。','没有时间也可以保存，选好哪天推进就够了。'],
    reminders: ['REMINDERS · 提醒中心','每一条提醒，都有着落。','什么时候提醒、怎样提醒、为什么暂缓，在这里一眼看清。'],
    week: ["THIS WEEK · MOMENTUM", "这一周，让进度看得见。", "不追赶时间，只建立属于你的节奏。"],
    stage: ["STAGE PLAN · BIG PICTURE", stageLabel, "把全部工作放进来，再决定本周与今天。"]
  }[ui.currentView];
}

function updateHeader() {
  const [eyebrow, title, subtitle] = viewCopy();
  $("#eyebrow").textContent = eyebrow;
  $("#viewTitle").textContent = title;
  $("#viewSubtitle").textContent = subtitle;
  const tasks = getViewTasks();
  const progress = domain.calculateProgress(tasks);
  $("#progressOrbit").style.setProperty("--progress", progress.percent);
  $("#progressPercent").textContent = `${progress.percent}%`;
}

function updateSidebar() {
  const today = ui.state.tasks.filter((task) => domain.isTaskInView(task, "today") && !task.completed).length;
  const week = ui.state.tasks.filter((task) => domain.isTaskInView(task, "week") && !task.completed).length;
  $("#todayCount").textContent = today;
  $("#weekCount").textContent = week;
  $("#stageCount").textContent = getViewTasks("stage").filter((task) => !task.completed).length;

  const todayTasks = ui.state.tasks.filter((task) => domain.isTaskInView(task, "today"));
  const progress = domain.calculateProgress(todayTasks);
  $("#sideProgressLabel").textContent = `${progress.complete} / ${progress.total}`;
  $("#sideProgressBar").style.width = `${progress.percent}%`;
  $("#sideEncouragement").textContent = progress.percent === 100 && progress.total
    ? "今天的承诺，全部兑现了。"
    : progress.percent >= 50
      ? "势头很好，再拿下一件。"
      : progress.total
        ? "只看下一件，然后开始。"
        : "先写下一件最小的事。";

  const prefs = ui.state.preferences;
  const presentation=ui.state.presentation || {};
  $('#widgetSwitch').setAttribute('aria-checked',String(Boolean(presentation.widgetRequested ?? prefs.widgetVisible)));
  const widgetCopy=$('#widgetSwitch').previousElementSibling;
  widgetCopy.querySelector('strong').textContent=ui.state.focusTimer?.status!=='idle'?'专注小组件':'桌面小组件';
  widgetCopy.querySelector('small').textContent=presentation.error?.role==='widget'?'加载失败，可重试'
    :presentation.blockedBy==='presence'?'离席画面结束后显示'
      :presentation.blockedBy==='reminder'?'提醒处理后恢复'
        :presentation.blockedBy==='fullscreen'?'打开此开关可收起全屏'
          :presentation.widgetRequested&&!presentation.widgetVisible?'正在准备画面…'
            :presentation.widgetVisible?'已显示在桌面上':'已隐藏，可随时打开';
  $('#windowErrorBanner').hidden=!presentation.error;
  if(presentation.error)$('#windowErrorMessage').textContent=presentation.error.message;
  $("#notificationSwitch").setAttribute("aria-checked", String(Boolean(prefs.notifications)));
  $("#reminderInterval").value = String(prefs.reminderIntervalMinutes || 30);
  const presence = ui.state.presence;
  $("#presenceCurrentLabel").textContent = presence?.active
    ? `${presence.status} · 已开启全屏`
    : "让同事一眼看到状态";
}

function updateFocusDisplay() {
  const timer = ui.state.focusTimer || { mode: "focus", durationMinutes: 25, status: "idle", pausedRemainingSeconds: 1500, sessionsCompleted: 0 };
  let seconds = domain.getFocusRemainingSeconds(timer);
  if (timer.status === "running" && timer.endsAt) {
    seconds = Math.max(0, Math.ceil((new Date(timer.endsAt).getTime() - Date.now()) / 1000));
  }
  const minutesPart = String(Math.floor(seconds / 60)).padStart(2, "0");
  const secondsPart = String(seconds % 60).padStart(2, "0");
  $("#focusTime").textContent = `${minutesPart}:${secondsPart}`;
  $("#focusPanel").classList.toggle("is-running", timer.status === "running");
  if (document.activeElement !== $("#focusDuration")) $("#focusDuration").value = String(timer.durationMinutes);
  $("#focusDuration").disabled = timer.status !== "idle";
  $('#focusOpen').hidden = timer.status === 'idle';
  $('#focusTaskLabel').textContent = timer.status !== 'idle'
    ? (ui.state.tasks.find((task) => task.id === timer.taskId)?.title || timer.taskTitle || (timer.mode === 'focus' ? '自由专注' : '休息，补充能量'))
    : '自由专注 · 或从任务卡开始';
  $("#focusStart").textContent = timer.status === "running"
    ? "暂停"
    : timer.status === "paused"
      ? "继续"
      : timer.mode === "focus" ? "开始专注" : "开始休息";
  $("#focusRounds").textContent = `已完成 ${timer.sessionsCompleted || 0} 轮`;
  $$("[data-focus-mode]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.focusMode === timer.mode);
    button.disabled = timer.status !== "idle";
  });
}

function reminderBadge(task) {
  if (task.reminderMode === "event") {
    return `<span class="reminder-tag">${window.Workbench.styleName(task.reminderPresentation)} · 提前 ${task.reminderMinutes} 分钟</span>`;
  }
  if (task.reminderMode === "interval") {
    return `<span class="reminder-tag interval ${task.reminderActive ? "" : "paused"}">${task.reminderActive ? "循环中" : "已暂停"} · 每 ${task.reminderMinutes} 分钟</span>`;
  }
  return "";
}

function syncReminderFields(kind) {
  const edit = kind === "edit";
  const mode = $(`#${edit ? "edit" : "task"}ReminderMode`).value;
  const field = $(`#${edit ? "edit" : "task"}ReminderMinutesField`);
  const label = $(`#${edit ? "edit" : "task"}ReminderMinutesLabel`);
  const input = $(`#${edit ? "edit" : "task"}ReminderMinutes`);
  const hint = $(`#${edit ? "edit" : "task"}ReminderHint`);
  field.hidden = mode === "none";
  if (mode === "event") {
    label.textContent = edit ? "提前多少分钟" : "提前";
    if (!input.dataset.edited) input.value = "10";
    hint.textContent = "将在事项开始前提醒；下方可以选择轻提示或全屏。";
  } else if (mode === "interval") {
    label.textContent = edit ? "每隔多少分钟" : "每隔";
    if (!input.dataset.edited) input.value = "120";
    hint.textContent = "适合长任务：定时停下来检查实验或代码进度。";
  } else {
    hint.textContent = "普通系统提醒仍会按左侧频率运行。";
  }
}

function syncPlanningReminderCompatibility(kind) {
  const edit = kind === "edit";
  const scheduleMode = edit
    ? $("#editScheduleMode").value
    : $("#taskPlanMode").value;
  const select = $(`#${edit ? "edit" : "task"}ReminderMode`);
  const eventOption = select.querySelector('option[value="event"]');
  eventOption.disabled = scheduleMode !== "fixed";
  if (scheduleMode !== "fixed" && select.value === "event") {
    select.value = "none";
    delete $(`#${edit ? "edit" : "task"}ReminderMinutes`).dataset.edited;
  }
  syncReminderFields(kind);
}

function syncStageDeadlineFields() {
  const disabled = !$("#taskDeadline").value;
  $("#taskDeadlineDays").disabled = disabled;
  $("#taskDeadlineDaysField").classList.toggle("is-disabled", disabled);
}

function syncEditScheduleFields() {
  const timed = $("#editScheduleMode").value === "fixed";
  const dated=timed||$('#editScheduleMode').value==='day';
  $("#editDateTimeFields").hidden = !dated;
  $('#editTime').closest('label').hidden=!timed;
  $("#editDate").required = dated;
  $("#editTime").required = timed;
  $("#editScheduleHint").textContent = timed
    ? "这是计划执行时间；到点后显示“已到计划时间”，不等于超过最晚截止。"
    : $("#editScheduleMode").value === "ongoing"
      ? "每天都会同时出现在“今天”和“这一周”，不会因为没有时间而显示超时。"
      : "保留在阶段计划中，等待智能分配或你自己安排。";
  syncPlanningReminderCompatibility("edit");
}

function taskMarkup(task, index) {
  const status = domain.getTaskStatus(task);
  const overdueClass = status === "ready" ? "is-ready" : "";
  const priority = task.priority === "high" ? '<span class="priority-tag">重要</span>' : "";
  const scheduleTag = status === "unscheduled"
    ? '<span class="schedule-tag">待安排</span>'
    : status === "ongoing" ? '<span class="schedule-tag ongoing">每日推进</span>' : "";
  const reminderTag = reminderBadge(task);
  const scheduleLabel = status === "ongoing"
    ? "每天持续推进 · 不设具体执行时间"
    : status === 'flexible' ? `${task.planDate} · 不限具体时间`
    : status === "unscheduled"
      ? "等待智能分配，或由你自己安排"
      : formatDateLabel(task.dueAt);
  const deadlineMeta = formatDeadlineMeta(task);
  const steps = task.steps || [];
  const checkedSteps = steps.filter((step) => step.completed).length;
  const focused = productivity.summarize(ui.state.focusHistory || [], ui.state.focusTimer, new Date(0), new Date(8640000000000000), Date.now(), task.id);
  return `
    <article class="task-card ${task.completed ? "is-done" : ""} ${task.priorityDate===domain.toLocalDateInput()?'is-today-priority':''} ${status === "unscheduled" ? "is-unscheduled" : ""}" data-id="${escapeHtml(task.id)}" data-priority="${escapeHtml(task.priority || "normal")}" style="animation-delay:${Math.min(index * 35, 210)}ms">
      <button class="complete-button" data-action="toggle" aria-label="${task.completed ? "恢复任务" : "完成任务"}" aria-pressed="${task.completed===true}"></button>
      <div class="task-body">
        <div class="task-title-row"><span class="task-title">${escapeHtml(task.title)}</span>${priority}${scheduleTag}${reminderTag}</div>
        <div class="task-meta">
          ${window.Workbench.taskMeta(task)}
          <span class="${overdueClass}">${status === "unscheduled" ? "◇" : status === "ongoing" ? "↻" : "◷"} ${status === "ready" ? "已到计划时间 · " : ""}${scheduleLabel}</span>
          ${deadlineMeta}
          ${task.notes ? `<span class="task-note">⌁ ${escapeHtml(task.notes)}</span>` : ""}
          ${focused.seconds ? `<span class="task-focus-total">◎ 已投入 ${productivity.formatDuration(focused.seconds)} · ${focused.rounds} 轮</span>` : ''}
        </div>
      </div>
      <div class="task-actions">
        ${!task.completed?`<button data-action="priority" title="${task.priorityDate===domain.toLocalDateInput()?'移出今日重点':'选为今日重点'}">${task.priorityDate===domain.toLocalDateInput()?'★ 重点':'☆'}</button>`:''}
        ${!task.completed ? `<button data-action="start-focus" class="start-task-focus" title="对这项任务开始番茄钟">◎ 专注</button>` : ''}
        <button data-action="steps" class="steps-task" title="展开小步骤">${steps.length ? `${checkedSteps}/${steps.length} 步` : '小步骤'}</button>
        ${!task.completed && task.reminderMode === "interval" ? `<button data-action="toggle-reminder" class="toggle-reminder" title="${task.reminderActive ? "暂停循环提醒" : "继续循环提醒"}">${task.reminderActive ? "Ⅱ" : "▶"}</button>` : ""}
        ${!task.completed ? `<button data-action="schedule" class="schedule-task ${status === "unscheduled" || status === "ongoing" ? "is-labeled" : ""}" title="调整推进方式">${status === "unscheduled" ? "自己安排" : status === "ongoing" ? "调整推进" : "▣"}</button>` : ""}
        <button data-action="edit" title="编辑">✎</button>
        <button data-action="delete" class="delete-task" title="删除">×</button>
      </div>
      ${ui.openSteps.has(task.id) ? `<section class="task-steps" aria-label="${escapeHtml(task.title)}的小步骤">
        <div class="steps-heading"><strong>一步一步来 · ${checkedSteps}/${steps.length}</strong><span>${checkedSteps === steps.length && steps.length ? '小步骤都完成啦！主任务由你确认完成。' : '拆小一点，更容易开始。'}</span></div>
        ${steps.map((step) => `<div class="step-row ${step.completed ? 'is-checked' : ''}"><button data-action="step-check" data-step-id="${escapeHtml(step.id)}" role="checkbox" aria-checked="${step.completed}" aria-label="${escapeHtml(step.title)}" ${task.completed ? 'disabled' : ''}>${step.completed ? '✓' : ''}</button><span>${escapeHtml(step.title)}</span>${!task.completed ? `<button data-action="step-rename" data-step-id="${escapeHtml(step.id)}" aria-label="重命名小步骤">✎</button><button data-action="step-delete" data-step-id="${escapeHtml(step.id)}" aria-label="删除小步骤">×</button>` : ''}</div>`).join('')}
        ${!task.completed ? `<div class="step-add"><input data-step-draft="${escapeHtml(task.id)}" maxlength="120" placeholder="写下下一小步，按回车添加" value="${escapeHtml(ui.stepDrafts.get(task.id) || '')}" /><button data-action="step-add">添加</button></div>` : ''}
      </section>` : ''}
    </article>`;
}

function emptyMarkup() {
  const completedEmpty = ui.statusFilter === "done";
  return `
    <div class="empty-state">
      <div class="empty-state-visual"><span>✓</span><span>${completedEmpty ? "✦" : "+"}</span></div>
      <strong>${completedEmpty ? "完成记录还在路上" : "这里很清爽，正适合开始"}</strong>
      <p>${completedEmpty ? "完成第一件事后，它会被好好记录在这里。" : "从一件 5 分钟能做完的小事开始。"}</p>
      ${completedEmpty ? "" : `<div class="suggestions"><button data-suggestion="整理桌面 5 分钟">整理桌面</button><button data-suggestion="读 10 页书">读 10 页书</button><button data-suggestion="回复重要消息">回复消息</button></div>`}
    </div>`;
}

function formatHabitNext(habit) {
  if (!habit.active) return "提醒已暂停";
  const pending = ui.state.pendingReminders?.find((item) => item.habitId === habit.id);
  if (pending && !pending.availableAt) return '提醒待处理 · 不重复弹出';
  if (!habit.nextReminderAt) return "正在安排下一次";
  const next = new Date(habit.nextReminderAt);
  if (Number.isNaN(next.getTime())) return "正在安排下一次";
  const time = next.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (domain.isSameDay(next, new Date())) return `今天 ${time}`;
  if (domain.isSameDay(next, tomorrow)) return `明天 ${time}`;
  return `${next.getMonth() + 1}月${next.getDate()}日 ${time}`;
}

function habitMarkup(habit) {
  const completedToday = habit.lastCompletedAt && domain.isSameDay(habit.lastCompletedAt, new Date());
  const scheduleControl = habit.scheduleType === "daily"
    ? `<label>每天 <input type="time" value="${escapeHtml(habit.time || "08:00")}" data-habit-field="time" aria-label="${escapeHtml(habit.title)}提醒时间" /></label>`
    : `<label>每 <input type="number" min="1" max="1440" value="${Number(habit.intervalMinutes) || 60}" data-habit-field="intervalMinutes" aria-label="${escapeHtml(habit.title)}提醒间隔" /> 分钟</label>`;
  return `
    <article class="habit-card ${habit.active ? "" : "is-paused"} ${completedToday ? "is-complete-today" : ""}" data-habit-id="${habit.id}">
      <button class="habit-complete" data-habit-action="complete" title="记录这一次完成">${escapeHtml(habit.icon || "✦")}</button>
      <div class="habit-copy">
        <strong>${escapeHtml(habit.title)}</strong>
        <small>${completedToday ? "今天做到了 · " : ""}${formatHabitNext(habit)}</small>
      </div>
      <button class="switch habit-toggle" data-habit-action="toggle" role="switch" aria-checked="${habit.active}" title="${habit.active ? "暂停提醒" : "开启提醒"}"><span></span></button>
      <div class="habit-schedule">
        ${scheduleControl}
        <button class="habit-configure" data-habit-action="configure">${window.Workbench.styleName(habit.reminderPresentation)} · 设置</button>
        <button class="habit-delete" data-habit-action="delete">删除</button>
      </div>
    </article>`;
}

function renderHabits() {
  const habits = ui.state.habits || [];
  const active = habits.filter((habit) => habit.active);
  $("#habitActiveCount").textContent = String(active.length);
  const nextHabit = active
    .filter((habit) => habit.nextReminderAt)
    .sort((a, b) => new Date(a.nextReminderAt) - new Date(b.nextReminderAt))[0];
  $("#habitNextLabel").textContent = nextHabit
    ? `${nextHabit.title} · ${formatHabitNext(nextHabit)}`
    : "还没有开启的习惯";
  $("#habitList").innerHTML = habits.length
    ? habits.map(habitMarkup).join("")
    : '<div class="habit-empty"><strong>还没有每日坚持</strong><span>从下面添加第一件小事吧。</span></div>';
}

function render() {
  applyTheme();
  updateHeader();
  updateSidebar();
  updateFocusDisplay();
  renderHabits();
  updateFocusInsights();
  renderTaskList();
  window.Workbench.render();
  if ($('#focusHistoryDialog').open) renderFocusHistory();
}

function renderTaskList() {
  const tasks = getVisibleTasks();
  $("#taskSummary").textContent = `${tasks.length} 项任务 · ${tasks.filter((task) => !task.completed).length} 项待完成`;
  $('#clearSearch').hidden = !ui.search;
  if (ui.search.trim()) {
    $('#taskSummary').textContent = `搜索全部任务 · ${tasks.length} 项结果`;
    $('#taskList').innerHTML = tasks.length ? tasks.map(taskMarkup).join('') : '<div class="empty-state"><strong>没有找到匹配的任务</strong><p>试试标题、备注或某个小步骤中的关键词。</p></div>';
  } else if (ui.currentView === 'today') {
    $('#taskList').innerHTML = window.Workbench.grouped(tasks);
  } else $('#taskList').innerHTML = tasks.length ? tasks.map(taskMarkup).join('') : emptyMarkup();
}

function updateFocusInsights() {
  const now = new Date();
  const tomorrow = domain.startOfDay(now); tomorrow.setDate(tomorrow.getDate() + 1);
  const weekEnd = domain.startOfWeek(now); weekEnd.setDate(weekEnd.getDate() + 7);
  const today = productivity.summarize(ui.state.focusHistory, ui.state.focusTimer, domain.startOfDay(now), tomorrow);
  const week = productivity.summarize(ui.state.focusHistory, ui.state.focusTimer, domain.startOfWeek(now), weekEnd);
  $('#focusTodayTotal').textContent = productivity.formatDuration(today.seconds);
  $('#focusWeekTotal').textContent = productivity.formatDuration(week.seconds);
  $('#focusTodayRounds').textContent = `${today.rounds} 轮`;
}

function renderFocusHistory() {
  const history = [...(ui.state.focusHistory || [])].sort((a, b) => new Date(b.endedAt) - new Date(a.endedAt));
  $('#historyRows').innerHTML = history.length ? history.map((record) => `<article class="history-row"><div><strong>${escapeHtml(record.taskTitle)}</strong><small>${escapeHtml(new Date(record.endedAt).toLocaleString('zh-CN', {month:'long', day:'numeric', hour:'2-digit',minute:'2-digit'}))} · ${record.outcome === 'completed' ? '完成一轮' : '提前结束'}</small></div><b>${productivity.formatDuration(record.durationSeconds)}</b></article>`).join('')
    : '<div class="empty-state"><strong>从这一轮开始，记录你的投入</strong><p>从任务卡点击“专注”，或开启一次自由专注。</p></div>';
}

function refreshTemporalUi() {
  updateClock(); updateFocusInsights();
  const day = domain.toLocalDateInput();
  if (day !== lastListDate) {
    lastListDate = day;
    updateHeader(); updateSidebar(); renderTaskList();
  }
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("is-visible");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("is-visible"), 1800);
}

function playCompletionSound() {
  if (!ui.state.preferences.soundEnabled) return;
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    const context = new AudioContext();
    const master = context.createGain();
    master.gain.setValueAtTime(0.0001, context.currentTime);
    master.gain.exponentialRampToValueAtTime(0.16, context.currentTime + 0.018);
    master.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.52);
    master.connect(context.destination);
    [523.25, 659.25, 783.99].forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = index === 2 ? "sine" : "triangle";
      oscillator.frequency.value = frequency;
      gain.gain.value = 0.55 - index * 0.08;
      oscillator.connect(gain).connect(master);
      const start = context.currentTime + index * 0.065;
      oscillator.start(start);
      oscillator.stop(start + 0.3);
    });
    setTimeout(() => context.close(), 700);
  } catch { /* Audio feedback is optional. */ }
}

function burstAt(rect) {
  const layer = $("#particleLayer");
  const theme = getComputedStyle(document.documentElement);
  const colors = [
    theme.getPropertyValue("--acid").trim(),
    theme.getPropertyValue("--violet").trim(),
    theme.getPropertyValue("--pink").trim(),
    theme.getPropertyValue("--orange").trim(),
    theme.getPropertyValue("--paper").trim(),
    theme.getPropertyValue("--ink").trim()
  ].filter(Boolean);
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  for (let index = 0; index < 28; index += 1) {
    const angle = (Math.PI * 2 * index) / 28 + (Math.random() - 0.5) * 0.3;
    const distance = 55 + Math.random() * 115;
    const particle = document.createElement("span");
    particle.className = "particle";
    particle.style.setProperty("--left", `${x}px`);
    particle.style.setProperty("--top", `${y}px`);
    particle.style.setProperty("--x", `${Math.cos(angle) * distance}px`);
    particle.style.setProperty("--y", `${Math.sin(angle) * distance + 35}px`);
    particle.style.setProperty("--r", `${(Math.random() - 0.5) * 720}deg`);
    particle.style.setProperty("--size", `${5 + Math.random() * 8}px`);
    particle.style.setProperty("--color", colors[index % colors.length]);
    particle.addEventListener("animationend", () => particle.remove());
    layer.appendChild(particle);
  }
}

function showReward() {
  const stage = $("#rewardStage");
  const copy = rewards[ui.rewardIndex % rewards.length];
  ui.rewardIndex += 1;
  $("#rewardTitle").textContent = copy[0];
  $("#rewardSubtitle").textContent = copy[1];
  stage.classList.remove("is-visible");
  void stage.offsetWidth;
  stage.classList.add("is-visible");
  setTimeout(() => stage.classList.remove("is-visible"), 1200);
}

async function toggleTask(task, card, button) {
  const completing = !task.completed;
  if (completing && (task.steps || []).some((step) => !step.completed)
    && !await window.ThemeConfirm.ask({title:'一起完成这件事？',message:'还有未完成的小步骤。是否将整件任务及小步骤一起标为完成？',confirmLabel:'一起完成'})) return;
  const current=ui.state.tasks.find(item=>item.id===task.id);
  if(!current||current.completed!==task.completed)return;
  if (completing) {
    ui.suppressRenderUntil = performance.now() + 700;
    card.classList.add("is-completing");
    burstAt(button.getBoundingClientRect());
    playCompletionSound();
    showReward();
    if (navigator.vibrate) navigator.vibrate([35, 25, 55]);
    await new Promise((resolve) => setTimeout(resolve, 520));
  }
  ui.state = await window.doneAPI.toggleTask(task.id,task.completed);
  render();
}

function openEditor(task) {
  const values = localDateAndTime(task.dueAt);
  const scheduleMode = task.scheduleMode === "ongoing"
    ? "ongoing"
    : task.dueAt ? "fixed" : task.planDate?'day':"backlog";
  $("#editId").value = task.id;
  $("#editTitle").value = task.title;
  $("#editScheduleMode").value = scheduleMode;
  $("#editDate").value = task.planDate || values.date;
  if (ui.currentView === "stage" && ui.state.stagePlan?.start && ui.state.stagePlan?.end) {
    $("#editDate").min = ui.state.stagePlan.start;
    $("#editDate").max = ui.state.stagePlan.end;
  } else {
    $("#editDate").removeAttribute("min");
    $("#editDate").removeAttribute("max");
  }
  $("#editTime").value = values.time;
  $("#editDeadline").value = task.deadlineDate || "";
  $("#editDeadlineDays").value = String(task.deadlineReminderDays ?? 3);
  $("#editNotes").value = task.notes || "";
  $("#editPriority").value = task.priority || "normal";
  $("#editReminderMode").value = task.reminderMode || "none";
  $("#editReminderMinutes").value = String(task.reminderMinutes || (task.reminderMode === "interval" ? 120 : 10));
  $("#editReminderMinutes").dataset.edited = "true";
  window.Workbench.fillEdit(task);
  syncEditScheduleFields();
  $("#editDialog").showModal();
}

function setView(view) {
  ui.currentView = view;
  $$(".nav-item").forEach((button) => button.classList.toggle("is-active", button.dataset.view === view));
  $("#stagePanel").hidden = view !== "stage";
  $(".add-button").firstChild.textContent = view === "stage" ? "放入阶段 " : "加入清单 ";
  render();
}

function syncAddSchedule() {
  const timed = $('#taskPlanMode').value === 'fixed';
  for (const name of ['Date', 'Time']) {
    const show=timed||(name==='Date'&&$('#taskPlanMode').value==='day');
    $('#task' + name + 'Field').hidden = !show;
    $('#task' + name).required = show;
    $('#task' + name).disabled = !show;
  }
  syncPlanningReminderCompatibility('task');
  updateImmediateHint();
}

function updateImmediateHint() {
  if (!$('#addTaskDialog').open || $('#taskReminderMode').value !== 'event') return;
  const date = $('#taskDate').value;
  const time = $('#taskTime').value;
  if (date && time) {
    const at = new Date(date + 'T' + time + ':00').getTime() - Number($('#taskReminderMinutes').value) * 60000;
    $('#taskReminderHint').textContent = at <= Date.now()
      ? '提前提醒时刻已过：保存后立即提醒。'
      : '将在事项开始前按所选方式提醒。';
  }
}

function openAddDialog() {
  if (addBusy || $('#addTaskDialog').open) return;
  const title = $('#taskTitle').value.trim();
  if (!title) return;
  addView = ui.currentView;
  addDateEdited = false;
  $('#addTaskDetails').reset();
  delete $('#taskReminderMinutes').dataset.edited;
  const now = localDateAndTime();
  $('#taskDate').value = now.date;
  $('#taskTime').value = now.time;
  $('#addTaskHeading').textContent = '随手记下，安心继续。';
  $('#addTaskError').textContent = '';
  $$('#addTaskDialog .stage-only').forEach((field) => { field.hidden = addView !== 'stage'; });
  window.Workbench.capture(title);
  syncStageDeadlineFields();
  syncAddSchedule();
  $('#addTaskDialog').showModal();
  updateImmediateHint();
}

async function saveNewTask(event) {
  event.preventDefault();
  if (addBusy || !$('#addTaskDetails').reportValidity()) return;
  const scheduleMode = $('#taskPlanMode').value;
  if (!addDateEdited) {
    const now = localDateAndTime();
    $('#taskDate').value = now.date;
    $('#taskTime').value = now.time;
  }
  addBusy = true;
  $('#confirmAdd').disabled = true;
  $('#cancelAdd').disabled = true;
  $('#addTaskError').textContent = '';
  try {
    ui.state = await window.doneAPI.addTask({
      ...window.Workbench.addFields(),
      title: $('#captureTitle').value.trim(),
      steps: $('#taskSteps').value.split(/\r?\n/).map((title, index) => ({id: String(index), title})).filter((step) => step.title.trim()),
      notes: $('#taskNotes').value.trim(),
      dueAt: scheduleMode === 'fixed' ? dateAtTime($('#taskDate').value, $('#taskTime').value) : null,
      scheduleMode,
      deadlineDate: $('#taskDeadline').value || null,
      deadlineReminderDays: Number($('#taskDeadlineDays').value),
      priority: $('#taskPriority').value,
      reminderMode: $('#taskReminderMode').value,
      reminderMinutes: Number($('#taskReminderMinutes').value)
    });
    $('#addTaskDialog').close();
    $('#taskTitle').value = '';
    $('#taskTitle').focus();
    showToast('已加入清单，开始下一步吧');
    render();
  } catch (error) {
    $('#addTaskError').textContent = error.message || '保存失败，请重试；输入内容已保留。';
  } finally {
    addBusy = false;
    $('#confirmAdd').disabled = false;
    $('#cancelAdd').disabled = false;
  }
}

async function refreshStartup() {
  try {
    startupActual = await window.doneAPI.getStartupSettings();
    $('#startupSwitch').setAttribute('aria-checked', String(startupActual.enabled));
    $('#startupSwitch').disabled = !startupActual.supported || startupBusy;
    $('#startupStatus').textContent = !startupActual.supported ? '请在正式版 EXE 中设置'
      : startupActual.blocked ? '已被 Windows 禁用'
        : startupActual.enabled ? '已开启 · 登录后显示小组件' : '已关闭 · 按需开启';
  } catch (error) {
    $('#startupStatus').textContent = '读取失败，请稍后重试';
    showToast(error.message);
  }
}

async function startTaskFocus(task) {
  if (focusBusy) return;
  focusBusy = true;
  try {
    let timer = ui.state.focusTimer;
    if (timer.status !== 'idle' && timer.taskId !== task.id) {
      const sessionId=timer.sessionId;
      if (!await window.ThemeConfirm.ask({title:'切换专注任务？',message:'已投入时间会保留，未完成的一轮不计入完成轮数。',confirmLabel:'结束并切换',cancelLabel:'继续当前任务'})) return;
      if(ui.state.focusTimer.sessionId!==sessionId||!ui.state.tasks.some(item=>item.id===task.id&&!item.completed)){showToast('当前状态已变化，请重新选择任务');return;}
      ui.state = await window.doneAPI.updateFocusTimer({action:'stop', sessionId:timer.sessionId});
      timer = ui.state.focusTimer;
    }
    ui.state = await window.doneAPI.updateFocusTimer({action:'start', taskId:task.id, sessionId:timer.sessionId});
    render();
  } catch (error) { showToast(error.message); }
  finally { focusBusy = false; }
}

async function changeStep(task, command, button) {
  if (stepBusy.has(task.id)) return;
  stepBusy.add(task.id);
  const rect = button?.getBoundingClientRect();
  try {
    ui.state = await window.doneAPI.updateTaskStep({taskId:task.id, ...command});
    if (command.action === 'add') ui.stepDrafts.delete(task.id);
    render();
    if (command.action === 'set-completed' && command.completed) {
      if (rect) burstAt(rect);
      playCompletionSound();
      showToast('又拿下一小步！');
    }
    if (command.action === 'add') $(`input[data-step-draft="${task.id}"]`)?.focus();
    return true;
  } catch (error) { showToast(error.message); return false; }
  finally { stepBusy.delete(task.id); }
}

function bindEvents() {
  $('#taskSearch').addEventListener('input', (event) => { ui.search = event.target.value; renderTaskList(); });
  $('#clearSearch').addEventListener('click', () => { ui.search = ''; $('#taskSearch').value = ''; renderTaskList(); $('#taskSearch').focus(); });
  $('#focusHistoryButton').addEventListener('click', () => { renderFocusHistory(); $('#focusHistoryDialog').showModal(); });
  $('#closeHistory').addEventListener('click', () => $('#focusHistoryDialog').close());
  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f' && !document.querySelector('dialog[open]')) { event.preventDefault(); $('#taskSearch').focus(); }
  });
  $('#taskList').addEventListener('input', (event) => {
    if (event.target.dataset.stepDraft) ui.stepDrafts.set(event.target.dataset.stepDraft, event.target.value);
  });
  $('#taskList').addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.isComposing && event.target.dataset.stepDraft) {
      event.preventDefault(); event.target.closest('.step-add').querySelector('button').click();
    }
  });
  $('#stepRenameForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const task = ui.state.tasks.find((item) => item.id === renameStep?.taskId);
    if (!task) { $('#stepRenameDialog').close(); return; }
    if (await changeStep(task, {action:'rename', stepId:renameStep.stepId, title:$('#stepRenameTitle').value})) $('#stepRenameDialog').close();
  });
  $('#cancelStepRename').addEventListener('click', () => $('#stepRenameDialog').close());
  window.addEventListener('focus', refreshTemporalUi);
  $("#themeMenuButton").addEventListener("click", () => toggleToolPopover("themeMenuButton", "themePopover"));
  $("#presenceMenuButton").addEventListener("click", () => toggleToolPopover("presenceMenuButton", "presencePopover"));
  window.addEventListener("resize", positionOpenToolPopovers);
  $(".sidebar").addEventListener("scroll", positionOpenToolPopovers, { passive: true });
  $("#themePopover").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-theme-id]");
    if (!button) return;
    ui.state = await window.doneAPI.updatePreferences({ themeId: button.dataset.themeId });
    closeToolPopovers();
    showToast(`已切换为${domain.themeName(button.dataset.themeId)}`);
    render();
  });
  $("#presencePopover").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-presence-status]");
    if (!button) return;
    closeToolPopovers();
    ui.state = await window.doneAPI.setPresence(button.dataset.presenceStatus);
    render();
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest("#sidebarTools")) closeToolPopovers();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeToolPopovers();
  });

  $("#taskForm").addEventListener("submit", (event) => { event.preventDefault(); openAddDialog(); });
  $('#addTaskDetails').addEventListener('submit', saveNewTask);
  $('#cancelAdd').addEventListener('click', () => $('#addTaskDialog').close());
  $('#addTaskDialog').addEventListener('cancel', (event) => { if (addBusy) event.preventDefault(); });
  $('#addTaskDialog').addEventListener('close', () => $('#taskTitle').focus());
  for (const id of ['taskDate', 'taskTime']) {
    $('#' + id).addEventListener('input', () => { addDateEdited = true; updateImmediateHint(); });
  }
  $('#taskPlanMode').addEventListener('change', syncAddSchedule);
  $('#taskReminderMode').addEventListener('change', updateImmediateHint);
  $('#taskReminderMinutes').addEventListener('input', updateImmediateHint);
  $('#startupSwitch').addEventListener('click', async () => {
    if (startupBusy) return;
    startupBusy = true;
    $('#startupSwitch').disabled = true;
    try { await window.doneAPI.setStartup(!startupActual.enabled); }
    catch (error) { showToast(error.message); }
    finally { startupBusy = false; await refreshStartup(); }
  });
  window.addEventListener('focus', refreshStartup);

  $("#taskList").addEventListener("click", async (event) => {
    const suggestion = event.target.closest("[data-suggestion]");
    if (suggestion) {
      $("#taskTitle").value = suggestion.dataset.suggestion;
      $("#taskTitle").focus();
      return;
    }
    const action = event.target.closest("[data-action]");
    const card = event.target.closest(".task-card");
    if (!action || !card) return;
    const task = ui.state.tasks.find((item) => item.id === card.dataset.id);
    if (!task) return;
    const kind = action.dataset.action;
    if(kind==='priority'){
      try{ui.state=await window.doneAPI.updateTask(task.id,{priorityDate:task.priorityDate===domain.toLocalDateInput()?null:domain.toLocalDateInput()});render();}catch(error){showToast(error.message);}return;
    }
    if (kind === 'start-focus') { await startTaskFocus(task); return; }
    if (kind === 'steps') { ui.openSteps.has(task.id) ? ui.openSteps.delete(task.id) : ui.openSteps.add(task.id); renderTaskList(); return; }
    if (kind.startsWith('step-')) {
      const step = (task.steps || []).find((item) => item.id === action.dataset.stepId);
      if (kind === 'step-add') await changeStep(task, {action:'add', title: ui.stepDrafts.get(task.id) || ''});
      if (kind === 'step-check' && step) await changeStep(task, {action:'set-completed', stepId:step.id, completed:!step.completed}, action);
      if (kind === 'step-delete' && step && await window.ThemeConfirm.ask({title:'删除这个小步骤？',message:step.title,confirmLabel:'删除',danger:true})) {
        const current=ui.state.tasks.find(item=>item.id===task.id);
        if(current&&!current.completed&&current.steps.some(item=>item.id===step.id))await changeStep(current,{action:'delete',stepId:step.id});
      }
      if (kind === 'step-rename' && step) { renameStep = {taskId:task.id, stepId:step.id}; $('#stepRenameTitle').value = step.title; $('#stepRenameDialog').showModal(); }
      return;
    }
    if (action.dataset.action === "toggle") await toggleTask(task, card, action);
    if (action.dataset.action === "edit") openEditor(task);
    if (action.dataset.action === "schedule") {
      openEditor(task);
      setTimeout(() => $("#editDate").focus(), 30);
    }
    if (action.dataset.action === "toggle-reminder") {
      ui.state = await window.doneAPI.toggleTaskReminder(task.id);
      showToast(task.reminderActive ? "循环提醒已暂停" : "循环提醒已继续");
      render();
    }
    if (action.dataset.action === "delete") {
      if (!await window.ThemeConfirm.ask({title:'移到回收站？',message:'任务和小步骤可在“设置与备份”的回收站恢复，专注记录会保留。',confirmLabel:'移到回收站',danger:true})) return;
      if(!ui.state.tasks.some(item=>item.id===task.id))return;
      ui.state = await window.doneAPI.deleteTask(task.id);
      showToast("任务已移到回收站");
      render();
    }
  });

  $("#habitScheduleType").addEventListener("change", (event) => {
    const daily = event.target.value === "daily";
    $("#habitIntervalField").hidden = daily;
    $("#habitTimeField").hidden = !daily;
  });
  $("#habitForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const title = $("#habitTitle").value.trim();
    if (!title) return;
    ui.state = await window.doneAPI.addHabit({
      title,
      scheduleType: $("#habitScheduleType").value,
      intervalMinutes: Number($("#habitInterval").value),
      time: $("#habitTime").value
    });
    $("#habitTitle").value = "";
    showToast("已加入每日坚持");
    render();
  });
  $("#habitList").addEventListener("click", async (event) => {
    const action = event.target.closest("[data-habit-action]");
    const card = event.target.closest(".habit-card");
    if (!action || !card) return;
    const habit = (ui.state.habits || []).find((item) => item.id === card.dataset.habitId);
    if (!habit) return;
    if(action.dataset.habitAction==='configure'){window.Workbench.openHabit(habit.id);return;}
    if (action.dataset.habitAction === "toggle") {
      ui.state = await window.doneAPI.updateHabit(habit.id, { active: !habit.active });
      showToast(habit.active ? "习惯提醒已暂停" : "习惯提醒已开启");
    } else if (action.dataset.habitAction === "complete") {
      card.classList.add("is-celebrating");
      burstAt(action.getBoundingClientRect());
      playCompletionSound();
      showReward();
      ui.state = await window.doneAPI.completeHabit(habit.id);
    } else if (action.dataset.habitAction === "delete") {
      ui.state = await window.doneAPI.deleteHabit(habit.id);
      showToast("每日坚持已删除");
    }
    render();
  });
  $("#habitList").addEventListener("change", async (event) => {
    const field = event.target.dataset.habitField;
    const card = event.target.closest(".habit-card");
    if (!field || !card) return;
    const value = field === "intervalMinutes" ? Number(event.target.value) : event.target.value;
    ui.state = await window.doneAPI.updateHabit(card.dataset.habitId, { [field]: value });
    showToast("提醒时间已更新");
    render();
  });

  $$(".nav-item").forEach((button) => button.addEventListener("click", () => setView(button.dataset.view)));
  $$(".status-tabs button[data-filter]").forEach((button) => button.addEventListener("click", () => {
    ui.statusFilter = button.dataset.filter;
    $$(".status-tabs button").forEach((item) => item.classList.toggle("is-active", item === button));
    render();
  }));

  $("#autoSchedule").addEventListener("click", async () => {
    const plan = {
      start: $("#stageStart").value,
      end: $("#stageEnd").value,
      dailyCapacity: Number($("#dailyCapacity").value)
      ,dailyMinutes:Number($('#dailyMinutes').value)
    };
    try {
      await window.Workbench.previewPlan(plan);
    } catch (error) {
      showToast(error.message || "排期失败，请检查阶段日期");
    }
  });

  $("#widgetSwitch").addEventListener("click", async () => {
    try {ui.state=await window.doneAPI.setWidgetVisible(!ui.state.presentation?.widgetRequested);render();}
    catch(error){showToast(error.message);}
  });
  $('#retryWindow').addEventListener('click',async()=>{
    const role=ui.state.presentation?.error?.role;if(role)ui.state=await window.doneAPI.retryWindow(role);
  });
  $("#notificationSwitch").addEventListener("click", async (event) => {
    const enabled = event.currentTarget.getAttribute("aria-checked") !== "true";
    ui.state = await window.doneAPI.updatePreferences({ notifications: enabled });
    render();
  });
  $("#reminderInterval").addEventListener("change", async (event) => {
    ui.state = await window.doneAPI.updatePreferences({ reminderIntervalMinutes: Number(event.target.value) });
    showToast("提醒频率已更新");
  });
  $("#minimizeButton").addEventListener("click", () => window.doneAPI.minimize());
  $("#closeButton").addEventListener("click", () => window.doneAPI.close());

  $("#taskPlanMode").addEventListener("change", () => {
    syncPlanningReminderCompatibility("task");
  });
  $("#taskDeadline").addEventListener("change", syncStageDeadlineFields);

  $("#taskReminderMode").addEventListener("change", () => {
    delete $("#taskReminderMinutes").dataset.edited;
    syncPlanningReminderCompatibility("task");
    updateImmediateHint();
  });
  $("#taskReminderMinutes").addEventListener("input", (event) => { event.target.dataset.edited = "true"; });
  $("#editReminderMode").addEventListener("change", () => {
    delete $("#editReminderMinutes").dataset.edited;
    syncPlanningReminderCompatibility("edit");
  });
  $("#editReminderMinutes").addEventListener("input", (event) => { event.target.dataset.edited = "true"; });
  $("#editScheduleMode").addEventListener("change", syncEditScheduleFields);

  $$("[data-focus-mode]").forEach((button) => button.addEventListener("click", async () => {
    ui.state = await window.doneAPI.updateFocusTimer({
      action: "select",
      mode: button.dataset.focusMode,
      durationMinutes: Number(button.dataset.minutes)
    });
    render();
  }));
  $("#focusDuration").addEventListener("change", async (event) => {
    const activeMode = $("[data-focus-mode].is-active")?.dataset.focusMode || "focus";
    ui.state = await window.doneAPI.updateFocusTimer({ action: "select", mode: activeMode, durationMinutes: Number(event.target.value) });
    render();
  });
  $("#focusStart").addEventListener("click", async () => {
    if (focusBusy) return;
    focusBusy = true;
    try {
      const timer = ui.state.focusTimer;
      ui.state = await window.doneAPI.updateFocusTimer({ action: timer?.status === "running" ? "pause" : "start", sessionId: timer.sessionId });
      render();
    } catch (error) { showToast(error.message); }
    finally { focusBusy = false; }
  });
  $('#focusOpen').addEventListener('click', () => window.doneAPI.showFocusWindow());
  $("#focusReset").addEventListener("click", async () => {
    const sessionId = ui.state.focusTimer?.sessionId;
    if (ui.state.focusTimer?.status !== 'idle' && !await window.ThemeConfirm.ask({title:'结束并重置这一轮？',message:'已投入时间会保留，尚未完成的这一轮不会计入完成轮数。',confirmLabel:'重置本轮',cancelLabel:'继续专注'})) return;
    if(ui.state.focusTimer?.sessionId!==sessionId)return;
    try {
      ui.state = await window.doneAPI.updateFocusTimer({ action: "reset", sessionId });
      render();
    } catch (error) { showToast(error.message); }
  });

  $("#saveEdit").addEventListener("click", async (event) => {
    event.preventDefault();
    const saveButton=event.currentTarget;if(saveButton.disabled)return;
    const title = $("#editTitle").value.trim();
    if (!title) return;
    const scheduleMode = $("#editScheduleMode").value;
    if (scheduleMode === "fixed" && (!$("#editDate").value || !$("#editTime").value)) {
      showToast("请填写自主安排的日期和时间");
      return;
    }
    if(scheduleMode==='day'&&!$('#editDate').value){showToast('请选择安排日期');return;}
    saveButton.disabled=true;
    try{
    ui.state = await window.doneAPI.updateTask($("#editId").value, {
      ...window.Workbench.editFields(),
      title,
      notes: $("#editNotes").value.trim(),
      dueAt: scheduleMode === "fixed" ? dateAtTime($("#editDate").value, $("#editTime").value) : null,
      scheduleMode,
      deadlineDate: $("#editDeadline").value || null,
      deadlineReminderDays: Number($("#editDeadlineDays").value),
      priority: $("#editPriority").value,
      reminderMode: $("#editReminderMode").value,
      reminderMinutes: Number($("#editReminderMinutes").value),
      reminderActive: $("#editReminderMode").value !== "none"
    });
    $("#editDialog").close();
    showToast("任务已更新");
    render();
    }catch(error){showToast(error.message);}finally{saveButton.disabled=false;}
  });

  window.doneAPI.onStateChanged((nextState) => {
    ui.state = nextState;
    if (performance.now() >= ui.suppressRenderUntil) render();
  });
}

async function initialize() {
  const today = domain.toLocalDateInput();
  const stageEnd = new Date();
  stageEnd.setDate(stageEnd.getDate() + 20);
  $("#taskDate").value = today;
  updateClock();
  setInterval(updateClock, 60_000);
  setInterval(updateFocusDisplay, 250);
  setInterval(updateFocusInsights, 1000);
  setInterval(refreshTemporalUi, 30000);
  setInterval(updateImmediateHint, 1000);
  bindEvents();
  window.Workbench.init();
  ui.state = await window.doneAPI.getState();
  await refreshStartup();
  $("#stageStart").value = ui.state.stagePlan?.start || today;
  $("#stageEnd").value = ui.state.stagePlan?.end || domain.toLocalDateInput(stageEnd);
  $("#dailyCapacity").value = String(ui.state.stagePlan?.dailyCapacity || 3);
  $('#dailyMinutes').value=String(ui.state.stagePlan?.dailyMinutes || 120);
  syncStageDeadlineFields();
  syncPlanningReminderCompatibility("task");
  render();
  window.Workbench.ready();
}

initialize().catch((error) => showToast(error.message || "应用加载失败"));
