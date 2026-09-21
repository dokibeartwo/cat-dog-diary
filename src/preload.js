const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("doneAPI", {
  previewSchedule: (plan) => ipcRenderer.invoke('plan:preview',plan),
  applySchedule: (token) => ipcRenderer.invoke('plan:apply',token),
  reminderReady: (key) => ipcRenderer.invoke('reminder:ready',key),
  testReminder: (style) => ipcRenderer.invoke('reminder:test',style),
  reminderCenterAction: (key,action,minutes) => ipcRenderer.invoke('reminder:center-action',{key,action,minutes}),
  getDataStatus: () => ipcRenderer.invoke('data:status'),
  getSyncStatus: () => ipcRenderer.invoke('sync:status'),
  configureSync: (config) => ipcRenderer.invoke('sync:configure', config),
  sendSyncOtp: (email) => ipcRenderer.invoke('sync:send-otp', email),
  verifySyncOtp: (email, token) => ipcRenderer.invoke('sync:verify-otp', { email, token }),
  syncNow: () => ipcRenderer.invoke('sync:now'),
  getSyncConflicts: () => ipcRenderer.invoke('sync:conflicts'),
  resolveSyncConflict: (conflictId, resolution) => ipcRenderer.invoke('sync:resolve-conflict', { conflictId, resolution }),
  logoutSync: () => ipcRenderer.invoke('sync:logout'),
  deleteSyncAccount: () => ipcRenderer.invoke('sync:delete-account'),
  backupData: () => ipcRenderer.invoke('data:backup'),
  exportData: () => ipcRenderer.invoke('data:export'),
  previewImport: () => ipcRenderer.invoke('data:import-preview'),
  previewRestore: (name) => ipcRenderer.invoke('data:restore-preview',name),
  applyRestore: (token) => ipcRenderer.invoke('data:restore-apply',token),
  restoreTask: (id) => ipcRenderer.invoke('trash:restore',id),
  onQuickOpen: (callback) => { const handler=()=>callback();ipcRenderer.on('quick:open',handler);return ()=>ipcRenderer.removeListener('quick:open',handler); },
  onNotice: (callback) => { const handler=(_event,message)=>callback(message);ipcRenderer.on('app:notice',handler);return ()=>ipcRenderer.removeListener('app:notice',handler); },
  getState: () => ipcRenderer.invoke("state:get"),
  addTask: (task) => ipcRenderer.invoke("task:add", task),
  updateTask: (id, patch) => ipcRenderer.invoke("task:update", { id, patch }),
  toggleTask: (id,expectedCompleted) => ipcRenderer.invoke("task:toggle", id,expectedCompleted),
  deleteTask: (id) => ipcRenderer.invoke("task:delete", id),
  updateTaskStep: (command) => ipcRenderer.invoke('task:step', command),
  addHabit: (habit) => ipcRenderer.invoke("habit:add", habit),
  updateHabit: (id, patch) => ipcRenderer.invoke("habit:update", { id, patch }),
  completeHabit: (id) => ipcRenderer.invoke("habit:complete", id),
  deleteHabit: (id) => ipcRenderer.invoke("habit:delete", id),
  updatePreferences: (patch) => ipcRenderer.invoke("preferences:update", patch),
  autoSchedule: (plan) => ipcRenderer.invoke("plan:auto-schedule", plan),
  toggleTaskReminder: (id) => ipcRenderer.invoke("reminder:toggle-task", id),
  getActiveReminder: () => ipcRenderer.invoke("reminder:get-active"),
  actOnReminder: (key, action, minutes) => ipcRenderer.invoke("reminder:action", { key, action, minutes }),
  setPresence: (status) => ipcRenderer.invoke("presence:set", status),
  clearPresence: () => ipcRenderer.invoke("presence:clear"),
  updateFocusTimer: (command) => ipcRenderer.invoke("focus:update", command),
  showFocusWindow: () => ipcRenderer.invoke('focus:show'),
  hideFocusWindow: (target = 'widget') => ipcRenderer.invoke('focus:hide', target),
  hideWidget: () => ipcRenderer.invoke('window:hide-widget'),
  getStartupSettings: () => ipcRenderer.invoke('startup:get'),
  setStartup: (enabled) => ipcRenderer.invoke('startup:set', enabled),
  showMainWindow: () => ipcRenderer.invoke("window:show-main"),
  toggleWidget: () => ipcRenderer.invoke("window:toggle-widget"),
  setWidgetVisible: (enabled) => ipcRenderer.invoke('window:set-widget',enabled),
  retryWindow: (role) => ipcRenderer.invoke('window:retry',role),
  getUiContext: () => ipcRenderer.invoke('ui:context'),
  uiReady: (signal) => ipcRenderer.invoke('ui:ready',signal),
  uiFailed: (signal) => ipcRenderer.invoke('ui:failed',signal),
  onUiPrepare: (callback) => {
    const handler=(_event,context)=>callback(context);ipcRenderer.on('ui:prepare',handler);
    return ()=>ipcRenderer.removeListener('ui:prepare',handler);
  },
  minimize: () => ipcRenderer.invoke("window:minimize"),
  close: () => ipcRenderer.invoke("window:close"),
  onStateChanged: (callback) => {
    const handler = (_event, state) => callback(state);
    ipcRenderer.on("state:changed", handler);
    return () => ipcRenderer.removeListener("state:changed", handler);
  },
  onReminderChanged: (callback) => {
    const handler = (_event, reminder) => callback(reminder);
    ipcRenderer.on("reminder:changed", handler);
    return () => ipcRenderer.removeListener("reminder:changed", handler);
  }
});
