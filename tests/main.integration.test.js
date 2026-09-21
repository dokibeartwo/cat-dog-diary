// Exercise the actual main-process IPC and startup code with in-memory Electron
// and filesystem adapters. No desktop, registry, or personal data is touched.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8');
const domain = require('../src/shared/domain');
const runtime = require('../src/shared/runtime');

function harness({ argv = [], packaged = true, login = {}, saved } = {}) {
  const handlers = new Map();
  const windows = [];
  const writes = [];
  const loginWrites = [];
  let ready;
  const events = {};
  class Window {
    constructor(options) {
      this.options = options; this.visible = false; this.onceEvents = {};this.events={};this.destroyed=false;
      const listeners={};
      this.webContents = { send:(name,payload)=>{if(name==='ui:prepare')handlers.get('ui:ready')?.({sender:this.webContents,senderFrame:this.webContents.mainFrame},{generation:payload.generation,requestId:payload.requestId});},
        isLoading: () => false, once() {},on:(event,fn)=>{listeners[event]=fn;},emit:(name,...args)=>listeners[name]?.(...args) };
      this.onceEvents['ready-to-show']=()=>this.webContents.emit('did-finish-load');
      windows.push(this);
    }
    once(event, fn) { this.onceEvents[event] = fn; }
    on(event,fn) {this.events[event]=fn;}
    loadFile(file) {this.webContents.mainFrame={url:require('node:url').pathToFileURL(file).href};}
    show() { this.visible = true;this.events.show?.(); }
    showInactive() { this.show(); }
    hide() { const was=this.visible;this.visible = false;if(was)this.events.hide?.(); }
    focus() {}
    isVisible() { return this.visible; }
    isDestroyed() { return this.destroyed; }
    destroy() {this.destroyed=true;this.visible=false;this.events.closed?.();}
    setFullScreen(value){this.fullscreen=value;}
    setBounds(value){this.bounds={...value};}
    restore(){}
    isMinimized() { return false; }
    setAlwaysOnTop() {}
    setMenu() {}
    setMenuBarVisibility() {}
    setBackgroundColor() {}
  }
  const electron = {
    app: {
      isPackaged: packaged, setName() {}, disableHardwareAcceleration() {}, requestSingleInstanceLock: () => true,
      quit() {}, on: (name, fn) => { events[name] = fn; }, setPath() {}, setAppUserModelId() {},
      whenReady: () => ({ then: (fn) => { ready = fn; } }),
      getPath: () => 'X:/isolated',
      getLoginItemSettings: () => login,
      setLoginItemSettings: (settings) => { loginWrites.push(settings); }
    },
    BrowserWindow: Window,
    ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
    screen: { getPrimaryDisplay: () => ({ bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 } }) },
    Tray: class { on() {} setToolTip() {} setContextMenu() {} },
    Menu: { buildFromTemplate: (items) => items },
    nativeImage: { createFromPath: () => ({ resize: () => ({}) }) },
    Notification: class { static isSupported() { return false; } }
  };
  const fakeFS = {
    existsSync: (file) => Boolean(saved) && String(file).endsWith('done-data.json'),
    statSync: () => ({size:100}), readdirSync:()=>[],copyFileSync(){},openSync:()=>1,fsyncSync(){},closeSync(){},
    readFileSync: () => { if (saved) return JSON.stringify(saved); throw Error('missing'); },
    mkdirSync() {}, writeFileSync: (_target, data) => writes.push(JSON.parse(data)), renameSync() {}
  };
  const context = vm.createContext({
    require: (name) => name === 'electron' ? electron : name === 'node:fs' ? fakeFS
      : name === './shared/domain.js' ? domain : name === './shared/runtime.js' ? runtime
        : name === './shared/productivity.js' ? require('../src/shared/productivity')
          : name === './shared/diary-v1.js' ? require('../src/shared/diary-v1')
          : name === './state-store.js' ? require('../src/state-store')
          : name === './security.js' ? require('../src/security')
          : name === './window-coordinator.js' ? require('../src/window-coordinator')
          : name === './sync-service.js' ? require('../src/sync-service') : require(name),
    process: { argv, platform: 'win32', execPath: 'X:/猫狗日记/猫狗日记.exe', cwd: () => 'X:/source' },
    __dirname: 'X:/source', console, structuredClone, setTimeout() {}, clearTimeout() {}, setInterval() {}, clearInterval() {},
  });
  vm.runInContext(source + `\n globalThis.api = {
    init() { state = loadState(); registerIpc(); createMainWindow(); },
    sender:()=>mainWindow.webContents,
    get: () => publicState(), active: () => activeReminder,
    enqueue: enqueueBigReminder, next: showNextBigReminder,
    presence: setPresenceStatus, clearPresence: clearPresenceStatus,
    tick: precisionTick, load: loadState, startup: startupSettings
  };`, context);
  context.api.init();
  return { api: context.api, ipc: (name, ...args) => handlers.get(name)({sender:context.api.sender(),senderFrame:context.api.sender().mainFrame}, ...args), windows, writes, loginWrites, ready: () => {windows.length=0;return ready();}, events };
}
function interval(h) {
  const state = h.ipc('task:add', { title: '阶段实验', reminderMode: 'interval', reminderMinutes: 30, scheduleMode: 'ongoing' });
  const task = state.tasks.at(-1);
  h.api.enqueue({ key: 'interval-1', type: 'interval', taskId: task.id, title: task.title });
  h.api.next();
  return task;
}

test('v1 date-only task and recurrence survive reload; completion generates exactly one next occurrence',()=>{
  const h=harness();
  const task=h.ipc('task:add',{title:'阅读',planDate:'2026-09-17',scheduleMode:'day',recurrence:{kind:'daily'},category:'学习',estimateMinutes:50,reminderMode:'none'}).tasks.at(-1);
  assert.equal(task.dueAt,null);assert.equal(task.planDate,'2026-09-17');assert.equal(task.scheduleMode,'day');
  h.ipc('task:toggle',task.id,false);h.ipc('task:toggle',task.id,false);
  assert.equal(h.api.get().tasks.length,2);
  const restarted=harness({saved:h.writes.at(-1)});
  assert.equal(restarted.api.get().tasks[1].category,'学习');assert.equal(restarted.api.get().tasks[1].estimateMinutes,50);
});
test('v1 deletion is recoverable without deleting focus history',()=>{
  const h=harness();const task=h.ipc('task:add',{title:'可恢复任务',reminderMode:'none'}).tasks.at(-1);
  h.ipc('task:delete',task.id);assert.equal(h.api.get().tasks.length,0);assert.equal(h.api.get().trash.length,1);
  h.ipc('trash:restore',task.id);assert.equal(h.api.get().tasks[0].id,task.id);assert.equal(h.api.get().trash.length,0);
});
test('v1 schedule preview requires unchanged tasks and preserves conflicting task date',()=>{
  const h=harness();const task=h.ipc('task:add',{title:'待安排',scheduleMode:'backlog',reminderMode:'none'}).tasks.at(-1);
  const today=domain.toLocalDateInput();const end=new Date();end.setDate(end.getDate()+14);
  const request={start:today,end:domain.toLocalDateInput(end),dailyMinutes:120,dailyCapacity:3};
  const preview=h.ipc('plan:preview',request);assert.equal(h.api.get().tasks[0].dueAt,null);assert.equal(h.api.get().tasks[0].planDate,null);
  h.ipc('task:update',{id:task.id,patch:{title:'已修改'}});assert.throws(()=>h.ipc('plan:apply',preview.token));
  const fresh=h.ipc('plan:preview',request);h.ipc('plan:apply',fresh.token);
  assert.equal(h.api.get().tasks[0].planDate,today);assert.equal(h.api.get().tasks[0].dueAt,null);
});
test('v1 master switch defers task alerts but legacy summary switch does not',()=>{
  const h=harness();h.ipc('preferences:update',{remindersEnabled:false,notifications:false});interval(h);assert.equal(h.api.active(),null);
  h.ipc('preferences:update',{remindersEnabled:true});h.api.next();assert.equal(h.api.active().type,'interval');
});
test('main IPC rejects invalid input without partially changing the saved task', () => {
  const h = harness();
  assert.throws(() => h.ipc('task:add', { title: '会议', reminderMode: 'event' }));
  assert.equal(h.api.get().tasks.length, 0);
  const task = interval(h);
  assert.throws(() => h.ipc('task:update', { id: task.id, patch: { title: '', reminderMinutes: 60 } }));
  assert.equal(h.api.get().tasks[0].title, task.title);
  assert.equal(h.api.get().tasks[0].reminderMinutes, 30);
});
test('completed or deleted task invalidates its currently visible alert', () => {
  for (const action of ['task:toggle', 'task:delete']) {
    const h = harness(); const task = interval(h);
    assert.equal(h.api.active().taskId, task.id);
    h.ipc(action, task.id);
    assert.equal(h.api.active(), null);
    assert.equal(h.api.get().pendingReminders.length, 0);
  }
});
test('main IPC closes one reminder only, old key cannot close the next one', () => {
  const h = harness(); interval(h);
  h.api.enqueue({ key: 'focus-1', type: 'focus', mode: 'focus', title: '专注完成' });
  h.ipc('reminder:action', { key: 'interval-1', action: 'dismiss' });
  h.api.next(); assert.equal(h.api.active().key, 'focus-1');
  h.ipc('reminder:action', { key: 'interval-1', action: 'dismiss' });
  assert.equal(h.api.active().key, 'focus-1');
});
test('away and focus screen arbitration maintains one foreground fullscreen', () => {
  const h = harness();
  h.ipc('focus:update', { action: 'start', sessionId: null });
  const focus = h.windows.find(window=>window.options.backgroundColor==='#2b2240'); focus.onceEvents['ready-to-show']();
  assert.equal(focus.isVisible(), true);
  h.api.presence('开会中');
  assert.equal(focus.isVisible(), false);
  assert.equal(h.api.active().type, 'presence');
  h.api.clearPresence(); h.api.next();
  assert.equal(focus.isVisible(), true);
  h.ipc('focus:hide');
  assert.equal(h.api.get().focusTimer.status, 'running');
  assert.equal(focus.isVisible(), false);
});
test('old data migrates, pending reminders persist, restart does not duplicate them', () => {
  const h = harness({ saved: { tasks: [], habits: [], preferences: { themeId: 'bg5' } } });
  assert.equal(h.api.get().preferences.themeId, 'bg5');
  assert.equal(h.api.get().focusTimer.status, 'idle');
  interval(h);
  const persisted = h.writes.at(-1);
  const second = harness({ saved: persisted });
  second.api.tick(); second.api.next();
  assert.equal(second.api.get().pendingReminders.length, 1);
  assert.equal(second.api.active().key, 'interval-1');
});
test('startup is disabled in development, reads blocked state, and reports failed writes', () => {
  const development = harness({ packaged: false });
  assert.throws(() => development.ipc('startup:set', true));
  assert.equal(development.loginWrites.length, 0);
  const blocked = harness({ login: { openAtLogin: true, launchItems: [{ name: 'com.catdogdiary.todo', enabled: false }] } });
  assert.equal(blocked.api.startup().enabled, false);
  assert.equal(blocked.api.startup().blocked, true);
  assert.equal(blocked.loginWrites.length, 0);
  const failed = harness({ login: { openAtLogin: false } });
  assert.throws(() => failed.ipc('startup:set', true));
  assert.equal(failed.loginWrites[0].args[0], '--autostart');
  assert.equal(failed.loginWrites[0].path, 'X:/猫狗日记/猫狗日记.exe');
});
test('autostart keeps main hidden, respects widget setting; manual second instance shows main', () => {
  for (const widgetVisible of [false, true]) {
    const h = harness({ argv: ['--autostart'], saved: { tasks: [], habits: [], preferences: { widgetVisible } } });
    h.ready();
    const main = h.windows[0]; const widget = h.windows[1];
    main.onceEvents['ready-to-show'](); widget.onceEvents['ready-to-show']();
    assert.equal(main.isVisible(), false);
    assert.equal(widget.isVisible(), widgetVisible);
    h.events['second-instance']({}, ['--autostart']); assert.equal(main.isVisible(), false);
    h.events['second-instance']({}, []); assert.equal(main.isVisible(), true);
    assert.equal(h.loginWrites.length, 0);
  }
});

test('task-linked timer persists its target, prevents switching while active, stops on delete', () => {
  const h=harness();
  const first=h.ipc('task:add',{title:'实验A',reminderMode:'none'}).tasks.at(-1);
  const second=h.ipc('task:add',{title:'实验B',reminderMode:'none'}).tasks.at(-1);
  h.ipc('focus:update',{action:'start',taskId:first.id,sessionId:null});
  assert.equal(h.api.get().focusTimer.taskId,first.id);
  assert.equal(h.api.get().focusTimer.taskTitle,'实验A');
  assert.throws(()=>h.ipc('focus:update',{action:'start',taskId:second.id}));
  assert.equal(h.api.get().focusTimer.taskId,first.id);
  h.ipc('task:delete',first.id);
  assert.equal(h.api.get().focusTimer.status,'idle');
});

test('substep IPC validates, renames, persists and leaves parent open until explicit completion', () => {
  const h=harness(); const task=h.ipc('task:add',{title:'长任务',steps:[{title:'第一步'}]}).tasks.at(-1);
  assert.equal(task.steps.length,1);
  const step=task.steps[0];
  h.ipc('task:step',{taskId:task.id,stepId:step.id,action:'set-completed',completed:true});
  assert.equal(h.api.get().tasks[0].completed,false);
  h.ipc('task:step',{taskId:task.id,stepId:step.id,action:'rename',title:'新名称'});
  assert.equal(h.api.get().tasks[0].steps[0].title,'新名称');
  assert.throws(()=>h.ipc('task:step',{taskId:task.id,stepId:step.id,action:'rename',title:' '}));
  assert.equal(h.api.get().tasks[0].steps[0].title,'新名称');
  const restored=harness({saved:h.writes.at(-1)});
  assert.equal(restored.api.get().tasks[0].steps[0].completed,true);
  h.ipc('task:toggle',task.id);
  assert.throws(()=>h.ipc('task:step',{taskId:task.id,action:'add',title:'不能添加'}));
});

test('Esc widget mode is temporary, hides main, preserves session and preferences',()=>{
  for(const visible of [false,true]) {
    const h=harness({saved:{tasks:[],habits:[],preferences:{widgetVisible:visible}}});h.ready();
    h.windows[0].onceEvents['ready-to-show']();h.windows[1].onceEvents['ready-to-show']();
    h.ipc('focus:update',{action:'start',sessionId:null});const session=h.api.get().focusTimer.sessionId;
    h.windows[2].onceEvents['ready-to-show']();
    assert.equal(h.windows[1].isVisible(),false);
    h.ipc('focus:hide','widget');
    assert.equal(h.windows[0].isVisible(),false);assert.equal(h.windows[1].isVisible(),true);
    assert.equal(h.api.get().presentation.focusWidget,true);assert.equal(h.api.get().preferences.widgetVisible,visible);
    h.ipc('focus:update',{action:'pause',sessionId:session,presentation:'keep'});
    h.ipc('focus:update',{action:'start',sessionId:session,presentation:'keep'});
    assert.equal(h.api.get().focusTimer.sessionId,session);assert.equal(h.api.get().presentation.focusWidget,true);
    assert.equal(h.windows[2].isVisible(),false);
    h.ipc('window:hide-widget');assert.equal(h.windows[1].isVisible(),false);assert.equal(h.api.get().focusTimer.status,'running');
    h.ipc('focus:show');assert.equal(h.windows[2].isVisible(),true);
    h.ipc('focus:update',{action:'stop',sessionId:session});
    assert.equal(h.api.get().presentation.focusWidget,false);assert.equal(h.windows[1].isVisible(),visible);
    assert.equal(h.writes.at(-1).presentation,undefined);
  }
});
test('away and reminders hide mini focus, clear restores it and return-main is distinct',()=>{
  const h=harness();h.ready();h.windows[0].onceEvents['ready-to-show']();h.windows[1].onceEvents['ready-to-show']();
  h.ipc('focus:update',{action:'start',sessionId:null});h.windows[2].onceEvents['ready-to-show']();h.ipc('focus:hide','widget');
  h.api.presence('有事暂离');assert.equal(h.windows[1].isVisible(),false);
  h.api.clearPresence();h.api.next();assert.equal(h.windows[1].isVisible(),true);
  h.api.enqueue({key:'focus-test',type:'focus',title:'结束提醒'});h.api.next();assert.equal(h.windows[1].isVisible(),false);
  h.ipc('reminder:action',{key:'focus-test',action:'dismiss'});h.api.next();assert.equal(h.windows[1].isVisible(),true);
  h.ipc('focus:hide','main');assert.equal(h.windows[0].isVisible(),true);assert.equal(h.api.get().presentation.focusWidget,false);
  assert.throws(()=>h.ipc('focus:hide','invalid'));assert.throws(()=>h.ipc('focus:update',{action:'pause',presentation:'invalid'}));
});
