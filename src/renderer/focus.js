const $ = (selector) => document.querySelector(selector);
let state;
let busy = false;
let confirmSession = null;

function render(next) {
  state = next;
  const theme = window.TaskDomain.normalizeThemeId(next.preferences.themeId);
  document.documentElement.dataset.themeId = theme;
  document.documentElement.dataset.previewFamily = window.TaskDomain.themeFamily(theme);
  const timer = next.focusTimer;
  $('#focusedTask').textContent = timer.mode === 'focus'
    ? (next.tasks.find((task) => task.id === timer.taskId)?.title || timer.taskTitle || '自由专注') : '放松一下，为下一轮充电';
  const screenId = window.TaskDomain.SCREEN_IDS.includes(timer.screenId) ? timer.screenId : 'screen1';
  const asset = `assets/screens/${screenId}.png`;
  if ($('#artwork').getAttribute('src') !== asset) {
    $('#artwork').src = asset;
    $('#backdrop').style.backgroundImage = `url("${asset}")`;
  }
  $('#modeLabel').textContent = timer.status === 'paused' ? '暂停一下，也没关系' : ({ focus: '专注此刻', shortBreak: '短暂休息', longBreak: '好好休息' })[timer.mode];
  $('#pauseButton').textContent = timer.status === 'paused' ? '继续' : '暂停';
  $('#rounds').textContent = `已完成 ${timer.sessionsCompleted} 轮专注`;
  $('#focusCopy').textContent = timer.mode === 'focus' ? '不着急，只把注意力放在这一刻。' : '放下屏幕，喝口水，让思绪透透气。';
  if (timer.sessionId !== confirmSession && window.ThemeConfirm.isOpen()) window.ThemeConfirm.cancel();
  tick();
}

function tick() {
  if (!state) return;
  const timer = state.focusTimer;
  const seconds = window.TaskDomain.getFocusRemainingSeconds(timer);
  $('#countdown').textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  $('#timerOrbit').style.setProperty('--remaining', Math.min(100, 100 * seconds / (timer.durationMinutes * 60)));
}

async function command(action, sessionId = state?.focusTimer.sessionId) {
  if (busy) return;
  busy = true;
  $('#pauseButton').disabled = true;
  try {
    render(await window.doneAPI.updateFocusTimer({ action, sessionId }));
    if (action === 'stop') await window.doneAPI.hideFocusWindow('main');
  } catch (error) { $('#focusError').textContent = error.message; }
  finally { busy = false; $('#pauseButton').disabled = false; }
}
$('#backButton').addEventListener('click', () => window.doneAPI.hideFocusWindow('main'));
$('#pauseButton').addEventListener('click', () => command(state.focusTimer.status === 'running' ? 'pause' : 'start'));
$('#stopButton').addEventListener('click', async () => {
  const sessionId=state.focusTimer.sessionId;confirmSession=sessionId;
  const accepted=await window.ThemeConfirm.ask({title:'结束这一轮吗？',message:'已投入时间会保留，尚未完成的这一轮不计入完成轮数。',confirmLabel:'结束本轮',cancelLabel:'继续专注'});
  if(accepted&&state.focusTimer.sessionId===sessionId&&state.focusTimer.status!=='idle')command('stop',sessionId);
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !window.ThemeConfirm.isOpen()) { event.preventDefault(); window.doneAPI.hideFocusWindow('widget'); }
});
window.doneAPI.onStateChanged(render);
window.WindowReady.install(render, next=>[`assets/screens/${window.TaskDomain.SCREEN_IDS.includes(next.focusTimer.screenId)?next.focusTimer.screenId:'screen1'}.png`,'assets/bear-authenticity.png']);
setInterval(tick, 250);
