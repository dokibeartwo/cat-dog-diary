const $ = (selector) => document.querySelector(selector);
let activeReminder = null;
let lastSoundKey = null;
let actionPending = false;
let soundEnabled = true;
function applyTheme(state){document.documentElement.dataset.themeId=window.TaskDomain.normalizeThemeId(state.preferences.themeId);document.documentElement.dataset.previewFamily=window.TaskDomain.themeFamily(state.preferences.themeId);soundEnabled=state.preferences.soundEnabled!==false;}
const screenIds = new Set(["screen1", "screen2", "screen3", "screen4"]);

function applyScreensaver(screenId) {
  const safeId = screenIds.has(screenId) ? screenId : "screen1";
  const source = `assets/screens/${safeId}.png`;
  $("#screenArtwork").src = source;
  $("#screenBackdrop").style.backgroundImage = `url("${source}")`;
  $("#reminderScreen").dataset.screenId = safeId;
}

function playAttentionSound(key) {
  if (lastSoundKey === key) return;
  lastSoundKey = key;
  try {
    const Context = window.AudioContext || window.webkitAudioContext;
    const context = new Context();
    const master = context.createGain();
    master.gain.setValueAtTime(.0001, context.currentTime);
    master.gain.exponentialRampToValueAtTime(.16, context.currentTime + .03);
    master.gain.exponentialRampToValueAtTime(.0001, context.currentTime + 1.2);
    master.connect(context.destination);
    [392, 523.25, 659.25].forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.value = .65 - index * .1;
      oscillator.connect(gain).connect(master);
      const start = context.currentTime + index * .16;
      oscillator.start(start);
      oscillator.stop(start + .55);
    });
    setTimeout(() => context.close(), 1500);
  } catch { /* Visual reminder remains available if audio is blocked. */ }
}

function updateClock() {
  $("#currentTime").textContent = new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
}

async function render(reminder) {
  if (!reminder) return;
  if (activeReminder?.key !== reminder.key) {
    actionPending = false;
    document.querySelectorAll('footer button').forEach((button) => { button.disabled = false; });
  }
  activeReminder = reminder;
  document.body.classList.toggle('is-light',reminder.presentation==='light');
  const type = reminder.type || "event";
  $("#reminderScreen").dataset.type = type;
  applyScreensaver(reminder.screenId);
  $("#reminderTitle").textContent = reminder.title;
  $("#reminderSubtitle").textContent = reminder.subtitle || "该关注这件事了";
  $("#reminderDetail").textContent = reminder.detail || "停一下，确认此刻最重要的下一步。";
  $("#reminderKicker").textContent = type === "presence"
    ? "AWAY MODE · 暂时离开"
    : type === "event"
    ? "UP NEXT · 即将开始"
    : type === "deadline"
      ? "DEADLINE · 截止提醒"
    : type === "interval"
      ? "PROGRESS CHECK · 阶段检查"
      : type === "habit"
        ? "DAILY RHYTHM · 每日坚持"
        : "FOCUS CYCLE · 专注周期";
  const presenceIcons = { "吃饭中": "🍚", "开会中": "◷", "上厕所": "WC", "有事暂离": "…" };
  $("#signalIcon").textContent = type === "presence"
    ? presenceIcons[reminder.title] || "…"
    : type === "event" ? "!" : type === "deadline" ? "⌛" : type === "interval" ? "↻" : type === "habit" ? "✦" : "✓";

  const hasTask = Boolean(reminder.taskId);
  const hasHabit = Boolean(reminder.habitId);
  const isPresence = type === "presence";
  $("#completeButton").hidden = isPresence || (!hasTask && !hasHabit);
  $("#completeButton").innerHTML = hasHabit ? "<span>✓</span> 这次做到了" : "<span>✓</span> 完成这件事";
  $("#snoozeButton").hidden = isPresence || (!hasTask && !hasHabit);
  $('#snoozeField').hidden = $('#snoozeButton').hidden;
  $("#breakButton").hidden = isPresence || type !== "focus" || reminder.mode !== "focus";
  $('#nextFocusButton').hidden = type !== 'focus' || reminder.mode === 'focus';
  $("#dismissButton").hidden = isPresence;
  $("#returnButton").hidden = !isPresence;
  $("#dismissButton").textContent = type === "focus" ? "稍后再开始" : "我知道了";
  $(".escape-tip").textContent = isPresence ? "按 Esc 也可以表示“我回来了”" : "按 Esc 关闭提醒";

  const duePill = $("#duePill");
  duePill.hidden = !reminder.dueAt;
  if (reminder.dueAt) {
    $("#dueTime").textContent = new Date(reminder.dueAt).toLocaleString("zh-CN", {
      month: "long", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false
    });
  }
  try {await Promise.race([$('#screenArtwork').decode(),new Promise(resolve=>setTimeout(resolve,1200))]);}catch{/* A theme background remains available. */}
  await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  if(activeReminder?.key!==reminder.key)return;
  const ready=await window.doneAPI.reminderReady(reminder.key);
  if (ready && !isPresence && soundEnabled) playAttentionSound(reminder.key);
}

async function act(action, minutes) {
  if (actionPending || !activeReminder) return;
  actionPending = true;
  const key = activeReminder.key;
  document.querySelectorAll('footer button').forEach((button) => { button.disabled = true; });
  try { await window.doneAPI.actOnReminder(key, action, minutes); }
  catch (error) { $('#reminderDetail').textContent = error.message; }
  finally {
    if (activeReminder?.key === key) {
      actionPending = false;
      document.querySelectorAll('footer button').forEach((button) => { button.disabled = false; });
    }
  }
}

$("#dismissButton").addEventListener("click", () => act("dismiss"));
$("#snoozeButton").addEventListener("click", () => act("snooze",Number($('#snoozeMinutes').value)));
$("#completeButton").addEventListener("click", () => act("complete"));
$("#breakButton").addEventListener("click", () => act("start-break"));
$('#nextFocusButton').addEventListener('click', () => act('start-focus'));
$("#returnButton").addEventListener("click", () => window.doneAPI.clearPresence());
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (activeReminder?.type === "presence") window.doneAPI.clearPresence();
    else act("dismiss");
  }
});

window.doneAPI.onReminderChanged(render);
window.doneAPI.getState().then((next) => { applyTheme(next); return window.doneAPI.getActiveReminder(); }).then(render);
window.doneAPI.onStateChanged(applyTheme);
updateClock();
setInterval(updateClock, 1000);
