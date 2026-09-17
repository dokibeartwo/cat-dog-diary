const domain = window.TaskDomain;
const widgetState = { state: { tasks: [], preferences: {} }, suppressRenderUntil: 0 };
let widgetDay = window.TaskDomain.toLocalDateInput();
let widgetFocusBusy = false;
const $ = (selector, parent = document) => parent.querySelector(selector);

function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  })[char]);
}

function dueLabel(task) {
  const deadline = domain.deadlineReminderInfo(task);
  const deadlineSuffix = deadline
    ? deadline.daysRemaining < 0
      ? ` · 截止已过 ${Math.abs(deadline.daysRemaining)} 天`
      : deadline.daysRemaining === 0 ? " · 今天截止" : ` · ${deadline.daysRemaining} 天后截止`
    : "";
  if (task.scheduleMode === "ongoing") return `每天持续推进${deadlineSuffix}`;
  if(task.planDate&&!task.dueAt)return `${domain.isSameDay(task.planDate+'T00:00:00',new Date())?'今天':task.planDate} · 不限具体时间${deadlineSuffix}`;
  if (!task.dueAt) return `等待智能分配${deadlineSuffix}`;
  const date = new Date(task.dueAt);
  const status = domain.getTaskStatus(task);
  const time = date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
  if (status === "ready") return `已到计划时间 · ${date.getMonth() + 1}月${date.getDate()}日 ${time}${deadlineSuffix}`;
  if (domain.isSameDay(date, new Date())) return `今天 ${time}`;
  return `${date.getMonth() + 1}月${date.getDate()}日 ${time}`;
}

function taskMarkup(task, index) {
  const status = domain.getTaskStatus(task);
  return `
    <article class="widget-task" data-id="${escapeHtml(task.id)}" style="animation-delay:${index * 40}ms">
      <button class="widget-check" aria-label="完成 ${escapeHtml(task.title)}"></button>
      <div class="widget-task-copy">
        <strong>${escapeHtml(task.title)}</strong>
        <small>${escapeHtml(dueLabel(task))}</small>
      </div>
      <span class="priority-dot ${escapeHtml(task.priority || "normal")}"></span>
    </article>`;
}

function applyTheme() {
  const themeId = domain.normalizeThemeId(widgetState.state.preferences?.themeId);
  document.documentElement.dataset.themeId = themeId;
  document.documentElement.dataset.previewFamily = domain.themeFamily(themeId);
}

function render() {
  applyTheme();
  const focusMode = Boolean(widgetState.state.presentation?.focusWidget && widgetState.state.focusTimer?.status !== 'idle');
  $('.widget-shell').classList.toggle('is-focus-widget',focusMode);
  $('#focusWidget').hidden = !focusMode;
  if (focusMode) { updateFocusFooter(); return; }
  const openTasks = domain.sortTasks(widgetState.state.tasks.filter((task) => !task.completed));
  const todayTasks = widgetState.state.tasks.filter((task) => domain.isTaskInView(task, "today"));
  const progress = domain.calculateProgress(todayTasks);
  $("#remainingCount").textContent = openTasks.length;
  $("#miniProgress").style.setProperty("--progress", progress.percent);
  $("#progressValue").textContent = `${progress.percent}%`;
  $("#dateLabel").textContent = new Date().toLocaleDateString("zh-CN", { month: "long", day: "numeric", weekday: "long" });
  $("#footerMessage").textContent = progress.percent === 100 && todayTasks.length
    ? "今天，全部完成啦！"
    : openTasks.length > 5
      ? `还有 ${openTasks.length - 5} 项在完整清单里`
      : "只做下一件，就很好。";

  $("#widgetTasks").innerHTML = openTasks.length
    ? openTasks.slice(0, 5).map(taskMarkup).join("")
    : `<div class="widget-empty"><span>✓</span><strong>全部完成啦！</strong><p>今天的任务都被你拿下了，真棒。</p></div>`;
}

function updateFocusFooter() {
  const timer = widgetState.state.focusTimer;
  if (widgetState.state.presentation?.focusWidget && timer && timer.status !== 'idle') {
    const seconds = domain.getFocusRemainingSeconds(timer);
    $('#widgetCountdown').textContent = `${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;
    $('#widgetCountdown').classList.toggle('is-long', seconds >= 6000);
    $('#widgetFocusStatus').textContent = timer.status === 'paused' ? '已暂停' : timer.mode === 'focus' ? '专注中' : '休息中';
    const task=widgetState.state.tasks.find(item=>item.id===timer.taskId);
    const title=timer.mode==='focus'?(task?.title||timer.taskTitle||'自由专注'):timer.mode==='shortBreak'?'短暂休息':'好好休息';
    $('#widgetFocusLabel').textContent=timer.mode==='focus'?'当前任务':'这一刻';
    $('#widgetFocusTask').textContent=title; $('#widgetFocusTask').title=title;
    $('#widgetPause').textContent=timer.status==='paused'?'▶ 继续':'Ⅱ 暂停';
    $('#widgetPause').disabled=widgetFocusBusy;
    const progress=Math.max(0,Math.min(100,100*(1-seconds/(timer.durationMinutes*60))));
    $('#widgetFocusProgress').style.width=`${progress}%`;
    $('.focus-widget-track').setAttribute('aria-valuenow',String(Math.round(progress)));
    return;
  }
  if (!timer || timer.status !== "running" || !timer.endsAt) return;
  const seconds = Math.max(0, Math.ceil((new Date(timer.endsAt).getTime() - Date.now()) / 1000));
  const mode = timer.mode === "focus" ? "专注中" : "休息中";
  $("#footerMessage").textContent = `${mode} · ${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function playSound() {
  if (!widgetState.state.preferences.soundEnabled) return;
  try {
    const Context = window.AudioContext || window.webkitAudioContext;
    const context = new Context();
    const gain = context.createGain();
    const oscillator = context.createOscillator();
    oscillator.type = "triangle";
    oscillator.frequency.setValueAtTime(520, context.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(880, context.currentTime + .18);
    gain.gain.setValueAtTime(.12, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(.001, context.currentTime + .35);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + .35);
    setTimeout(() => context.close(), 500);
  } catch { /* Optional feedback. */ }
}

function burst(button) {
  const layer = $("#widgetBurst");
  const buttonRect = button.getBoundingClientRect();
  const layerRect = layer.getBoundingClientRect();
  const theme = getComputedStyle(document.documentElement);
  const colors = [
    theme.getPropertyValue("--acid").trim(),
    theme.getPropertyValue("--violet").trim(),
    theme.getPropertyValue("--orange").trim(),
    "#ffffff"
  ].filter(Boolean);
  for (let index = 0; index < 20; index += 1) {
    const angle = (Math.PI * 2 * index) / 20;
    const distance = 45 + Math.random() * 65;
    const spark = document.createElement("span");
    spark.className = "spark";
    spark.style.setProperty("--left", `${buttonRect.left - layerRect.left + 10}px`);
    spark.style.setProperty("--top", `${buttonRect.top - layerRect.top + 10}px`);
    spark.style.setProperty("--x", `${Math.cos(angle) * distance}px`);
    spark.style.setProperty("--y", `${Math.sin(angle) * distance}px`);
    spark.style.setProperty("--color", colors[index % colors.length]);
    spark.addEventListener("animationend", () => spark.remove());
    layer.appendChild(spark);
  }
  const reward = $("#microReward");
  reward.classList.remove("is-visible");
  void reward.offsetWidth;
  reward.classList.add("is-visible");
}

async function completeTask(task, card, button) {
  if ((task.steps || []).some((step) => !step.completed) && !await window.ThemeConfirm.ask({title:'一起完成这件事？',message:'还有未完成的小步骤。是否将整件任务及小步骤一起标为完成？',confirmLabel:'一起完成'})) return;
  const current=widgetState.state.tasks.find(item=>item.id===task.id);
  if(!current||current.completed)return;
  widgetState.suppressRenderUntil = performance.now() + 700;
  card.classList.add("is-completing");
  burst(button);
  playSound();
  await new Promise((resolve) => setTimeout(resolve, 540));
  widgetState.state = await window.doneAPI.toggleTask(task.id,false);
  render();
}

function bindEvents() {
  $('#widgetExpand').addEventListener('click',()=>window.doneAPI.showFocusWindow());
  $('#widgetPause').addEventListener('click',async()=>{
    if(widgetFocusBusy)return;widgetFocusBusy=true;
    try {
      const timer=widgetState.state.focusTimer;
      widgetState.state=await window.doneAPI.updateFocusTimer({action:timer.status==='running'?'pause':'start',sessionId:timer.sessionId,presentation:'keep'});
      render();
    } catch(error) { $('#widgetFocusError').textContent=error.message; }
    finally {widgetFocusBusy=false;updateFocusFooter();}
  });
  $("#widgetTasks").addEventListener("click", async (event) => {
    const button = event.target.closest(".widget-check");
    const card = event.target.closest(".widget-task");
    if (!button || !card) return;
    const task = widgetState.state.tasks.find((item) => item.id === card.dataset.id);
    if (task) await completeTask(task, card, button);
  });
  $("#openMain").addEventListener("click", () => window.doneAPI.showMainWindow());
  $("#footerOpen").addEventListener("click", () => window.doneAPI.showMainWindow());
  $("#hideWidget").addEventListener("click", () => window.doneAPI.hideWidget());
  window.doneAPI.onStateChanged((state) => {
    widgetState.state = state;
    if (performance.now() >= widgetState.suppressRenderUntil) render();
  });
}

async function initialize() {
  bindEvents();
  window.WindowReady.install(next=>{widgetState.state=next;render();},next=>[`assets/themes/${domain.normalizeThemeId(next.preferences.themeId)}-widget.png`,'assets/bear-authenticity.png']);
  setInterval(updateFocusFooter, 500);
  setInterval(() => { const day = window.TaskDomain.toLocalDateInput(); if (day !== widgetDay) { widgetDay = day; render(); } }, 30000);
}

initialize();
