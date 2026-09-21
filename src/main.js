const { app, BrowserWindow, ipcMain, Notification, Tray, Menu, nativeImage, screen, desktopCapturer, globalShortcut, powerMonitor, dialog } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { pathToFileURL } = require("node:url");
const domain = require("./shared/domain.js");
const runtime = require("./shared/runtime.js");
const productivity = require('./shared/productivity.js');
const diary = require('./shared/diary-v1.js');
const {StateStore} = require('./state-store.js');
const {WindowCoordinator}=require('./window-coordinator.js');
const {assertTrustedSender,secureContents}=require('./security.js');
const {SyncService, applyEntities}=require('./sync-service.js');

let mainWindow;
let widgetWindow;
let reminderWindow;
let focusWindow;
let summaryDeferred = false;
let summaryNotification;
let tray;
let quitting = false;
let reminderTimer;
let precisionTimer;
let activeReminder = null;
let lastScreenId = null;
let state;
let store;
let syncService;
let syncingRemote = false;
let cloudSyncTimer;
let quickShortcutAvailable=false;
let dayChecked=null;
let schedulePreview=null;
let restorePreview=null;
let reminderReadyTimer;
const themeConceptMode = process.argv.includes("--capture-theme-456");
const captureMode = process.argv.includes("--capture") || themeConceptMode;
const stabilityQaMode=process.argv.includes('--qa-windows');
const v1QaMode=process.argv.includes('--qa-v1');
const releaseSmokeMode=process.argv.includes('--qa-release-smoke');
const isolatedMode=captureMode||stabilityQaMode||v1QaMode||releaseSmokeMode;
if(v1QaMode){process.on('uncaughtException',error=>{fs.appendFileSync(path.join(process.cwd(),'qa-uncaught.log'),error.stack+'\n');app.exit(1);});process.on('unhandledRejection',error=>{fs.appendFileSync(path.join(process.cwd(),'qa-uncaught.log'),String(error?.stack || error)+'\n');app.exit(1);});}
const reminderPreviewMode = process.argv.includes("--preview-reminder");
const autoStartMode = process.argv.includes("--autostart");

app.setName("猫狗日记");
app.on('web-contents-created',(_event,contents)=>secureContents(contents));
// Chromium's GPU compositor can leave a one-pixel non-client seam around
// transparent frameless windows on Windows. This app is UI-light, so software
// compositing is the stable choice for a consistently transparent widget.
app.disableHardwareAcceleration();
// Capture-only windows use isolated data and must be able to render while the
// installed app is running. Normal launches still keep the single-instance rule.
const hasSingleInstanceLock = isolatedMode || app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();
app.on("second-instance", (_event, argv) => {
  if (!argv.includes("--autostart")) showMainWindow();
});
if (isolatedMode) {
  const captureUserData = stabilityQaMode||v1QaMode||releaseSmokeMode ? fs.mkdtempSync(path.join(os.tmpdir(),'cat-dog-diary-stability-')) : path.join(os.tmpdir(), "cat-dog-diary-capture-user-data");
  fs.mkdirSync(captureUserData, { recursive: true });
  app.setPath("userData", captureUserData);
}
if (process.platform === "win32") app.setAppUserModelId("com.catdogdiary.todo");

const DEFAULT_STATE = {
  schemaVersion: diary.SCHEMA,
  reminderHistory: [],
  trash: [],
  tasks: [],
  pendingReminders: [],
  focusHistory: [],
  habits: [
    { id: "starter-water", title: "喝水，起来走走", icon: "💧", scheduleType: "interval", intervalMinutes: 60, time: "09:00", active: true, nextReminderAt: null, lastCompletedAt: null, completionCount: 0 },
    { id: "starter-eyes", title: "放松眼睛和肩颈", icon: "🌿", scheduleType: "interval", intervalMinutes: 45, time: "09:00", active: true, nextReminderAt: null, lastCompletedAt: null, completionCount: 0 },
    { id: "starter-words", title: "背单词", icon: "Aa", scheduleType: "daily", intervalMinutes: 60, time: "08:00", active: true, nextReminderAt: null, lastCompletedAt: null, completionCount: 0 }
  ],
  stagePlan: {
    start: null,
    end: null,
    dailyCapacity: 3,
    lastPlannedAt: null
  },
  focusTimer: {
    mode: "focus",
    durationMinutes: 25,
    status: "idle",
    endsAt: null,
    pausedRemainingSeconds: 1500,
    sessionsCompleted: 0,
    sessionId: null,
    screenId: null
  },
  preferences: {
    notifications: true,
    reminderIntervalMinutes: 30,
    widgetVisible: true,
    soundEnabled: true,
    themeId: "bg1"
  },
  presence: {
    active: false,
    status: null,
    startedAt: null,
    screenId: null
  }
};

function createCaptureState() {
  const now = new Date();
  const atOffset = (hours) => new Date(now.getTime() + hours * 60 * 60 * 1000).toISOString();
  return {
    pendingReminders: [],
    focusHistory: [],
    tasks: [
      { id: "preview-1", title: "完成产品首页原型", notes: "先做到能看、能点、能感受", dueAt: atOffset(2), priority: "high", scheduleMode: "fixed", reminderMode: "event", reminderMinutes: 10, reminderActive: true, completed: false, createdAt: atOffset(-3), completedAt: null },
      { id: "preview-2", title: "散步 20 分钟", notes: "让大脑透一口气", dueAt: atOffset(5), priority: "normal", scheduleMode: "auto", reminderMode: "none", completed: false, createdAt: atOffset(-2), completedAt: null },
      { id: "preview-3", title: "回复两封重要邮件", notes: "", dueAt: atOffset(-1), priority: "normal", scheduleMode: "fixed", completed: true, createdAt: atOffset(-5), completedAt: atOffset(-1) },
      { id: "preview-4", title: "为明天列出三个重点", notes: "", dueAt: atOffset(20), priority: "low", scheduleMode: "auto", reminderMode: "none", completed: false, createdAt: atOffset(-1), completedAt: null },
      { id: "preview-5", title: "运行多组对照实验", notes: "每天推进一点，不设具体执行时间", dueAt: null, deadlineDate: domain.toLocalDateInput(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 3)), deadlineReminderDays: 3, priority: "normal", scheduleMode: "ongoing", reminderMode: "interval", reminderMinutes: 120, reminderActive: true, completed: false, createdAt: atOffset(-1), completedAt: null }
    ],
    habits: DEFAULT_STATE.habits.map((habit) => prepareHabitReminder({ ...habit }, true)),
    stagePlan: {
      start: domain.toLocalDateInput(new Date(now.getFullYear(), now.getMonth(), now.getDate())),
      end: domain.toLocalDateInput(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 20)),
      dailyCapacity: 3,
      lastPlannedAt: now.toISOString()
    },
    focusTimer: { ...DEFAULT_STATE.focusTimer, sessionsCompleted: 2 },
    preferences: { ...DEFAULT_STATE.preferences, notifications: false },
    presence: { ...DEFAULT_STATE.presence }
  };
}

function validReminderMode(value) {
  return ["none", "event", "interval"].includes(value) ? value : "none";
}

function prepareTaskReminder(task, reset = false) {
  task.reminderMode = validReminderMode(task.reminderMode);
  task.reminderMinutes = Math.min(10_080, Math.max(1, Number(task.reminderMinutes) || (task.reminderMode === "interval" ? 120 : 10)));
  if (task.completed || task.reminderMode === "none") {
    task.nextReminderAt = null;
    if (task.reminderMode === "none") task.reminderActive = false;
    return task;
  }

  if (task.reminderMode === "event") {
    task.reminderActive = true;
    if (!task.dueAt) {
      task.nextReminderAt = null;
      return task;
    }
    if (reset) task.reminderFiredForDueAt = null;
    if (task.reminderFiredForDueAt === task.dueAt && !task.nextReminderAt) return task;
    if (reset || !task.nextReminderAt) {
      task.nextReminderAt = domain.calculateNextReminderAt(task);
    }
    return task;
  }

  if (task.reminderActive) {
    if (reset || !task.nextReminderAt) {
      task.nextReminderAt = domain.calculateNextReminderAt(task);
    }
  } else {
    task.nextReminderAt = null;
  }
  return task;
}

function normalizeTask(task) {
  const dueAt = task?.dueAt && !Number.isNaN(new Date(task.dueAt).getTime())
    ? new Date(task.dueAt).toISOString()
    : null;
  const requestedMode = ["fixed", "auto", "backlog", "ongoing", "day"].includes(task?.scheduleMode)
    ? task.scheduleMode
    : dueAt ? "fixed" : "backlog";
  const scheduleMode = requestedMode === "ongoing"
    ? "ongoing"
    : dueAt ? (requestedMode === "auto" ? "auto" : "fixed") : domain.normalizeLocalDate(task?.planDate) ? (requestedMode==='auto'?'auto':'day') : "backlog";
  const reminderDaysValue = Number(task?.deadlineReminderDays);
  return prepareTaskReminder({
    reminderMode: "none",
    reminderMinutes: 10,
    reminderActive: false,
    nextReminderAt: null,
    reminderFiredForDueAt: null,
    deadlineDate: null,
    deadlineReminderDays: 3,
    deadlineLastRemindedDate: null,
    inStage: true,
    ...task,
    ...diary.taskFields(task),
    title: String(task?.title || '').trim(),
    notes: String(task?.notes || ''),
    priority: ['high','normal','low'].includes(task?.priority) ? task.priority : 'normal',
    completed: task?.completed === true,
    steps: productivity.normalizeSteps(task?.steps),
    dueAt: scheduleMode === "ongoing" ? null : dueAt,
    scheduleMode,
    deadlineDate: domain.normalizeLocalDate(task?.deadlineDate),
    deadlineReminderDays: Number.isFinite(reminderDaysValue)
      ? Math.min(365, Math.max(0, Math.round(reminderDaysValue)))
      : 3,
    deadlineLastRemindedDate: domain.normalizeLocalDate(task?.deadlineLastRemindedDate)
  });
}

function habitIcon(title, fallback = "✦") {
  const value = String(title || "");
  if (/水|喝/.test(value)) return "💧";
  if (/眼|肩|颈|走|动|休息|放松/.test(value)) return "🌿";
  if (/词|英语|学习|读书/.test(value)) return "Aa";
  return String(fallback || "✦").slice(0, 2);
}

function prepareHabitReminder(habit, reset = false) {
  Object.assign(habit, diary.habitFields(habit));
  habit.title = String(habit.title || "每日习惯").trim().slice(0, 80) || "每日习惯";
  habit.icon = habitIcon(habit.title, habit.icon);
  habit.scheduleType = habit.scheduleType === "daily" ? "daily" : "interval";
  habit.intervalMinutes = Math.min(1_440, Math.max(5, Number(habit.intervalMinutes) || 60));
  habit.time = /^\d{2}:\d{2}$/.test(String(habit.time || "")) ? habit.time : "08:00";
  if(!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(habit.time))throw Error('请填写有效的 24 小时时间');
  if(reset && habit.active!==false && (!habit.days.length || (habit.scheduleType==='daily' && !diary.nextHabit(habit))))throw Error('所选提醒时间不在启用的日期或时段内，请调整后保存');
  habit.active = habit.active !== false;
  habit.completionCount = Math.max(0, Number(habit.completionCount) || 0);
  if (!habit.active) habit.nextReminderAt = null;
  else if (reset || !habit.nextReminderAt || Number.isNaN(new Date(habit.nextReminderAt).getTime())) {
    habit.nextReminderAt = diary.nextHabit(habit);
  }
  return habit;
}

function normalizeHabit(habit) {
  return prepareHabitReminder({
    id: crypto.randomUUID(),
    title: "每日习惯",
    icon: "✦",
    scheduleType: "interval",
    intervalMinutes: 60,
    time: "08:00",
    active: true,
    nextReminderAt: null,
    lastCompletedAt: null,
    completionCount: 0,
    createdAt: new Date().toISOString(),
    ...habit
  });
}

function createDefaultState() {
  const result = structuredClone(DEFAULT_STATE);
  result.habits = result.habits.map((habit) => normalizeHabit({...habit,active:false}));
  result.preferences={...result.preferences,...diary.preferences(),onboardingDone:false};
  return result;
}

function normalizePreferences(preferences = {}) {
  return {
    ...diary.preferences(preferences),
    notifications: preferences.notifications !== false,
    reminderIntervalMinutes: [15, 30, 60, 120].includes(Number(preferences.reminderIntervalMinutes))
      ? Number(preferences.reminderIntervalMinutes)
      : DEFAULT_STATE.preferences.reminderIntervalMinutes,
    widgetVisible: preferences.widgetVisible !== false,
    soundEnabled: preferences.soundEnabled !== false,
    themeId: domain.normalizeThemeId(preferences.themeId)
  };
}

function normalizePresence(presence = {}) {
  const status = domain.normalizePresenceStatus(presence.status);
  const screenId = domain.SCREEN_IDS.includes(presence.screenId) ? presence.screenId : null;
  const startedAt = presence.startedAt && !Number.isNaN(new Date(presence.startedAt).getTime())
    ? new Date(presence.startedAt).toISOString()
    : null;
  const active = presence.active === true && Boolean(status && startedAt && screenId);
  return {
    active,
    status: active ? status : null,
    startedAt: active ? startedAt : null,
    screenId: active ? screenId : null
  };
}

function dataPath() {
  return path.join(app.getPath("userData"), "done-data.json");
}

function legacyDataPath() {
  return path.join(app.getPath("appData"), "Done", "done-data.json");
}

function normalizeState(parsed) {
      parsed=diary.migrate(parsed);
      const restored = {
        schemaVersion: diary.SCHEMA,
        reminderHistory: parsed.reminderHistory,
        trash: parsed.trash,
        tasks: Array.isArray(parsed.tasks) ? parsed.tasks.map(normalizeTask) : [],
        habits: (Array.isArray(parsed.habits) ? parsed.habits : DEFAULT_STATE.habits).map(normalizeHabit),
        stagePlan: { ...DEFAULT_STATE.stagePlan, ...parsed.stagePlan },
        focusTimer: runtime.normalizeFocus(parsed.focusTimer),
        pendingReminders: Array.isArray(parsed.pendingReminders) ? parsed.pendingReminders.filter((item) => item && typeof item.key === 'string') : [],
        focusHistory: productivity.normalizeHistory(parsed.focusHistory),
        preferences: normalizePreferences(parsed.preferences),
        presence: normalizePresence(parsed.presence)
      };
      runtime.reconcile(restored);
      return restored;
}
function loadState() {
  store ||= new StateStore(dataPath(),legacyDataPath(),fs);
  const parsed=store.load();
  return parsed ? normalizeState(parsed) : createDefaultState();
}

function saveState(next=state) {
  store ||= new StateStore(dataPath(),legacyDataPath(),fs);
  store.save(next);
}

function publicState() {
  return {...structuredClone(state),appVersion:app.getVersion?.() || '1.0.0',presentation:windows().state(),dataStatus:{readOnly:Boolean(store?.readOnly),message:store?.issue || ''},sync:syncService?.status() || {configured:false,signedIn:false,pending:0,conflicts:0},quickShortcutAvailable};
}

function broadcastState() {
  const payload = publicState();
  for (const window of [mainWindow, widgetWindow, focusWindow, reminderWindow]) {
    if (window && !window.isDestroyed()) window.webContents.send("state:changed", payload);
  }
  updateTrayMenu();
}

function broadcastActiveReminder() {
  if (reminderWindow && !reminderWindow.isDestroyed()) {
    reminderWindow.webContents.send("reminder:changed", structuredClone(activeReminder));
  }
}

function mutateState(mutator) {
  if(store?.readOnly)throw Error(store.issue);
  const draft = structuredClone(state);
  mutator(draft);
  for(const task of [...draft.tasks]) {
    const child=diary.spawnNext(draft,task,()=>crypto.randomUUID());
    if(child)prepareTaskReminder(child,true);
  }
  runtime.reconcile(draft);
  if (!syncingRemote) syncService?.capture(state, draft);
  if (!captureMode) saveState(draft);
  state = draft;
  if (state.focusTimer.status === 'idle') windows().finish();
  broadcastState();
  if (activeReminder && activeReminder.type !== 'presence'
    && !state.pendingReminders.some((item) => item.key === activeReminder.key)) {
    activeReminder = null;
    reminderWindow?.hide();
  }
  setTimeout(showNextBigReminder, 0);
  syncWidgetWindow();
  return publicState();
}

async function runCloudSync() {
  if (!syncService?.status().signedIn) throw Error('请先在设置中登录同步账号');
  let result;
  try { result = await syncService.sync(); }
  catch (error) { syncService.meta.lastError = String(error.message || error); syncService.save(); throw error; }
  syncService.meta.lastError = null; syncService.save();
  if (result.pulled?.length) {
    syncingRemote = true;
    try {
      state = normalizeState(applyEntities(state, result.pulled));
      if (!captureMode) saveState(state);
      // Keep the per-account local snapshot aligned with the state that is
      // now visible. It is used when the user later switches accounts; using
      // the pre-pull snapshot could otherwise re-show stale tasks.
      syncService.saveLocalSnapshot(state);
    } finally { syncingRemote = false; }
    dayChecked = null;
    resetReminderSchedule();
    broadcastState();
    windows().sync();
  }
  return { ...publicState(), syncResult: { pushed: result.pushed, pulled: result.pulled?.length || 0, conflicts: result.conflicts || 0 } };
}

function createTrayImage() {
  return nativeImage
    .createFromPath(path.join(__dirname, "renderer", "assets", "bear-authenticity.png"))
    .resize({ width: 16, height: 16 });
}

function appIconPath() {
  return path.join(__dirname, "renderer", "assets", "cat-dog-diary.ico");
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 920,
    minWidth: 960,
    minHeight: 640,
    show: false,
    frame: false,
    titleBarStyle: "hidden",
    backgroundColor: "#fff7d4",
    icon: appIconPath(),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
  mainWindow.once("ready-to-show", () => { if (!autoStartMode) mainWindow.show(); });
  mainWindow.on("close", (event) => {
    if (!quitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

function createWidgetWindow() { return windows().ensure('widget').win; }
function createFocusWindow() { return windows().ensure('focus').win; }
function createManagedWindow(role) {
  const common={preload:path.join(__dirname,'preload.js'),contextIsolation:true,nodeIntegration:false,backgroundThrottling:false};
  if(role==='widget') {
    const area=screen.getPrimaryDisplay().workArea;
    widgetWindow=new BrowserWindow({title:'猫狗日记小组件',width:420,height:590,minWidth:420,maxWidth:420,minHeight:590,maxHeight:590,
      x:Math.max(area.x,area.x+area.width-444),y:area.y+24,frame:false,transparent:true,backgroundColor:'#00000000',autoHideMenuBar:true,
      alwaysOnTop:true,skipTaskbar:true,resizable:false,thickFrame:false,hasShadow:false,show:false,webPreferences:common});
    widgetWindow.setMenu(null);widgetWindow.setMenuBarVisibility(false);widgetWindow.setBackgroundColor('#00000000');
    return widgetWindow;
  }
  focusWindow=new BrowserWindow({...screen.getPrimaryDisplay().bounds,frame:false,show:false,fullscreen:false,backgroundColor:'#2b2240',icon:appIconPath(),webPreferences:common});
  return focusWindow;
}
let windowCoordinator;
function windows() {
  if(!windowCoordinator)windowCoordinator=new WindowCoordinator({
    state:()=>state,snapshot:()=>publicState(),overlay:()=>state?.presence.active?'presence':activeReminder&&diary.reminderStyle(state,activeReminder)!=='light'?'reminder':null,
    create:createManagedWindow,load:(role,win)=>win.loadFile(path.join(__dirname,'renderer',role==='widget'?'widget.html':'focus.html')),
    changed:()=>broadcastState(),hideMain:()=>mainWindow?.hide(),showMain:()=>showMainWindow(),
    setPreference:(enabled)=>{state.preferences.widgetVisible=enabled;if(!captureMode)saveState();},
    quitting:()=>quitting,log:writeWindowLog,setTimeout,clearTimeout
  });
  return windowCoordinator;
}
function writeWindowLog(entry) {
  try {
    const folder=path.join(app.getPath('userData'),'logs');fs.mkdirSync(folder,{recursive:true});
    const file=path.join(folder,'window-diagnostics.log');
    if(fs.existsSync(file)&&fs.statSync(file).size>524288) {
      const previous=path.join(folder,'window-diagnostics.previous.log');
      if(fs.existsSync(previous))fs.unlinkSync(previous);
      fs.renameSync(file,previous);
    }
    fs.appendFileSync(file,JSON.stringify({at:new Date().toISOString(),...entry})+'\n','utf8');
  }catch{/* A diagnostic disk failure must not interfere with the app. */}
}
function syncWidgetWindow() { windows().sync(); }
function syncFocusWindow() { windows().sync(); }
function hideWidgetWindow() { windows().setWidget(false); }
function showFocusWindow() { windows().requestFull(); }
function hideFocusWindow(target='main') { windows().leaveFull(target);return publicState(); }

function startupSettings() {
  const supported = process.platform === 'win32' && app.isPackaged && !isolatedMode;
  if (!supported) return { supported: false, enabled: false, blocked: false };
  const settings = app.getLoginItemSettings({ path: process.execPath, args: ['--autostart'] });
  const own = (settings.launchItems || []).find((item) => item.name === 'com.catdogdiary.todo');
  const blocked = Boolean(settings.openAtLogin && own && !own.enabled);
  return { supported: true, enabled: Boolean(settings.openAtLogin && !blocked), blocked };
}

function setStartup(enabled) {
  if (typeof enabled !== 'boolean' || !startupSettings().supported) throw new Error('请从正式版 EXE 设置开机自启动');
  // Only this explicit user action writes a current-user login entry.
  app.setLoginItemSettings({ openAtLogin: enabled, path: process.execPath,
    args: ['--autostart'], name: 'com.catdogdiary.todo', enabled });
  const actual = startupSettings();
  if (actual.enabled !== enabled) throw new Error('启动项未生效，可能已被 Windows 或安全软件禁用');
  return actual;
}

function createReminderWindow() {
  const display = screen.getPrimaryDisplay();
  reminderWindow = new BrowserWindow({
    x: display.bounds.x,
    y: display.bounds.y,
    width: display.bounds.width,
    height: display.bounds.height,
    frame: false,
    transparent: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    backgroundColor: "#281f37",
    icon: appIconPath(),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      // Reused, hidden reminders still need to prepare their next painted frame.
      backgroundThrottling: false
    }
  });
  reminderWindow.setAlwaysOnTop(true, "screen-saver");
  reminderWindow.webContents.on('did-finish-load',broadcastActiveReminder);
  reminderWindow.webContents.on('render-process-gone',()=>{
    clearTimeout(reminderReadyTimer);reminderWindow?.destroy();reminderWindow=null;
    showMainWindow();mainWindow?.webContents.send('app:notice','提醒画面异常，事项仍保留在提醒中心，请重新打开。');
  });
  reminderWindow.on("close", (event) => {
    if (!quitting) {
      event.preventDefault();
      if (state?.presence?.active) setTimeout(showPresenceScreen, 40);
      else dismissReminder(activeReminder?.key, 'dismiss');
    }
  });
  reminderWindow.loadFile(path.join(__dirname, "renderer", "reminder.html"));
}

function nextScreenId() {
  const selected = domain.chooseNextScreenId(lastScreenId);
  lastScreenId = selected;
  return selected;
}

function withFixedScreen(reminder) {
  const screenId = domain.SCREEN_IDS.includes(reminder.screenId) ? reminder.screenId : nextScreenId();
  lastScreenId = screenId;
  return { ...reminder, screenId };
}

function revealActiveReminder() {
  if (!activeReminder) return;
  activeReminder.presentation=activeReminder.type==='presence'?'fullscreen':diary.reminderStyle(state,activeReminder);
  windows().sync();
  if (!reminderWindow || reminderWindow.isDestroyed()) createReminderWindow();
  const area=screen.getPrimaryDisplay().workArea;
  reminderWindow.setBounds(activeReminder.presentation==='light'
    ? {x:area.x+area.width-464,y:area.y+area.height-338,width:440,height:314}
    : screen.getPrimaryDisplay().bounds);
  broadcastActiveReminder();
  clearTimeout(reminderReadyTimer);
  const key=activeReminder.key;
  reminderReadyTimer=setTimeout(()=>{
    if(activeReminder?.key!==key)return;
    reminderWindow?.hide();showMainWindow();
    mainWindow?.webContents.send('app:notice','提醒画面未及时就绪；提醒仍在提醒中心，可以在那里处理或重试。');
  },12000);
}
function revealReadyReminder(event,key) {
  if(!activeReminder||activeReminder.key!==key||reminderWindow?.webContents!==event.sender||quitting)return false;
  clearTimeout(reminderReadyTimer);
  if(activeReminder.presentation==='light') {
    const area=screen.getPrimaryDisplay().workArea;
    reminderWindow.setBounds({x:area.x+area.width-464,y:area.y+area.height-338,width:440,height:314});
    reminderWindow.showInactive();
  } else {
    reminderWindow.setBounds(screen.getPrimaryDisplay().bounds);reminderWindow.show();reminderWindow.focus();
  }
  return true;
}

function presenceReminder() {
  if (!state?.presence?.active) return null;
  const startedAt = new Date(state.presence.startedAt);
  const time = startedAt.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
  return {
    key: `presence:${state.presence.startedAt}`,
    type: "presence",
    title: state.presence.status,
    subtitle: "暂时不在工位",
    detail: `离开时间 ${time} · 回来后会依次显示期间积累的提醒`,
    startedAt: state.presence.startedAt,
    screenId: state.presence.screenId
  };
}

function showPresenceScreen() {
  const reminder = presenceReminder();
  if (!reminder) return;
  activeReminder = reminder;
  revealActiveReminder();
}

function showNextBigReminder() {
  if (!state || quitting) return;
  if (state?.presence?.active) {
    if (activeReminder?.type !== 'presence') showPresenceScreen();
    return;
  }
  if (activeReminder) return;
  activeReminder = runtime.pickNext(state);
  if (!activeReminder) {
    syncFocusWindow();
    if (summaryDeferred && !runtime.blocksGentleReminders(state)) sendReminder();
    return;
  }
  if (activeReminder.type === 'event') {
    const task = state.tasks.find((item) => item.id === activeReminder.taskId);
    if (task) activeReminder.subtitle = runtime.eventSubtitle(task);
  }
  if (activeReminder.taskId) {
    const task = state.tasks.find((item) => item.id === activeReminder.taskId);
    if (task) { activeReminder.title = task.title; if (task.notes) activeReminder.detail = task.notes; }
  } else if (activeReminder.habitId) {
    const habit = state.habits.find((item) => item.id === activeReminder.habitId);
    if (habit) activeReminder.title = habit.title;
  }
  revealActiveReminder();
}

function enqueueBigReminder(reminder, persist = true) {
  const duplicate = state.pendingReminders.some((item) => runtime.sourceKey(item) === runtime.sourceKey(reminder));
  if (duplicate) return false;
  runtime.enqueue(state, withFixedScreen(reminder));
  if (persist && !captureMode) saveState();
  setTimeout(showNextBigReminder, 0);
  return true;
}

function closeActiveReminder() {
  activeReminder = null;
  if (reminderWindow && !reminderWindow.isDestroyed()) reminderWindow.hide();
  setTimeout(showNextBigReminder, 220);
}

function dismissReminder(key, action, minutes) {
  if (!key || activeReminder?.key !== key || activeReminder.type === 'presence') return publicState();
  const reminder = activeReminder;
  if (['start-break', 'start-focus'].includes(action)
    && (reminder.type !== 'focus' || state.focusTimer.status !== 'idle')) return publicState();
  let handled = false;
  mutateState((draft) => {
    handled = runtime.acknowledge(draft, key, action, minutes);
    if (handled && ['start-break', 'start-focus'].includes(action)) {
      runtime.updateFocus(draft.focusTimer, { action: 'select', mode: action === 'start-break' ? 'shortBreak' : 'focus' });
      runtime.updateFocus(draft.focusTimer, { action: 'start' });
      productivity.beginTracking(draft.focusTimer, null, Date.now(), true);
      draft.focusTimer.screenId = nextScreenId();
    }
  });
  if (handled) closeActiveReminder();
  if(handled&&['start-break','start-focus'].includes(action))windows().requestFull();
  return publicState();
}

function setPresenceStatus(status) {
  const allowedStatus = domain.normalizePresenceStatus(status);
  if (!allowedStatus) throw new Error("无效的离席状态");
  // The visible reminder already belongs to the persisted pending collection.
  activeReminder = null;
  if (reminderWindow && !reminderWindow.isDestroyed()) reminderWindow.hide();
  const startedAt = new Date().toISOString();
  const screenId = nextScreenId();
  const result = mutateState((draft) => {
    draft.presence = { active: true, status: allowedStatus, startedAt, screenId };
  });
  showPresenceScreen();
  return result;
}

function clearPresenceStatus() {
  const wasPresenceScreen = activeReminder?.type === "presence";
  const result = mutateState((draft) => {
    draft.presence = { ...DEFAULT_STATE.presence };
  });
  if (wasPresenceScreen) activeReminder = null;
  if (reminderWindow && !reminderWindow.isDestroyed()) reminderWindow.hide();
  setTimeout(showNextBigReminder, 220);
  return result;
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) createMainWindow();
  mainWindow.show();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
}

function toggleWidget() {
  const enabled=!windows().state().widgetRequested;
  windows().setWidget(enabled);
  return enabled;
}

function updateTrayMenu() {
  if (!tray || !state) return;
  const remaining = state.tasks.filter((task) => !task.completed).length;
  const presenceLabel = state.presence?.active ? ` · ${state.presence.status}` : "";
  tray.setToolTip(`猫狗日记${presenceLabel} · ${remaining} 项待完成`);
  const template = [
    { label: `还有 ${remaining} 项待完成`, enabled: false },
    ...(state.presence?.active ? [
      { label: `当前状态：${state.presence.status}`, enabled: false },
      { label: "我回来了", click: clearPresenceStatus }
    ] : []),
    { type: "separator" },
    { label: "打开猫狗日记", click: showMainWindow },
    { label: '打开专注大屏', enabled: state.focusTimer.status !== 'idle', click: showFocusWindow },
    {
      label: windows().state().widgetRequested ? "隐藏当前小组件" : "显示当前小组件",
      click: toggleWidget
    },
    { type: "separator" },
    { label: "退出", click: () => { quitting = true; app.quit(); } }
  ];
  tray.setContextMenu(Menu.buildFromTemplate(template));
}

function createTray() {
  tray = new Tray(createTrayImage());
  tray.on("double-click", showMainWindow);
  updateTrayMenu();
}

function tasksWorthReminding() {
  const now = Date.now();
  const horizon = now + 24 * 60 * 60 * 1000;
  return state.tasks
    .filter((task) => !task.completed && task.dueAt && new Date(task.dueAt).getTime() <= horizon)
    .sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt));
}

function sendReminder() {
  if (state.preferences.remindersEnabled===false || diary.quiet(state.preferences) || state.presence.active || runtime.blocksGentleReminders(state) || activeReminder) {
    summaryDeferred = true;
    return;
  }
  summaryDeferred = false;
  if (!state.preferences.notifications || !Notification.isSupported()) return;
  const tasks = tasksWorthReminding();
  if (!tasks.length) return;
  const firstThree = tasks.slice(0, 3).map((task) => `• ${task.title}`).join("\n");
  const extra = tasks.length > 3 ? `\n另有 ${tasks.length - 3} 项…` : "";
  summaryNotification?.close();
  const notification = new Notification({
    title: `还有 ${tasks.length} 件事在等你`,
    body: `${firstThree}${extra}`,
    silent: true
  });
  notification.on("click", showMainWindow);
  summaryNotification = notification;
  notification.show();
}

function resetReminderSchedule() {
  clearInterval(reminderTimer);
  const minutes = Math.max(5, Number(state.preferences.reminderIntervalMinutes) || 30);
  reminderTimer = setInterval(sendReminder, minutes * 60 * 1000);
}

function deadlineReminderSubtitle(daysRemaining) {
  if (daysRemaining < 0) return `已超过截止日期 ${Math.abs(daysRemaining)} 天`;
  if (daysRemaining === 0) return "今天截止 · 请优先处理";
  if (daysRemaining === 1) return "明天截止 · 记得推进";
  return `距离截止还有 ${daysRemaining} 天`;
}

function queueStartupDeadlineReminders(now = new Date()) {
  if (!state || captureMode || store?.readOnly) return;
  const today = domain.toLocalDateInput(now);
  const eligible = state.tasks
    .filter((task) => domain.shouldRemindDeadlineOnStartup(task, task.deadlineLastRemindedDate, now))
    .sort((a, b) => String(a.deadlineDate).localeCompare(String(b.deadlineDate)));
  if (!eligible.length) return;

  for (const task of eligible) {
    const info = domain.deadlineReminderInfo(task, now);
    task.deadlineLastRemindedDate = today;
    enqueueBigReminder({
      key: `deadline:${task.id}:${today}`,
      type: "deadline",
      taskId: task.id,
      title: task.title,
      subtitle: deadlineReminderSubtitle(info.daysRemaining),
      detail: task.notes || "这是阶段计划的最终截止日期。今天也推进一点，别把压力留到最后。",
      dueAt: `${info.deadlineDate}T23:59:00`,
      occurredAt: new Date().toISOString()
    });
  }
  saveState();
  broadcastState();
}

function focusRemainingSeconds(timer = state.focusTimer, now = Date.now()) {
  return domain.getFocusRemainingSeconds(timer, now);
}

function precisionTick() {
  if (!state || captureMode || store?.readOnly) return;
  const now = Date.now();
  const today=domain.toLocalDateInput(now);
  if(dayChecked!==today){dayChecked=today;queueStartupDeadlineReminders(new Date(now));broadcastState();}
  runtime.reconcile(state);
  const habitDates=state.habits.map(item=>item.nextReminderAt).join('|');
  const due = runtime.collectDue(state, now);
  const finished = runtime.finishFocus(state, now);
  if (finished) {
    windows().finish();
    enqueueBigReminder(finished, false);
  }
  for (const reminder of due) enqueueBigReminder(reminder, false);
  if (due.length || finished || habitDates!==state.habits.map(item=>item.nextReminderAt).join('|')) {
    saveState();
    broadcastState();
  }
  showNextBigReminder();
}

function registerQuickShortcut() {
  if(isolatedMode || !globalShortcut)return;
  globalShortcut.unregister('CommandOrControl+Alt+N');
  quickShortcutAvailable=state.preferences.quickShortcutEnabled!==false && globalShortcut.register('CommandOrControl+Alt+N',()=>{
    showMainWindow();mainWindow.webContents.send('quick:open');
  });
  broadcastState();
}

function assertCanRestore() {
  if(state.focusTimer.status!=='idle'||state.presence.active)throw Error('请先结束专注并退出离席画面，再恢复数据');
}
function inspectRestore(candidate) {
  const normalized=normalizeState(candidate);
  restorePreview={token:crypto.randomUUID(),state:normalized,expires:Date.now()+5*60000};
  return {token:restorePreview.token,tasks:normalized.tasks.length,habits:normalized.habits.length,focusRecords:normalized.focusHistory.length};
}

function startPrecisionSchedule() {
  clearInterval(precisionTimer);
  const safeTick=()=>{try{precisionTick();}catch(error){writeWindowLog({event:'scheduler-error',message:error.code || 'SAVE_FAILED'});mainWindow?.webContents.send('app:notice','本地数据保存遇到问题，提醒状态可能未保存。请先导出数据并检查磁盘空间。');}};
  precisionTimer = setInterval(safeTick, 1000);
  safeTick();
}

const THEME_PREVIEW_CONFIG = {
  bg2: {
    family: "sky-peach",
    familyName: "晴空蜜桃",
    mainPath: path.join(process.cwd(), "猫狗日记背景", "主程序和小组件背景", "背景2", "主程序2.png"),
    widgetPath: path.join(process.cwd(), "猫狗日记背景", "主程序和小组件背景", "背景2", "小组件2.png")
  },
  bg4: {
    family: "matcha-roast",
    familyName: "奶杏布丁",
    mainPath: path.join(__dirname, "renderer", "assets", "themes", "bg4-main.png"),
    widgetPath: path.join(__dirname, "renderer", "assets", "themes", "bg4-widget.png")
  },
  bg5: {
    family: "soda-coast",
    familyName: "青柠糖球",
    mainPath: path.join(__dirname, "renderer", "assets", "themes", "bg5-main.png"),
    widgetPath: path.join(__dirname, "renderer", "assets", "themes", "bg5-widget.png")
  },
  bg3: {
    family: "berry-love",
    familyName: "莓果心动",
    mainPath: path.join(process.cwd(), "猫狗日记背景", "主程序和小组件背景", "背景3", "主程序3.png"),
    widgetPath: path.join(process.cwd(), "猫狗日记背景", "主程序和小组件背景", "背景3", "小组件3.png")
  },
  bg6: {
    family: "neon-sakura",
    familyName: "蜜桃心语",
    mainPath: path.join(__dirname, "renderer", "assets", "themes", "bg6-main.png"),
    widgetPath: path.join(__dirname, "renderer", "assets", "themes", "bg6-widget.png")
  }
};

function previewImageValue(filePath) {
  return `url("${pathToFileURL(filePath).href}")`;
}

async function applyThemePreview(themeId) {
  const config = THEME_PREVIEW_CONFIG[themeId];
  if (!config) throw new Error(`Unknown theme preview: ${themeId}`);
  if (!fs.existsSync(config.mainPath) || !fs.existsSync(config.widgetPath)) {
    throw new Error(`Theme preview asset missing: ${themeId}`);
  }
  const mainUrl = pathToFileURL(config.mainPath).href;
  const widgetUrl = pathToFileURL(config.widgetPath).href;
  const mainImage = previewImageValue(config.mainPath);
  const widgetImage = previewImageValue(config.widgetPath);
  await Promise.all([
    mainWindow.webContents.executeJavaScript(`(async () => {
      const image = new Image();
      image.src = ${JSON.stringify(mainUrl)};
      await image.decode();
      const root = document.documentElement;
      root.dataset.previewFamily = ${JSON.stringify(config.family)};
      root.dataset.previewTheme = ${JSON.stringify(themeId)};
      root.style.setProperty("--preview-main-image", ${JSON.stringify(mainImage)});
      const label = document.querySelector("#themeCurrentLabel");
      if (label) label.textContent = ${JSON.stringify(config.familyName)};
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    })()`),
    widgetWindow.webContents.executeJavaScript(`(async () => {
      const image = new Image();
      image.src = ${JSON.stringify(widgetUrl)};
      await image.decode();
      const root = document.documentElement;
      root.dataset.previewFamily = ${JSON.stringify(config.family)};
      root.dataset.previewTheme = ${JSON.stringify(themeId)};
      root.style.setProperty("--preview-widget-image", ${JSON.stringify(widgetImage)});
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    })()`)
  ]);
  await new Promise((resolve) => setTimeout(resolve, 160));
  // On Windows, capturePage can return the last composited frame immediately
  // after a large background swap. A discarded capture flushes that frame.
  await Promise.all([mainWindow.capturePage(), widgetWindow.capturePage()]);
  await new Promise((resolve) => setTimeout(resolve, 180));
}

async function clearThemePreview() {
  const script = `(() => {
    const root = document.documentElement;
    delete root.dataset.previewFamily;
    delete root.dataset.previewTheme;
    root.style.removeProperty("--preview-main-image");
    root.style.removeProperty("--preview-widget-image");
  })()`;
  await Promise.all([
    mainWindow.webContents.executeJavaScript(script),
    widgetWindow.webContents.executeJavaScript(script)
  ]);
  await new Promise((resolve) => setTimeout(resolve, 180));
}

function assertTransparentWidgetCorners(image, themeId) {
  const { width, height } = image.getSize();
  const bitmap = image.toBitmap();
  const alphaAt = (x, y) => bitmap[((y * width + x) * 4) + 3];
  const corners = [alphaAt(0, 0), alphaAt(width - 1, 0), alphaAt(0, height - 1), alphaAt(width - 1, height - 1)];
  if (corners.some((alpha) => alpha !== 0)) {
    throw new Error(`Widget transparent-corner QA failed for ${themeId}: ${corners.join(",")}`);
  }
}

async function captureThemePreview(themeId, outputDirectory) {
  const config = THEME_PREVIEW_CONFIG[themeId];
  await applyThemePreview(themeId);
  const palettes = {
    "sky-peach": { ink: "#2d4057", acid: "#f39bac", violet: "#72c9dc", orange: "#ff7f96" },
    "berry-love": { ink: "#4a293b", acid: "#ffd569", violet: "#e98baa", orange: "#ff6462" },
    "matcha-roast": { ink: "#503a2e", acid: "#ffd56f", violet: "#c98fa3", orange: "#ee9c5e" },
    "soda-coast": { ink: "#31554e", acid: "#ffe58d", violet: "#83cdb7", orange: "#ff8c76" },
    "neon-sakura": { ink: "#58333b", acid: "#ffd58a", violet: "#b1a6d8", orange: "#ff807b" }
  };
  const expectedPalette = palettes[config.family];
  const [mainQa, widgetQa] = await Promise.all([
    mainWindow.webContents.executeJavaScript(`(() => {
      const root = document.documentElement;
      const style = getComputedStyle(root);
      return {
        family: root.dataset.previewFamily,
        ink: style.getPropertyValue("--ink").trim(),
        acid: style.getPropertyValue("--acid").trim(),
        violet: style.getPropertyValue("--violet").trim(),
        orange: style.getPropertyValue("--orange").trim(),
        image: root.style.getPropertyValue("--preview-main-image")
      };
    })()`),
    widgetWindow.webContents.executeJavaScript(`(() => {
      const root = document.documentElement;
      const style = getComputedStyle(root);
      const shell = getComputedStyle(document.querySelector(".widget-shell"));
      return {
        family: root.dataset.previewFamily,
        acid: style.getPropertyValue("--acid").trim(),
        image: root.style.getPropertyValue("--preview-widget-image"),
        bodyBackground: getComputedStyle(document.body).backgroundColor,
        shellRadius: shell.borderTopLeftRadius,
        shellOverflow: shell.overflow
      };
    })()`)
  ]);
  if (mainQa.family !== config.family
    || mainQa.ink !== expectedPalette.ink
    || mainQa.acid !== expectedPalette.acid
    || mainQa.violet !== expectedPalette.violet
    || mainQa.orange !== expectedPalette.orange
    || !decodeURIComponent(mainQa.image).includes(path.basename(config.mainPath))) {
    throw new Error(`Main theme QA failed for ${themeId}: ${JSON.stringify(mainQa)}`);
  }
  if (widgetQa.family !== config.family
    || widgetQa.acid !== expectedPalette.acid
    || !decodeURIComponent(widgetQa.image).includes(path.basename(config.widgetPath))
    || widgetQa.bodyBackground !== "rgba(0, 0, 0, 0)"
    || widgetQa.shellRadius !== "24px"
    || widgetQa.shellOverflow !== "hidden") {
    throw new Error(`Widget theme QA failed for ${themeId}: ${JSON.stringify(widgetQa)}`);
  }
  const [mainImage, widgetImage] = await Promise.all([
    mainWindow.capturePage(),
    widgetWindow.capturePage()
  ]);
  assertTransparentWidgetCorners(widgetImage, themeId);
  fs.writeFileSync(path.join(outputDirectory, `theme-${themeId}-main.png`), mainImage.toPNG());
  fs.writeFileSync(path.join(outputDirectory, `theme-${themeId}-widget.png`), widgetImage.toPNG());
}

async function captureInstalledTheme(themeId, outputDirectory) {
  const family = domain.themeFamily(themeId);
  mutateState((draft) => { draft.preferences.themeId = themeId; });
  await new Promise((resolve) => setTimeout(resolve, 220));
  await Promise.all([mainWindow.capturePage(), widgetWindow.capturePage()]);
  await new Promise((resolve) => setTimeout(resolve, 160));
  const [mainQa, widgetQa] = await Promise.all([
    mainWindow.webContents.executeJavaScript(`(() => {
      const root = document.documentElement;
      return {
        themeId: root.dataset.themeId,
        family: root.dataset.previewFamily,
        image: getComputedStyle(root).getPropertyValue("--preview-main-image")
      };
    })()`),
    widgetWindow.webContents.executeJavaScript(`(() => {
      const root = document.documentElement;
      const shell = getComputedStyle(document.querySelector(".widget-shell"));
      return {
        themeId: root.dataset.themeId,
        family: root.dataset.previewFamily,
        image: getComputedStyle(root).getPropertyValue("--preview-widget-image"),
        bodyBackground: getComputedStyle(document.body).backgroundColor,
        shellRadius: shell.borderTopLeftRadius,
        shellOverflow: shell.overflow
      };
    })()`)
  ]);
  const expectedMain = `bg${themeId.replace("bg", "")}-main.png`;
  const expectedWidget = `bg${themeId.replace("bg", "")}-widget.png`;
  if (mainQa.themeId !== themeId || mainQa.family !== family || !mainQa.image.includes(expectedMain)) {
    throw new Error(`Installed main theme QA failed for ${themeId}: ${JSON.stringify(mainQa)}`);
  }
  if (widgetQa.themeId !== themeId
    || widgetQa.family !== family
    || !widgetQa.image.includes(expectedWidget)
    || widgetQa.bodyBackground !== "rgba(0, 0, 0, 0)"
    || widgetQa.shellRadius !== "24px"
    || widgetQa.shellOverflow !== "hidden") {
    throw new Error(`Installed widget theme QA failed for ${themeId}: ${JSON.stringify(widgetQa)}`);
  }
  const [mainImage, widgetImage] = await Promise.all([mainWindow.capturePage(), widgetWindow.capturePage()]);
  assertTransparentWidgetCorners(widgetImage, themeId);
  fs.writeFileSync(path.join(outputDirectory, `theme-${themeId}-main.png`), mainImage.toPNG());
  fs.writeFileSync(path.join(outputDirectory, `theme-${themeId}-widget.png`), widgetImage.toPNG());
}

function themeBoardMarkup({ familyName, familyKey, palette, variants, outputDirectory }) {
  const swatches = palette.map(({ name, hex }) => `<div class="swatch"><i style="background:${hex}"></i><span>${name}<b>${hex}</b></span></div>`).join("");
  const cards = variants.map((themeId) => {
    const mainUrl = pathToFileURL(path.join(outputDirectory, `theme-${themeId}-main.png`)).href;
    const widgetUrl = pathToFileURL(path.join(outputDirectory, `theme-${themeId}-widget.png`)).href;
    return `<article class="variant">
      <div class="variant-title"><span>${domain.themeName(themeId)}</span><small>主程序 + 透明桌面小组件</small></div>
      <div class="mockup"><img class="main-shot" src="${mainUrl}"><img class="widget-shot" src="${widgetUrl}"></div>
    </article>`;
  }).join("");
  return `<!doctype html><html lang="zh-CN" data-family="${familyKey}"><head><meta charset="utf-8"><style>
    *{box-sizing:border-box} html,body{width:100%;height:100%;margin:0;overflow:hidden} body{font-family:"Segoe UI Variable","Microsoft YaHei UI",sans-serif;color:var(--ink);background:var(--board)}
    html[data-family="sky-peach"]{--ink:#2d4057;--soft:#687189;--board:linear-gradient(135deg,#f1fbff,#e5f7fb 42%,#ffe1e9 100%);--line:rgba(52,77,104,.13);--chip:#cf708a}
    html[data-family="berry-love"]{--ink:#4a293b;--soft:#795865;--board:linear-gradient(135deg,#fff5e8,#ffe8e6 48%,#f8d8e3);--line:rgba(74,41,59,.13);--chip:#4a293b}
    body:before{content:"";position:absolute;inset:0;background:radial-gradient(circle at 4% 0%,rgba(255,255,255,.95),transparent 25%),radial-gradient(circle at 96% 8%,rgba(255,255,255,.65),transparent 28%);pointer-events:none}
    main{position:relative;width:100%;height:100%;padding:38px 54px 46px}.top{display:flex;align-items:flex-start;justify-content:space-between;gap:30px;height:125px}.kicker{margin:0 0 7px;color:var(--soft);font-size:16px;font-weight:800;letter-spacing:2.5px}.title{margin:0;font-size:52px;line-height:1;letter-spacing:-2px}.subtitle{margin:10px 0 0;color:var(--soft);font-size:18px}.palette{display:flex;gap:13px;padding-top:10px}.swatch{display:flex;align-items:center;gap:9px;min-width:120px}.swatch i{width:38px;height:38px;border:3px solid rgba(255,255,255,.85);border-radius:13px;box-shadow:0 6px 16px rgba(0,0,0,.08)}.swatch span{font-size:13px;font-weight:750}.swatch b{display:block;margin-top:3px;color:var(--soft);font-size:11px;font-weight:650;letter-spacing:.4px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:28px;height:calc(100% - 125px)}
    .variant{display:flex;flex-direction:column;min-width:0;padding:17px;border:1px solid var(--line);border-radius:28px;background:rgba(255,255,255,.62);box-shadow:0 22px 60px rgba(48,51,68,.11);backdrop-filter:blur(18px)}.variant-title{display:flex;align-items:baseline;justify-content:space-between;padding:0 6px 13px}.variant-title span{font-size:24px;font-weight:850}.variant-title small{color:var(--soft);font-size:13px}.mockup{position:relative;flex:1;min-height:0;overflow:hidden;border-radius:18px;background:#fff;box-shadow:inset 0 0 0 1px var(--line)}.main-shot{display:block;width:100%;height:100%;object-fit:cover;object-position:center}.widget-shot{position:absolute;right:17px;bottom:17px;width:31%;height:auto;border-radius:16px;filter:drop-shadow(0 18px 28px rgba(20,24,34,.34))}.mockup:after{content:"透明圆角已检查";position:absolute;left:18px;bottom:18px;padding:8px 12px;border-radius:999px;color:#fff;background:var(--chip);font-size:12px;font-weight:750;letter-spacing:.3px}
  </style></head><body><main><header class="top"><div><p class="kicker">CAT & DOG DIARY · THEME QA</p><h1 class="title">${familyName}</h1><p class="subtitle">两套独立配色与背景 · 正式主题效果检查</p></div><div class="palette">${swatches}</div></header><section class="grid">${cards}</section></main></body></html>`;
}

async function captureThemeBoard(outputDirectory, board) {
  const htmlPath = path.join(outputDirectory, `theme-overview-${board.familyKey}.html`);
  fs.writeFileSync(htmlPath, themeBoardMarkup({ ...board, outputDirectory }), "utf8");
  const boardWindow = new BrowserWindow({
    width: 1920,
    height: 1080,
    show: false,
    frame: false,
    backgroundColor: board.familyKey === "sky-peach" ? "#f1fbff" : "#fff5e8",
    webPreferences: { offscreen: true }
  });
  await boardWindow.loadFile(htmlPath);
  await new Promise((resolve) => setTimeout(resolve, 500));
  const image = await boardWindow.capturePage();
  fs.writeFileSync(path.join(outputDirectory, `theme-overview-${board.familyKey}.png`), image.toPNG());
  boardWindow.destroy();
}

async function captureTheme456Previews() {
  const outputDirectory = path.join(os.tmpdir(), "cat-dog-diary-previews", "theme-concepts");
  fs.mkdirSync(outputDirectory, { recursive: true });
  await new Promise((resolve) => setTimeout(resolve, 1_400));
  for (const themeId of ["bg4", "bg5", "bg6"]) {
    await captureThemePreview(themeId, outputDirectory);
  }
  await clearThemePreview();
  console.log(`Theme 4/5/6 previews saved to ${outputDirectory}.`);
  quitting = true;
  app.quit();
}

async function captureNewFeatures(outputDirectory) {
  const wait = (ms = 200) => new Promise((resolve) => setTimeout(resolve, ms));
  const js = (code) => mainWindow.webContents.executeJavaScript(code);
  const check = (condition, message) => { if (!condition) throw new Error(`0.5 QA: ${message}`); };
  const readyDeadline = Date.now() + 15000;
  while (!focusWindow?.isVisible() && Date.now() < readyDeadline) await wait(100);
  check(focusWindow?.isVisible(), 'starting focus must show fullscreen: ' + JSON.stringify(windows().state()));
  check(focusWindow.isFullScreen(), 'focus window must fill display');
  const sessionId = state.focusTimer.sessionId;
  const screenId = state.focusTimer.screenId;
  await focusWindow.webContents.executeJavaScript('document.querySelector("#pauseButton").click()');
  await wait();
  check(state.focusTimer.status === 'paused', 'pause from full screen');
  await focusWindow.webContents.executeJavaScript('document.querySelector("#pauseButton").click()');
  await wait();
  check(state.focusTimer.status === 'running' && state.focusTimer.sessionId === sessionId, 'resume same session');
  await focusWindow.webContents.executeJavaScript('document.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape"}))');
  await wait();
  check(!focusWindow.isVisible() && state.focusTimer.status === 'running', 'Esc preserves timer');
  await js('document.querySelector("#focusOpen").click()'); await wait();
  check(focusWindow.isVisible() && state.focusTimer.screenId === screenId, 'reopen preserves screen');
  const focusImage = await focusWindow.capturePage();
  fs.writeFileSync(path.join(outputDirectory, 'focus-fullscreen.png'), focusImage.toPNG());
  for (const themeId of domain.THEME_IDS) {
    mutateState((draft) => { draft.preferences.themeId = themeId; });
    await wait();
    const image = await focusWindow.capturePage();
    fs.writeFileSync(path.join(outputDirectory, `focus-${themeId}.png`), image.toPNG());
  }
  // Check real Chromium layout at both aspect ratios and Windows-like zoom.
  focusWindow.setFullScreen(false); await wait();
  for (const [width, height] of [[1600, 900], [1440, 900]]) {
    focusWindow.setBounds({ x: 0, y: 0, width, height });
    for (const zoom of [1, 1.25, 1.5]) {
      focusWindow.webContents.setZoomFactor(zoom); await wait();
      const metrics = await focusWindow.webContents.executeJavaScript(`(() => {
        const time = document.querySelector('#countdown');
        const controls = [...document.querySelectorAll('.focus-screen button')];
        return { font: parseFloat(getComputedStyle(time).fontSize), fit: controls.every((button) => {
          const r = button.getBoundingClientRect();
          return r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth && r.height >= 48 && parseFloat(getComputedStyle(button).fontSize) >= 18;
        }) };
      })()`);
      check(metrics.font >= 100 && metrics.fit, `focus layout ${width}x${height} @${zoom}: ${JSON.stringify(metrics)}`);
    }
  }
  focusWindow.webContents.setZoomFactor(1);
  focusWindow.setFullScreen(true);
  hideFocusWindow();
  mutateState((draft) => { runtime.updateFocus(draft.focusTimer, { action: 'stop' }); draft.preferences.themeId = 'bg1'; });
  await wait();
  await js('setView("today"); document.querySelector("#taskTitle").value = "整理实验记录，推进下一步"; document.querySelector("#taskForm").requestSubmit()');
  await wait();
  const beforeCount = state.tasks.length;
  check(await js('document.querySelector("#addTaskDialog").open'), 'open task details');
  check(state.tasks.length === beforeCount, 'opening details must not create a task');
  const defaults = await js('({ date: document.querySelector("#taskDate").value, time: document.querySelector("#taskTime").value, priority: document.querySelector("#taskPriority").value, reminder: document.querySelector("#taskReminderMode").value })');
  check(defaults.date === domain.toLocalDateInput() && defaults.time !== '' && defaults.priority === 'normal' && defaults.reminder === 'none', 'task defaults');
  for (const themeId of domain.THEME_IDS) {
    mutateState((draft) => { draft.preferences.themeId = themeId; }); await wait();
    const image = await mainWindow.capturePage();
    fs.writeFileSync(path.join(outputDirectory, `add-task-${themeId}.png`), image.toPNG());
  }
  mutateState((draft) => { draft.preferences.themeId = 'bg1'; }); await wait();
  fs.writeFileSync(path.join(outputDirectory, 'add-task-dialog.png'), (await mainWindow.capturePage()).toPNG());
  await js('document.querySelector("#cancelAdd").click()'); await wait();
  check(state.tasks.length === beforeCount && await js('Boolean(document.querySelector("#taskTitle").value)'), 'cancel preserves title, no task');
  await js(`globalThis.qaDateNow = Date.now;
    Date.now = () => new Date('2026-09-08T23:59:00').getTime();
    document.querySelector('#taskForm').requestSubmit();
    Date.now = () => new Date('2026-09-09T00:01:00').getTime();
    document.querySelector('#confirmAdd').click();
    Date.now = globalThis.qaDateNow; void 0;`);
  await wait(300);
  check(state.tasks.length === beforeCount + 1 && domain.toLocalDateInput(state.tasks.at(-1).dueAt) === '2026-09-09', 'untouched date refreshes across midnight');
  mutateState((draft) => { draft.tasks.pop(); });
  await js('document.querySelector("#taskTitle").value = "验证保存失败保留输入"; document.querySelector("#taskForm").requestSubmit(); document.querySelector("#taskDate").disabled = true; document.querySelector("#taskDate").value = ""; document.querySelector("#taskDate").dispatchEvent(new Event("input")); document.querySelector("#confirmAdd").click()');
  await wait();
  check(await js('document.querySelector("#addTaskDialog").open && Boolean(document.querySelector("#addTaskError").textContent)'), 'failed save retains input and modal');
  await js('document.querySelector("#cancelAdd").click(); document.querySelector("#taskTitle").value = "验证手动安排"');
  await js('document.querySelector("#taskForm").requestSubmit(); document.querySelector("#taskDate").value = "2026-10-01"; document.querySelector("#taskDate").dispatchEvent(new Event("input")); document.querySelector("#taskTime").value = "15:45"; document.querySelector("#confirmAdd").click(); document.querySelector("#confirmAdd").click();');
  await wait(350);
  check(state.tasks.length === beforeCount + 1 && new Date(state.tasks.at(-1).dueAt).getHours() === 15, 'save edited time once');
  mutateState((draft) => { draft.tasks.pop(); });
  await js('setView("stage"); document.querySelector("#taskTitle").value = "无需执行时间的长期实验"; document.querySelector("#taskForm").requestSubmit(); document.querySelector("#taskPlanMode").value = "ongoing"; document.querySelector("#taskPlanMode").dispatchEvent(new Event("change")); document.querySelector("#taskReminderMode").value = "interval"; document.querySelector("#taskReminderMode").dispatchEvent(new Event("change")); document.querySelector("#confirmAdd").click()');
  await wait(350);
  check(state.tasks.length === beforeCount + 1 && state.tasks.at(-1).dueAt === null && state.tasks.at(-1).scheduleMode === 'ongoing', 'untimed ongoing task');
  mutateState((draft) => { draft.tasks.pop(); });
  await js('setView("today")');
  for (const zoom of [1.25, 1.5]) {
    mainWindow.webContents.setZoomFactor(zoom);
    await js('document.querySelector("#taskTitle").value = "调整添加弹窗"; document.querySelector("#taskForm").requestSubmit()');
    await wait();
    const metrics = await js(`(() => {
      const d = document.querySelector('#addTaskDialog');
      const r = d.getBoundingClientRect();
      return { fit: r.top >= 0 && r.bottom <= innerHeight + 1 && d.scrollWidth <= d.clientWidth + 1,
        columns: getComputedStyle(document.querySelector('#addTaskDialog .composer-options')).gridTemplateColumns.split(' ').length };
    })()`);
    check(metrics.fit && metrics.columns === 2, 'add modal zoom layout ' + zoom);
    await js('document.querySelector("#cancelAdd").click()');
  }
  mainWindow.webContents.setZoomFactor(1);
  await js('document.querySelector("#taskTitle").value = ""');
  check(!startupSettings().supported, 'capture cannot register startup');
}

async function capturePreviews() {
  if (!captureMode) return;
  const outputDirectory = path.join(os.tmpdir(), "cat-dog-diary-previews");
  fs.mkdirSync(outputDirectory, { recursive: true });
  await new Promise((resolve) => setTimeout(resolve, 1400));
  const widgetSurface = await widgetWindow.webContents.executeJavaScript(`(() => {
    const body = getComputedStyle(document.body);
    const shell = getComputedStyle(document.querySelector(".widget-shell"));
    return {
      bodyBackground: body.backgroundColor,
      bodyBorder: body.borderTopWidth,
      shellBorder: shell.borderTopWidth,
      shellOutline: shell.outlineStyle,
      shellRadius: shell.borderTopLeftRadius,
      shellOverflow: shell.overflow,
      shellBackdrop: shell.backdropFilter
    };
  })()`);
  if (widgetSurface.bodyBackground !== "rgba(0, 0, 0, 0)"
    || widgetSurface.bodyBorder !== "0px"
    || widgetSurface.shellBorder !== "0px"
    || widgetSurface.shellOutline !== "none"
    || widgetSurface.shellRadius !== "24px"
    || widgetSurface.shellOverflow !== "hidden"
    || widgetSurface.shellBackdrop !== "none"
    || widgetWindow.isResizable()) {
    throw new Error(`Widget transparency QA failed: ${JSON.stringify(widgetSurface)}`);
  }
  const mainControls = await mainWindow.webContents.executeJavaScript(`(() => {
    const buttons = [...document.querySelectorAll(".window-control")];
    return buttons.map((button) => {
      const rect = button.getBoundingClientRect();
      const icon = button.querySelector("svg")?.getBoundingClientRect();
      return { width: rect.width, height: rect.height, iconWidth: icon?.width || 0, iconHeight: icon?.height || 0 };
    });
  })()`);
  const widgetControls = await widgetWindow.webContents.executeJavaScript(`(() => [...document.querySelectorAll(".header-actions button")].map((button) => {
    const rect = button.getBoundingClientRect();
    const icon = button.querySelector("svg")?.getBoundingClientRect();
    return { width: rect.width, height: rect.height, iconWidth: icon?.width || 0, iconHeight: icon?.height || 0 };
  }))()`);
  const controlsAreBalanced = (controls, minimum) => controls.length === 2
    && controls.every((control) => control.width >= minimum && control.height >= minimum - 4 && control.iconWidth >= 19)
    && controls[0].width === controls[1].width
    && controls[0].height === controls[1].height
    && controls[0].iconWidth === controls[1].iconWidth
    && Math.abs(controls[0].iconHeight - controls[1].iconHeight) < .1;
  if (!controlsAreBalanced(mainControls, 44) || !controlsAreBalanced(widgetControls, 40)) {
    throw new Error(`Window controls QA failed: ${JSON.stringify({ mainControls, widgetControls })}`);
  }

  for (const themeId of domain.THEME_IDS) {
    await captureInstalledTheme(themeId, outputDirectory);
  }
  mutateState((draft) => { draft.preferences.themeId = "bg1"; });
  await new Promise((resolve) => setTimeout(resolve, 240));
  await captureThemeBoard(outputDirectory, {
    familyName: "晴空蜜桃 × 青柠糖球",
    familyKey: "sky-peach",
    variants: ["bg2", "bg5"],
    palette: [
      { name: "粉雾蓝", hex: "#A8E3F0" },
      { name: "蜜桃粉", hex: "#F39BAC" },
      { name: "奶油光", hex: "#FFE7A3" },
      { name: "暮海蓝", hex: "#344D68" }
    ]
  });
  await captureThemeBoard(outputDirectory, {
    familyName: "莓果心动 × 蜜桃心语",
    familyKey: "berry-love",
    variants: ["bg3", "bg6"],
    palette: [
      { name: "珊瑚红", hex: "#FF6462" },
      { name: "莓果粉", hex: "#E98BAA" },
      { name: "奶油黄", hex: "#FFD569" },
      { name: "莓果酒", hex: "#4A293B" }
    ]
  });
  await mainWindow.webContents.executeJavaScript('document.querySelector("#themeMenuButton").click()');
  await new Promise((resolve) => setTimeout(resolve, 220));
  const themePickerQa = await mainWindow.webContents.executeJavaScript(`(() => ({
    visible: !document.querySelector("#themePopover").hidden,
    count: document.querySelectorAll("#themePopover [data-theme-id]").length,
    active: document.querySelectorAll("#themePopover [data-theme-id].is-active").length,
    names: [...document.querySelectorAll("#themePopover [data-theme-id] strong")].map((node) => node.textContent.trim()),
    namesFit: [...document.querySelectorAll("#themePopover [data-theme-id] strong")].every((node) => node.scrollHeight <= node.clientHeight + 1),
    hasNumberedBackgroundLabel: [...document.querySelectorAll("#themePopover [data-theme-id]")].some((node) => /背景\s*[1-6]/.test(node.textContent))
  }))()`);
  if (!themePickerQa.visible
    || themePickerQa.count !== 6
    || themePickerQa.active !== 1
    || !themePickerQa.namesFit
    || themePickerQa.hasNumberedBackgroundLabel
    || themePickerQa.names.join("|") !== domain.THEME_IDS.map(domain.themeName).join("|")) {
    throw new Error(`Theme picker QA failed: ${JSON.stringify(themePickerQa)}`);
  }
  const themePickerImage = await mainWindow.capturePage();
  fs.writeFileSync(path.join(outputDirectory, "theme-picker.png"), themePickerImage.toPNG());
  await mainWindow.webContents.executeJavaScript('document.querySelector("#themeMenuButton").click(); document.querySelector("#presenceMenuButton").click()');
  await new Promise((resolve) => setTimeout(resolve, 180));
  const presencePickerQa = await mainWindow.webContents.executeJavaScript(`(() => ({
    visible: !document.querySelector("#presencePopover").hidden,
    statuses: [...document.querySelectorAll("#presencePopover [data-presence-status]")].map((button) => button.dataset.presenceStatus)
  }))()`);
  if (!presencePickerQa.visible || presencePickerQa.statuses.join("|") !== domain.PRESENCE_STATUSES.join("|")) {
    throw new Error(`Presence picker QA failed: ${JSON.stringify(presencePickerQa)}`);
  }
  const presencePickerImage = await mainWindow.capturePage();
  fs.writeFileSync(path.join(outputDirectory, "presence-picker.png"), presencePickerImage.toPNG());
  await mainWindow.webContents.executeJavaScript('document.querySelector("#presenceMenuButton").click()');
  await new Promise((resolve) => setTimeout(resolve, 140));
  const todayComposerQa = await mainWindow.webContents.executeJavaScript(`(() => ({
    hiddenStageFields: [...document.querySelectorAll(".composer-options .stage-only")].every((field) => field.offsetParent === null),
    scheduleMode: document.querySelector("#taskPlanMode").value
  }))()`);
  if (!todayComposerQa.hiddenStageFields || todayComposerQa.scheduleMode !== "backlog") {
    throw new Error(`Today composer QA failed: ${JSON.stringify(todayComposerQa)}`);
  }
  const [mainImage, widgetImage] = await Promise.all([
    mainWindow.capturePage(),
    widgetWindow.capturePage()
  ]);
  fs.writeFileSync(path.join(outputDirectory, "main-window.png"), mainImage.toPNG());
  fs.writeFileSync(path.join(outputDirectory, "desktop-widget.png"), widgetImage.toPNG());

  await mainWindow.webContents.executeJavaScript(`
    document.querySelector("#habitTitle").value = "午后伸展";
    document.querySelector("#habitInterval").value = "75";
    document.querySelector("#habitForm").requestSubmit();
  `);
  await new Promise((resolve) => setTimeout(resolve, 350));
  const addedHabitCount = await mainWindow.webContents.executeJavaScript('document.querySelectorAll(".habit-card").length');
  if (addedHabitCount !== 4) throw new Error(`Habit add QA failed: count=${addedHabitCount}`);
  await mainWindow.webContents.executeJavaScript('document.querySelector(".habit-card:last-child .habit-delete").click()');
  await new Promise((resolve) => setTimeout(resolve, 300));
  const restoredHabitCount = await mainWindow.webContents.executeJavaScript('document.querySelectorAll(".habit-card").length');
  if (restoredHabitCount !== 3) throw new Error(`Habit delete QA failed: count=${restoredHabitCount}`);

  mainWindow.hide();
  widgetWindow.show();
  await new Promise((resolve) => setTimeout(resolve, 450));
  const display = screen.getPrimaryDisplay();
  const screenSources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: { width: display.size.width, height: display.size.height }
  });
  const primarySource = screenSources[0];
  if (primarySource) fs.writeFileSync(path.join(outputDirectory, "widget-on-desktop.png"), primarySource.thumbnail.toPNG());
  mainWindow.show();
  mainWindow.focus();

  await mainWindow.webContents.executeJavaScript(
    'document.querySelector(".task-card:not(.is-done) .complete-button").click()'
  );
  await new Promise((resolve) => setTimeout(resolve, 170));
  const feedbackImage = await mainWindow.capturePage();
  fs.writeFileSync(path.join(outputDirectory, "completion-feedback.png"), feedbackImage.toPNG());
  await new Promise((resolve) => setTimeout(resolve, 650));
  const [completedCards, widgetRemaining] = await Promise.all([
    mainWindow.webContents.executeJavaScript('document.querySelectorAll(".task-card.is-done").length'),
    widgetWindow.webContents.executeJavaScript('document.querySelector("#remainingCount").textContent')
  ]);
  if (completedCards !== 2 || widgetRemaining !== "3") {
    throw new Error(`Interaction QA failed: completed=${completedCards}, widgetRemaining=${widgetRemaining}`);
  }
  await mainWindow.webContents.executeJavaScript(
    'document.querySelector("[data-view=stage]").click()'
  );
  await new Promise((resolve) => setTimeout(resolve, 250));
  const stageTaskQa = await mainWindow.webContents.executeJavaScript(`(() => ({
    visibleStageFields: !document.querySelector("#addTaskDialog").open,
    ongoingTags: document.querySelectorAll(".schedule-tag.ongoing").length,
    deadlineLabels: document.querySelectorAll(".deadline-meta").length
  }))()`);
  if (!stageTaskQa.visibleStageFields || stageTaskQa.ongoingTags < 1 || stageTaskQa.deadlineLabels < 1) {
    throw new Error(`Stage ongoing/deadline QA failed: ${JSON.stringify(stageTaskQa)}`);
  }
  const stageImage = await mainWindow.capturePage();
  fs.writeFileSync(path.join(outputDirectory, "stage-plan.png"), stageImage.toPNG());
  await mainWindow.webContents.executeJavaScript(
    'document.querySelector("#autoSchedule").click()'
  );
  await new Promise((resolve) => setTimeout(resolve, 500));
  const unscheduledCount = await mainWindow.webContents.executeJavaScript(
    'document.querySelectorAll(".task-card.is-unscheduled").length'
  );
  if (unscheduledCount !== 0) {
    throw new Error(`Planning QA failed: unscheduled=${unscheduledCount}`);
  }
  const scheduledImage = await mainWindow.capturePage();
  fs.writeFileSync(path.join(outputDirectory, "stage-scheduled.png"), scheduledImage.toPNG());
  await mainWindow.webContents.executeJavaScript('document.querySelector("#focusStart").click()');
  await new Promise((resolve) => setTimeout(resolve, 2200));
  const focusText = await mainWindow.webContents.executeJavaScript('document.querySelector("#focusTime").textContent');
  if (focusText === "25:00") throw new Error("Focus timer QA failed: countdown did not advance");
  const focusImage = await mainWindow.capturePage();
  fs.writeFileSync(path.join(outputDirectory, "focus-running.png"), focusImage.toPNG());
  await captureNewFeatures(outputDirectory);

  enqueueBigReminder({
    key: "capture-big-reminder",
    type: "habit",
    habitId: "starter-water",
    title: "喝水，起来走走",
    subtitle: "每隔 60 分钟",
    detail: "离开屏幕活动一下，回来时会更清醒。",
    screenId: "screen1",
    occurredAt: new Date().toISOString()
  });
  await new Promise((resolve) => setTimeout(resolve, 900));
  if (!reminderWindow?.isVisible()) throw new Error("Big reminder QA failed: window was not visible");
  const reminderImage = await reminderWindow.capturePage();
  fs.writeFileSync(path.join(outputDirectory, "big-reminder.png"), reminderImage.toPNG());
  await reminderWindow.webContents.executeJavaScript('document.querySelector("#dismissButton").click()');
  await new Promise((resolve) => setTimeout(resolve, 300));
  if (reminderWindow.isVisible() || activeReminder) throw new Error("Big reminder QA failed: dismiss action did not close it");

  enqueueBigReminder({
    key: "capture-deadline-reminder",
    type: "deadline",
    taskId: "preview-5",
    title: "运行多组对照实验",
    subtitle: "距离截止还有 3 天",
    detail: "这是阶段计划的最终截止日期。今天也推进一点，别把压力留到最后。",
    dueAt: `${state.tasks.find((task) => task.id === "preview-5").deadlineDate}T23:59:00`,
    screenId: "screen2",
    occurredAt: new Date().toISOString()
  });
  await new Promise((resolve) => setTimeout(resolve, 650));
  const deadlineReminderQa = await reminderWindow.webContents.executeJavaScript(`(() => ({
    kicker: document.querySelector("#reminderKicker").textContent,
    title: document.querySelector("#reminderTitle").textContent,
    completeVisible: !document.querySelector("#completeButton").hidden,
    dueVisible: !document.querySelector("#duePill").hidden
  }))()`);
  if (deadlineReminderQa.kicker !== "DEADLINE · 截止提醒"
    || deadlineReminderQa.title !== "运行多组对照实验"
    || !deadlineReminderQa.completeVisible
    || !deadlineReminderQa.dueVisible) {
    throw new Error(`Deadline reminder UI QA failed: ${JSON.stringify(deadlineReminderQa)}`);
  }
  const deadlineReminderImage = await reminderWindow.capturePage();
  fs.writeFileSync(path.join(outputDirectory, "deadline-reminder.png"), deadlineReminderImage.toPNG());
  await reminderWindow.webContents.executeJavaScript('document.querySelector("#dismissButton").click()');
  await new Promise((resolve) => setTimeout(resolve, 300));

  let previousPresenceScreen = null;
  for (const status of ["吃饭中", "上厕所", "有事暂离", "开会中"]) {
    setPresenceStatus(status);
    await new Promise((resolve) => setTimeout(resolve, 260));
    if (!state.presence.active
      || state.presence.status !== status
      || activeReminder?.type !== "presence"
      || activeReminder.title !== status
      || activeReminder.screenId === previousPresenceScreen) {
      throw new Error(`Presence status QA failed: ${JSON.stringify({ presence: state.presence, activeReminder, previousPresenceScreen })}`);
    }
    previousPresenceScreen = activeReminder.screenId;
  }
  const presenceUi = await reminderWindow.webContents.executeJavaScript(`(() => ({
    title: document.querySelector("#reminderTitle").textContent,
    screenId: document.querySelector("#reminderScreen").dataset.screenId,
    returnVisible: !document.querySelector("#returnButton").hidden,
    dismissHidden: document.querySelector("#dismissButton").hidden,
    snoozeHidden: document.querySelector("#snoozeButton").hidden,
    artworkFit: getComputedStyle(document.querySelector("#screenArtwork")).objectFit,
    backdropFilter: getComputedStyle(document.querySelector("#screenBackdrop")).filter
  }))()`);
  if (presenceUi.title !== "开会中"
    || presenceUi.screenId !== state.presence.screenId
    || !presenceUi.returnVisible
    || !presenceUi.dismissHidden
    || !presenceUi.snoozeHidden
    || presenceUi.artworkFit !== "contain"
    || !presenceUi.backdropFilter.includes("blur")) {
    throw new Error(`Presence screen UI QA failed: ${JSON.stringify(presenceUi)}`);
  }
  const presenceImage = await reminderWindow.capturePage();
  fs.writeFileSync(path.join(outputDirectory, "presence-screen.png"), presenceImage.toPNG());

  enqueueBigReminder({ key: "presence-queued-1", type: "habit", title: "第一条排队提醒", occurredAt: new Date().toISOString() });
  enqueueBigReminder({ key: "presence-queued-2", type: "event", title: "第二条排队提醒", occurredAt: new Date().toISOString() });
  if (state.pendingReminders.length !== 2 || activeReminder?.type !== "presence") {
    throw new Error(`Presence reminder queue QA failed before return: queue=${state.pendingReminders.length}`);
  }
  const queuedKeys = state.pendingReminders.map((item) => item.key);
  const queuedScreens = state.pendingReminders.map((item) => item.screenId);
  if (queuedScreens[0] === state.presence.screenId || queuedScreens[0] === queuedScreens[1]) {
    throw new Error(`Screensaver repeat QA failed: ${JSON.stringify({ presence: state.presence.screenId, queuedScreens })}`);
  }
  clearPresenceStatus();
  await new Promise((resolve) => setTimeout(resolve, 420));
  if (state.presence.active || activeReminder?.key !== queuedKeys[0]) {
    throw new Error(`Presence return QA failed: ${JSON.stringify({ presence: state.presence, activeReminder, queuedKeys })}`);
  }
  dismissReminder(activeReminder?.key, 'dismiss');
  await new Promise((resolve) => setTimeout(resolve, 320));
  if (activeReminder?.key !== queuedKeys[1]) throw new Error("Reminder queue order QA failed for second item");
  dismissReminder(activeReminder?.key, 'dismiss');
  await new Promise((resolve) => setTimeout(resolve, 300));
  if (activeReminder || state.pendingReminders.length) throw new Error("Reminder queue did not fully drain after presence mode");

  mutateState((draft) => {
    for (const task of draft.tasks) {
      task.completed = true;
      task.completedAt = new Date().toISOString();
    }
  });
  await new Promise((resolve) => setTimeout(resolve, 350));
  const emptyWidget = await widgetWindow.webContents.executeJavaScript(`(() => {
    const title = document.querySelector(".widget-empty strong");
    const footer = document.querySelector("footer p");
    const brand = document.querySelector(".mini-brand small");
    return {
      title: title?.textContent,
      titleSize: title ? parseFloat(getComputedStyle(title).fontSize) : 0,
      footerSize: parseFloat(getComputedStyle(footer).fontSize),
      brandSize: parseFloat(getComputedStyle(brand).fontSize)
    };
  })()`);
  if (emptyWidget.title !== "全部完成啦！"
    || emptyWidget.titleSize < 24
    || emptyWidget.footerSize < 12
    || emptyWidget.brandSize < 12) {
    throw new Error(`Widget readability QA failed: ${JSON.stringify(emptyWidget)}`);
  }
  const emptyWidgetImage = await widgetWindow.capturePage();
  fs.writeFileSync(path.join(outputDirectory, "widget-all-complete.png"), emptyWidgetImage.toPNG());

  const brandLines = await mainWindow.webContents.executeJavaScript(`(() => {
    const lines = [...document.querySelectorAll(".brand-tagline")];
    return lines.map((line) => ({ text: line.textContent.trim(), color: getComputedStyle(line).color, size: getComputedStyle(line).fontSize }));
  })()`);
  if (brandLines.length !== 2
    || brandLines[0].text !== "王王碎小熊"
    || brandLines[1].text !== "CAT & DOG DIARY"
    || brandLines[0].color !== brandLines[1].color
    || brandLines[0].size !== brandLines[1].size) {
    throw new Error(`Brand layout QA failed: ${JSON.stringify(brandLines)}`);
  }
  await require('./qa/productivity-qa.js')({ mainWindow, getFocusWindow: () => focusWindow,
    getState: () => state, mutateState, outputDirectory, hideFocusWindow });
  await require('./qa/controls-widget-qa.js')({mainWindow, widgetWindow, getFocusWindow:()=>focusWindow,
    getState:()=>publicState(), mutateState, outputDirectory, showMainWindow, hideFocusWindow,
    setPresenceStatus, clearPresenceStatus, showNextBigReminder, assertTransparentWidgetCorners});
  console.log(`Visual previews saved to ${outputDirectory}; transparency, readability, brand, habits, completion, planning, focus timer, big reminder, themed dropdowns, productivity and 0.5.3 controls/focus-widget QA passed.`);
  quitting = true;
  app.quit();
}

function registerTrustedIpc(channel,handler) {
  ipcMain.handle(channel,(event,...args)=>{
    assertTrustedSender(event,[
      {window:mainWindow,file:path.join(__dirname,'renderer','index.html')},
      {window:widgetWindow,file:path.join(__dirname,'renderer','widget.html')},
      {window:focusWindow,file:path.join(__dirname,'renderer','focus.html')},
      {window:reminderWindow,file:path.join(__dirname,'renderer','reminder.html')}
    ]);
    return handler(event,...args);
  });
}
function registerIpc() {
  // Every handler in this registration block passes through the same gate.
  const ipcMain={handle:registerTrustedIpc};
  ipcMain.handle("state:get", () => publicState());
  ipcMain.handle('sync:status', () => syncService?.status() || { configured: false, signedIn: false, pending: 0, conflicts: 0 });
  ipcMain.handle('sync:configure', (_event, config) => syncService.configure(config));
  ipcMain.handle('sync:send-otp', (_event, email) => syncService.sendOtp(email));
  ipcMain.handle('sync:verify-otp', async (_event, { email, token }) => {
    const oldAccountId = syncService.meta.currentAccountId || syncService.meta.lastAccountId || null;
    if (syncService.meta.session && oldAccountId) syncService.saveLocalSnapshot(state);
    const result = await syncService.verifyOtp(email, token);
    const switchedAccount = Boolean(oldAccountId && oldAccountId !== result.accountId);
    if (switchedAccount) {
      // Never display account A's tasks while account B is being selected.
      // Restore B's local snapshot if one exists; otherwise show a clean local
      // state and let the first pull populate it.
      state = normalizeState(syncService.localSnapshot() || createDefaultState());
      if (!captureMode) saveState(state);
      broadcastState();
    }
    const account = syncService.account();
    if (account && !account.migrated) {
      const empty = { tasks: [], habits: [], stagePlan: {}, focusHistory: [], preferences: {} };
      if (!switchedAccount) syncService.capture(empty, state);
      account.migrated = true;
      syncService.save();
    }
    return publicState();
  });
  ipcMain.handle('sync:now', () => runCloudSync());
  ipcMain.handle('sync:conflicts', () => syncService?.listConflicts() || []);
  ipcMain.handle('sync:resolve-conflict', (_event, { conflictId, resolution }) => syncService?.resolveConflict(conflictId, resolution));
  ipcMain.handle('sync:logout', () => syncService.logout());
  ipcMain.handle('sync:delete-account', () => syncService.deleteAccount());
  ipcMain.handle("task:add", (_event, input) => mutateState((draft) => {
    const title = String(input.title || "").trim().slice(0, 120);
    if (!title) throw new Error("任务标题不能为空");
    if (Array.isArray(input.steps) && input.steps.length > 100) throw new Error('最多添加 100 个小步骤，请拆分任务');
    const requestedScheduleMode = ["backlog", "ongoing"].includes(input.scheduleMode)
      ? input.scheduleMode
      : null;
    const dueAt = requestedScheduleMode === "ongoing" ? null : input.dueAt || null;
    if (dueAt && Number.isNaN(new Date(dueAt).getTime())) throw new Error('请填写有效的日期和时间');
    if (input.reminderMode === 'event' && !dueAt) throw new Error('提前提醒需要指定日期和时间');
    const deadlineDaysValue = Number(input.deadlineReminderDays);
    const task = {
      ...diary.taskFields(input),
      id: crypto.randomUUID(),
      title,
      steps: productivity.normalizeSteps(input.steps).map((step) => ({ ...step, id: crypto.randomUUID() })),
      notes: String(input.notes || "").trim(),
      dueAt,
      deadlineDate: domain.normalizeLocalDate(input.deadlineDate),
      deadlineReminderDays: Number.isFinite(deadlineDaysValue)
        ? Math.min(365, Math.max(0, Math.round(deadlineDaysValue)))
        : 3,
      deadlineLastRemindedDate: null,
      priority: ["high", "normal", "low"].includes(input.priority) ? input.priority : "normal",
      inStage: input.inStage !== false,
      scheduleMode: dueAt ? "fixed" : requestedScheduleMode === "ongoing" ? "ongoing" : "backlog",
      reminderMode: validReminderMode(input.reminderMode),
      reminderMinutes: Number(input.reminderMinutes),
      reminderActive: input.reminderMode !== "none",
      nextReminderAt: null,
      reminderFiredForDueAt: null,
      completed: false,
      createdAt: new Date().toISOString(),
      completedAt: null
    };
    if(task.planDate && !dueAt && task.scheduleMode!=='ongoing')task.scheduleMode='day';
    if(task.recurrence.kind!=='none' && !task.planDate && !task.dueAt)throw Error('重复任务需要起始日期；不定时间也可以');
    draft.tasks.push(prepareTaskReminder(task, true));
  }));
  ipcMain.handle("task:update", (_event, { id, patch }) => mutateState((draft) => {
    const task = draft.tasks.find((item) => item.id === id);
    if (!task) throw new Error("找不到任务");
    const allowed = ["title", "notes", "dueAt", "deadlineDate", "deadlineReminderDays", "priority", "scheduleMode", "reminderMode", "reminderMinutes", "reminderActive", "planDate", "priorityDate", "category", "estimateMinutes", "recurrence", "reminderPresentation", "urgentReminder"];
    const changed = (key) => Object.hasOwn(patch, key) && patch[key] !== task[key];
    const deadlineChanged = ['deadlineDate', 'deadlineReminderDays'].some(changed);
    const resetReminder = ['dueAt', 'scheduleMode', 'reminderMode', 'reminderMinutes', 'reminderActive'].some(changed);
    for (const key of allowed) if (Object.hasOwn(patch, key)) task[key] = patch[key];
    task.title=String(task.title || '').trim().slice(0,120);
    task.notes=String(task.notes || '').trim();
    task.priority=['high','normal','low'].includes(task.priority)?task.priority:'normal';
    Object.assign(task,diary.taskFields(task));
    task.deadlineDate = domain.normalizeLocalDate(task.deadlineDate);
    const deadlineDaysValue = Number(task.deadlineReminderDays);
    task.deadlineReminderDays = Number.isFinite(deadlineDaysValue)
      ? Math.min(365, Math.max(0, Math.round(deadlineDaysValue)))
      : 3;
    if (deadlineChanged) task.deadlineLastRemindedDate = null;
    if (task.scheduleMode === "ongoing" || task.scheduleMode === "backlog") {
      task.dueAt = null;
      task.planDate = null;
    } else if(task.planDate && !task.dueAt) {
      task.scheduleMode=task.scheduleMode==='auto'?'auto':'day';
    } else if (!task.dueAt || Number.isNaN(new Date(task.dueAt).getTime())) {
      task.dueAt = null;
      task.scheduleMode = "backlog";
    } else {
      task.dueAt = new Date(task.dueAt).toISOString();
      task.scheduleMode = task.scheduleMode === "auto" ? "auto" : "fixed";
    }
    if (!String(task.title || '').trim()) throw new Error('任务标题不能为空');
    if (task.reminderMode === 'event' && !task.dueAt) throw new Error('提前提醒需要指定日期和时间');
    if(task.recurrence.kind!=='none'&&!task.planDate&&!task.dueAt)throw Error('重复任务需要起始日期');
    runtime.removeMatching(draft, (item) => item.taskId === id && (item.type === 'deadline' ? deadlineChanged : resetReminder));
    prepareTaskReminder(task, resetReminder);
  }));
  ipcMain.handle("task:toggle", (_event, id,expectedCompleted) => mutateState((draft) => {
    const task = draft.tasks.find((item) => item.id === id);
    if (!task) throw new Error("找不到任务");
    if(typeof expectedCompleted==='boolean'&&task.completed!==expectedCompleted)return;
    task.completed = !task.completed;
    if (task.completed) {
      task.steps = (task.steps || []).map((step) => ({ ...step, completed: true }));
      if (draft.focusTimer.taskId === id && draft.focusTimer.status !== 'idle') {
        productivity.recordSession(draft, 'interrupted');
        runtime.updateFocus(draft.focusTimer, { action: 'stop' });
      }
    }
    task.completedAt = task.completed ? new Date().toISOString() : null;
    prepareTaskReminder(task, true);
  }));
  ipcMain.handle("task:delete", (_event, id) => mutateState((draft) => {
    const task=draft.tasks.find(item=>item.id===id);
    if(task)(draft.trash ||= []).push({task:structuredClone(task),deletedAt:new Date().toISOString()});
    if (draft.focusTimer.taskId === id && draft.focusTimer.status !== 'idle') {
      productivity.recordSession(draft, 'interrupted');
      runtime.updateFocus(draft.focusTimer, { action: 'stop' });
    }
    draft.tasks = draft.tasks.filter((task) => task.id !== id);
  }));
  ipcMain.handle('task:step', (_event, command) => mutateState((draft) => {
    const task = draft.tasks.find((item) => item.id === command?.taskId);
    if (!task || task.completed) throw new Error('请先恢复任务，再修改小步骤');
    task.steps ||= [];
    const step = task.steps.find((item) => item.id === command.stepId);
    if (command.action === 'add') {
      const title = String(command.title || '').trim();
      if (!title || title.length > 120) throw new Error('小步骤需要 1–120 个字');
      if (task.steps.length >= 100) throw new Error('每个任务最多 100 个小步骤');
      task.steps.push({ id: crypto.randomUUID(), title, completed: false });
    } else if (command.action === 'set-completed' && step && typeof command.completed === 'boolean') {
      step.completed = command.completed;
    } else if (command.action === 'rename' && step) {
      const title = String(command.title || '').trim();
      if (!title || title.length > 120) throw new Error('小步骤需要 1–120 个字');
      step.title = title;
    } else if (command.action === 'delete' && step) {
      task.steps = task.steps.filter((item) => item.id !== step.id);
    } else throw new Error('无效的小步骤操作');
  }));
  ipcMain.handle("habit:add", (_event, input) => mutateState((draft) => {
    const title = String(input.title || "").trim();
    if (!title) throw new Error("习惯名称不能为空");
    draft.habits.push(prepareHabitReminder({
      ...diary.habitFields(input),
      id: crypto.randomUUID(),
      title,
      icon: habitIcon(title),
      scheduleType: input.scheduleType,
      intervalMinutes: Number(input.intervalMinutes),
      time: input.time,
      active: true,
      nextReminderAt: null,
      lastCompletedAt: null,
      completionCount: 0,
      createdAt: new Date().toISOString()
    }, true));
  }));
  ipcMain.handle("habit:update", (_event, { id, patch }) => mutateState((draft) => {
    const habit = draft.habits.find((item) => item.id === id);
    if (!habit) throw new Error("找不到这项每日坚持");
    const allowed = ["title", "scheduleType", "intervalMinutes", "time", "active", "days", "windowEnabled", "windowStart", "windowEnd", "reminderPresentation", "urgentReminder"];
    const reset = ['scheduleType', 'intervalMinutes', 'time', 'active','days','windowEnabled','windowStart','windowEnd'].some((key) => Object.hasOwn(patch, key) && JSON.stringify(patch[key]) !== JSON.stringify(habit[key]));
    for (const key of allowed) if (Object.hasOwn(patch, key)) habit[key] = patch[key];
    if (reset) runtime.removeMatching(draft, (item) => item.habitId === id);
    prepareHabitReminder(habit, reset);
  }));
  ipcMain.handle("habit:complete", (_event, id) => mutateState((draft) => {
    const habit = draft.habits.find((item) => item.id === id);
    if (!habit) throw new Error("找不到这项每日坚持");
    const pending = draft.pendingReminders.find((item) => item.habitId === id);
    if (pending) { runtime.acknowledge(draft, pending.key, 'complete'); return; }
    habit.lastCompletedAt = new Date().toISOString();
    habit.completionCount = (Number(habit.completionCount) || 0) + 1;
  }));
  ipcMain.handle("habit:delete", (_event, id) => mutateState((draft) => {
    draft.habits = draft.habits.filter((habit) => habit.id !== id);
  }));
  ipcMain.handle("preferences:update", (_event, patch) => {
    const result = mutateState((draft) => {
      const next = { ...draft.preferences };
      for(const key of Object.keys(diary.preferences()))if(Object.hasOwn(patch,key))next[key]=patch[key];
      if (Object.hasOwn(patch, "notifications")) next.notifications = Boolean(patch.notifications);
      if (Object.hasOwn(patch, "widgetVisible")) next.widgetVisible = Boolean(patch.widgetVisible);
      if (Object.hasOwn(patch, "soundEnabled")) next.soundEnabled = Boolean(patch.soundEnabled);
      if (Object.hasOwn(patch, "reminderIntervalMinutes")) {
        const minutes = Number(patch.reminderIntervalMinutes);
        if (![15, 30, 60, 120].includes(minutes)) throw new Error("无效的提醒频率");
        next.reminderIntervalMinutes = minutes;
      }
      if (Object.hasOwn(patch, "themeId")) {
        if (!domain.THEME_IDS.includes(patch.themeId)) throw new Error("无效的主题编号");
        next.themeId = patch.themeId;
      }
      draft.preferences = normalizePreferences(next);
    });
    if (Object.hasOwn(patch, 'reminderIntervalMinutes')) resetReminderSchedule();
    if (Object.hasOwn(patch,'quickShortcutEnabled'))registerQuickShortcut();
    if(activeReminder && diary.deferredReason(state,activeReminder)){activeReminder=null;reminderWindow?.hide();}
    showNextBigReminder();
    return result;
  });
  ipcMain.handle("plan:auto-schedule", (_event, plan) => {
    const schedule = domain.buildSchedule(state.tasks, plan, new Date());
    const updates = new Map(schedule.updates.map((update) => [update.id, update]));
    const overflow = new Set(schedule.overflow);
    const nextState = mutateState((draft) => {
      draft.stagePlan = {
        start: plan.start,
        end: plan.end,
        dailyCapacity: schedule.capacity,
        lastPlannedAt: new Date().toISOString()
      };
      for (const task of draft.tasks) {
        const update = updates.get(task.id);
        if (update) {
          runtime.removeMatching(draft, (item) => item.taskId === task.id && item.type !== 'deadline');
          task.dueAt = update.dueAt;
          task.scheduleMode = update.scheduleMode;
          prepareTaskReminder(task, true);
        } else if (overflow.has(task.id)) {
          runtime.removeMatching(draft, (item) => item.taskId === task.id && item.type !== 'deadline');
          task.dueAt = null;
          task.scheduleMode = "backlog";
          prepareTaskReminder(task, true);
        }
      }
    });
    return {
      state: nextState,
      scheduledCount: schedule.updates.length,
      overflowCount: schedule.overflow.length
    };
  });
  ipcMain.handle("reminder:toggle-task", (_event, id) => mutateState((draft) => {
    const task = draft.tasks.find((item) => item.id === id);
    if (!task || task.reminderMode !== "interval") throw new Error("这不是循环提醒任务");
    task.reminderActive = !task.reminderActive;
    prepareTaskReminder(task, true);
  }));
  ipcMain.handle("reminder:get-active", () => structuredClone(activeReminder));
  ipcMain.handle('reminder:ready',revealReadyReminder);
  ipcMain.handle('reminder:test',(_event,style)=>{enqueueBigReminder({key:'test:'+crypto.randomUUID(),type:'test',title:'提醒已经准备好啦',subtitle:'这是测试，不会创建任务',detail:'如果能看见这条提醒，就可以在提醒中心调整提醒方式。',presentation:style==='light'?'light':'fullscreen',occurredAt:new Date().toISOString()});return publicState();});
  ipcMain.handle('reminder:center-action',(_event,{key,action,minutes})=>{
    if(!['dismiss','snooze','complete','show'].includes(action))throw Error('无效的提醒操作');
    const item=state.pendingReminders.find(item=>item.key===key);if(!item)return publicState();
    if(action==='show') {
      if(state.presence.active)throw Error('请先退出离席状态');
      if(activeReminder && activeReminder.key!==key)throw Error('请先处理当前提醒');
      activeReminder=item;revealActiveReminder();return publicState();
    }
    return mutateState(draft=>runtime.acknowledge(draft,key,action,minutes));
  });
  ipcMain.handle('plan:preview',(_event,plan)=>{
    const result=diary.plan(state.tasks,plan); const token=crypto.randomUUID();
    schedulePreview={token,plan:result,snapshot:JSON.stringify(state.tasks),expires:Date.now()+300000};return {...result,token};
  });
  ipcMain.handle('plan:apply',(_event,token)=>{
    const preview=schedulePreview;
    if(!preview||preview.token!==token||preview.expires<Date.now()||preview.snapshot!==JSON.stringify(state.tasks))throw Error('任务已变化或预览已过期，请重新预览排期');
    const result=mutateState(draft=>{
      for(const update of preview.plan.updates){const task=draft.tasks.find(t=>t.id===update.id);Object.assign(task,update);runtime.removeMatching(draft,r=>r.taskId===task.id&&r.type!=='deadline');prepareTaskReminder(task,true);}
      draft.stagePlan={...draft.stagePlan,...preview.plan,lastPlannedAt:new Date().toISOString()};delete draft.stagePlan.updates;delete draft.stagePlan.conflicts;delete draft.stagePlan.loads;
    });schedulePreview=null;return result;
  });
  ipcMain.handle('trash:restore',(_event,id)=>mutateState(draft=>{
    const entry=draft.trash.find(item=>item.task.id===id);if(!entry)throw Error('任务已恢复或不存在');
    if(draft.tasks.some(task=>task.id===id))throw Error('同一任务已存在');
    draft.tasks.push(prepareTaskReminder(normalizeTask(entry.task),true));draft.trash=draft.trash.filter(item=>item!==entry);
  }));
  ipcMain.handle('data:status',()=>({backups:store?.list() || [],readOnly:Boolean(store?.readOnly),message:store?.issue || '',path:dataPath()}));
  ipcMain.handle('data:backup',()=>{if(store?.readOnly)throw Error(store.issue);saveState();return store.backup();});
  ipcMain.handle('data:export',async()=>{
    if(store?.readOnly)throw Error('当前数据读取失败，不能把空视图当作备份导出；请先恢复已有备份');
    const choice=await dialog.showSaveDialog(mainWindow,{title:'导出猫狗日记数据',defaultPath:'猫狗日记备份-'+domain.toLocalDateInput()+'.json',filters:[{name:'猫狗日记数据',extensions:['json']}]});
    if(choice.canceled)return false;
    if(path.resolve(choice.filePath)===path.resolve(dataPath()))throw Error('请选择数据目录以外的位置');
    fs.writeFileSync(choice.filePath,JSON.stringify(state,null,2),'utf8');return true;
  });
  ipcMain.handle('data:import-preview',async()=>{
    assertCanRestore();const choice=await dialog.showOpenDialog(mainWindow,{title:'选择猫狗日记备份',properties:['openFile'],filters:[{name:'猫狗日记数据',extensions:['json']}]});
    if(choice.canceled)return null;store ||= new StateStore(dataPath(),legacyDataPath(),fs);return inspectRestore(store.parse(choice.filePaths[0]));
  });
  ipcMain.handle('data:restore-preview',(_event,name)=>{assertCanRestore();return inspectRestore(store.fromBackup(name));});
  ipcMain.handle('data:restore-apply',(_event,token)=>{
    assertCanRestore();if(!restorePreview||restorePreview.token!==token||restorePreview.expires<Date.now())throw Error('恢复预览已过期，请重新选择');
    state=normalizeState(store.replace(restorePreview.state));restorePreview=null;activeReminder=null;reminderWindow?.hide();
    dayChecked=null;registerQuickShortcut();resetReminderSchedule();broadcastState();windows().sync();return publicState();
  });
  ipcMain.handle("reminder:action", (_event, { key, action, minutes }) => dismissReminder(key, action, minutes));
  ipcMain.handle("presence:set", (_event, status) => setPresenceStatus(status));
  ipcMain.handle("presence:clear", () => clearPresenceStatus());
  ipcMain.handle("focus:show", () => showFocusWindow());
  ipcMain.handle("focus:hide", (_event, target) => hideFocusWindow(target || 'widget'));
  ipcMain.handle('window:set-widget',(_event,enabled)=>{windows().setWidget(enabled);return publicState();});
  ipcMain.handle('ui:context',event=>windows().context(event.sender));
  ipcMain.handle('ui:ready',(event,signal)=>windows().ready(event.sender,signal));
  ipcMain.handle('ui:failed',(event,signal)=>windows().reportFailure(event.sender,signal));
  ipcMain.handle('window:retry',(_event,role)=>{
    if(!['focus','widget'].includes(role))throw Error('无效的窗口');
    if(role==='focus')windows().requestFull();else windows().setWidget(true);
    return publicState();
  });
  ipcMain.handle('window:hide-widget', () => hideWidgetWindow());
  ipcMain.handle("startup:get", () => startupSettings());
  ipcMain.handle("startup:set", (_event, enabled) => setStartup(enabled));
  ipcMain.handle("focus:update", (_event, command) => {
    // Keep validation synchronous for callers that use IPC as a command API.
    // The lease check below may still return a promise, but malformed commands
    // must throw before any state mutation (and before a rejected Promise can
    // escape an IPC test or renderer click handler).
    if (command?.presentation !== undefined && !['fullscreen','keep'].includes(command.presentation)) throw new Error('无效的专注显示方式');
    const currentTimer = state?.focusTimer;
    if (command?.taskId && currentTimer?.status !== 'idle' && currentTimer.taskId !== command.taskId) throw new Error('请先结束当前专注，再切换任务');
    let appliedCommand=false;
    const result = mutateState((draft) => {
      const now = Date.now();
      const timer = draft.focusTimer;
      if (command?.sessionId !== undefined && command.sessionId !== timer.sessionId) return;
      const oldStatus = timer.status;
      const targetTask = command?.taskId ? draft.tasks.find((item) => item.id === command.taskId && !item.completed) : null;
      if (command?.taskId && !targetTask) throw new Error('任务不存在或已经完成');
      if (command?.taskId && oldStatus !== 'idle' && timer.taskId !== command.taskId) throw new Error('请先结束当前专注，再切换任务');
      if (command?.taskId && oldStatus === 'idle') runtime.updateFocus(timer, { action: 'select', mode: 'focus', durationMinutes: timer.mode === 'focus' ? timer.durationMinutes : 25 });
      if (['reset', 'stop'].includes(command?.action) && oldStatus !== 'idle') productivity.recordSession(draft, 'interrupted', now);
      if (command?.action === 'pause' && oldStatus === 'running') productivity.closeSegment(timer, now);
      const oldSession = draft.focusTimer.sessionId;
      const applied = runtime.updateFocus(draft.focusTimer, command, now);
      if (!applied) return;
      appliedCommand=true;
      if (command.action === "start") {
        if (oldStatus !== 'running') productivity.beginTracking(timer, targetTask, now, oldStatus === 'idle');
        if (!draft.focusTimer.screenId || oldSession !== draft.focusTimer.sessionId) {
          draft.focusTimer.screenId = nextScreenId();
        }
      } else if (["reset", "stop"].includes(command.action)) {
        // Reconcile presentation after committing timer state.
      }
    });
    if (runtime.blocksGentleReminders(state) && ['interval', 'habit'].includes(activeReminder?.type)) {
      activeReminder = null;
      reminderWindow?.hide();
    }
    if(appliedCommand&&command.action==='start'&&command.presentation!=='keep')windows().requestFull();
    if (appliedCommand && command.action === 'start' && syncService?.status().signedIn) {
      return syncService.acquireFocusLease(state.focusTimer.sessionId).then((leaseOk) => {
        if (!leaseOk) {
          mutateState((draft) => runtime.updateFocus(draft.focusTimer, { action: 'stop', sessionId: draft.focusTimer.sessionId }));
          throw Error('此账号正在另一台设备专注，请先结束另一台设备的专注');
        }
        showNextBigReminder();
        return publicState();
      });
    }
    if (appliedCommand && ['stop', 'reset'].includes(command.action) && syncService?.status().signedIn) syncService.releaseFocusLease(command.sessionId || null).catch(() => undefined);
    showNextBigReminder();
    return publicState();
  });
  ipcMain.handle("window:show-main", () => showMainWindow());
  ipcMain.handle("window:toggle-widget", () => toggleWidget());
  ipcMain.handle("window:minimize", () => mainWindow?.minimize());
  ipcMain.handle("window:close", () => mainWindow?.hide());
}

app.whenReady().then(() => {
  syncService = new SyncService(path.join(app.getPath('userData'), 'sync-state.json'));
  state = isolatedMode ? releaseSmokeMode&&process.argv.includes('--qa-clean') ? createDefaultState() : normalizeState(createCaptureState()) : loadState();
  if(stabilityQaMode||v1QaMode||releaseSmokeMode){state.habits.forEach(item=>item.active=false);state.tasks.forEach(item=>{item.reminderActive=false;item.deadlineDate=null;});}
  state.focusTimer = runtime.normalizeFocus(state.focusTimer);
  if (state.focusTimer.status === 'running' && !state.focusTimer.startedAt && domain.getFocusRemainingSeconds(state.focusTimer) > 0) productivity.beginTracking(state.focusTimer, null);
  if (state.focusTimer.status !== 'idle' && !state.focusTimer.screenId) state.focusTimer.screenId = nextScreenId();
  lastScreenId = state.presence?.screenId || null;
  registerIpc();
  writeWindowLog({event:'app-start',version:app.getVersion?.() || '1.0.0',packaged:app.isPackaged,isolated:isolatedMode});
  createMainWindow();
  createWidgetWindow();
  createTray();
  registerQuickShortcut();
  powerMonitor?.on('resume',()=>{dayChecked=null;precisionTick();if(syncService?.status().signedIn)runCloudSync().catch(()=>undefined);});
  resetReminderSchedule();
  startPrecisionSchedule();
  if (!isolatedMode) cloudSyncTimer = setInterval(() => {
    if (syncService?.status().signedIn && (syncService.status().pending || 0) > 0) runCloudSync().catch(() => undefined);
  }, 60_000);
  if (!isolatedMode && syncService.status().signedIn) {
    setTimeout(() => runCloudSync().catch(error => writeWindowLog({ event: 'sync-error', message: String(error.message || error) })), 2_000);
  }
  if(releaseSmokeMode){
    require('./qa/release-smoke.js')({main:()=>mainWindow,widget:()=>widgetWindow,state:()=>publicState(),
      autoStart:autoStartMode,clean:process.argv.includes('--qa-clean'),version:app.getVersion(),finish:code=>{quitting=true;app.exit(code);}}).catch(error=>{console.error(error);quitting=true;app.exit(1);});
  } else if(v1QaMode) {
    require('./qa/v1-qa.js')({main:()=>mainWindow,widget:()=>widgetWindow,focus:()=>focusWindow,reminder:()=>reminderWindow,
      state:()=>publicState(),mutate:mutateState,enqueue:enqueueBigReminder,finish:code=>{quitting=true;app.exit(code);}}).catch(error=>{console.error(error);quitting=true;app.exit(1);});
  } else if(stabilityQaMode) {
    require('./qa/windows-stress.js')({main:()=>mainWindow,widget:()=>windows().records.widget?.win,focus:()=>windows().records.focus?.win,
      coordinator:windows(),getState:()=>publicState(),mutateState,showMainWindow,
      setPresenceStatus,clearPresenceStatus,enqueueBigReminder,
      finish:()=>{quitting=true;app.quit();}}).catch(error=>{console.error(error);quitting=true;app.exit(1);});
  } else if (captureMode) {
    const captureTask = themeConceptMode ? captureTheme456Previews() : capturePreviews();
    captureTask.catch((error) => {
      console.error(error);
      quitting = true;
      app.exit(1);
    });
  }
  else if (reminderPreviewMode) {
    setTimeout(() => enqueueBigReminder({
      key: `manual-preview:${Date.now()}`,
      type: "habit",
      habitId: "preview-only",
      title: "喝水，起来走走",
      subtitle: "王王碎小熊来提醒你啦",
      detail: "离开屏幕活动一下，看看远处。回来以后，再专心做下一件事。",
      occurredAt: new Date().toISOString()
    }), 1_100);
  } else if (state.presence?.active) {
    setTimeout(showPresenceScreen, 900);
  } else setTimeout(sendReminder, 12_000);

  if (!isolatedMode && !reminderPreviewMode) {
    setTimeout(() => queueStartupDeadlineReminders(), 1_400);
  }

  app.on("activate", showMainWindow);
});

app.on("before-quit", () => { quitting = true;if (cloudSyncTimer) clearInterval(cloudSyncTimer);globalShortcut?.unregisterAll();windowCoordinator?.dispose(); });
app.on("window-all-closed", (event) => event.preventDefault());
