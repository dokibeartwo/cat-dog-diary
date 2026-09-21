window.Workbench = (() => {
  'use strict';
  const D=window.DiaryV1;
  let tab='upcoming', planToken=null, busy=false, category='', settingsInfo=null;
  const e=value=>String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const q=id=>document.getElementById(id);
  const styleName=value=>value==='light'?'轻提示':'全屏提醒';
  const repeatName=value=>({none:'',daily:'每天重复',weekdays:'工作日重复',weekly:'每周重复',monthly:'每月重复'}[value] || '');
  async function safely(action,button) {
    if(button?.disabled)return;
    if(button)button.disabled=true;
    try{return await action();}catch(error){showToast(error.message || '操作未完成，请重试');}
    finally{if(button?.isConnected)button.disabled=false;}
  }
  function openQuick() {
    if(document.querySelector('dialog[open]'))return;
    if(ui.currentView==='reminders')setView('today');
    q('taskTitle').focus();
    if(q('taskTitle').value.trim())openAddDialog();
  }
  function capture(input) {
    const parsed=D.parseCapture(input);
    q('captureTitle').value=parsed.title;
    q('taskPlanMode').value=ui.currentView==='stage'||ui.currentView==='backlog'?'backlog':'fixed';
    const parts=[];
    if(parsed.planDate) {q('taskDate').value=parsed.planDate;parts.push(parsed.planDate);q('taskPlanMode').value=parsed.time?'fixed':'day';}
    if(parsed.time) {q('taskTime').value=parsed.time;parts.push(parsed.time);}
    if(parsed.reminderMinutes) {q('taskReminderMode').value='event';q('taskReminderMinutes').value=parsed.reminderMinutes;q('taskReminderMinutes').dataset.edited='true';parts.push(`提前 ${parsed.reminderMinutes} 分钟提醒`);}
    q('captureRecognition').hidden=!parts.length&&!parsed.notes.length;
    q('captureRecognition').textContent=(parts.length?'识别结果，请确认：'+parts.join(' · '):'请核对时间')+(parsed.notes.length?'。'+parsed.notes.join('；'):'');
    if(parsed.matched)addDateEdited=true;
    return parsed;
  }
  function addFields() {
    return { planDate:q('taskPlanMode').value==='day'?q('taskDate').value:null,
      category:q('taskCategory').value,estimateMinutes:Number(q('taskEstimate').value),recurrence:{kind:q('taskRepeat').value},
      reminderPresentation:document.querySelector('[name=taskPresentation]:checked').value,urgentReminder:q('taskUrgent').checked };
  }
  function fillEdit(task) {
    q('editCategory').value=task.category || '';q('editEstimate').value=task.estimateMinutes || 25;
    q('editRepeat').value=task.recurrence?.kind || 'none';q('editPresentation').value=task.reminderPresentation || 'fullscreen';q('editUrgent').checked=task.urgentReminder===true;
  }
  function editFields() {
    const original=ui.state.tasks.find(t=>t.id===q('editId').value);
    const kind=q('editRepeat').value;
    return { planDate:q('editScheduleMode').value==='day'?q('editDate').value:null,
      category:q('editCategory').value,estimateMinutes:Number(q('editEstimate').value),
      recurrence:kind===original?.recurrence?.kind?original.recurrence:{kind},
      reminderPresentation:q('editPresentation').value,urgentReminder:q('editUrgent').checked };
  }
  function taskMeta(task) {
    return `<span class="category-chip">${e(task.category)}</span><span>预计 ${task.estimateMinutes || 25} 分钟</span>${task.recurrence?.kind!=='none'&&task.recurrence?.kind?`<span>${repeatName(task.recurrence.kind)}</span>`:''}`;
  }
  function grouped(tasks) {
    const today=domain.toLocalDateInput();
    const groups=[['☆ 今日重点',t=>!t.completed&&t.priorityDate===today],['◷ 定时事项',t=>!t.completed&&t.dueAt&&!domain.isCarryoverTask(t)],['灵活推进',t=>!t.completed&&!domain.isCarryoverTask(t)],['之前未完成',t=>!t.completed],['已经完成啦',t=>t.completed]];
    let rest=[...tasks], html='';
    for(const [title,match] of groups){const matches=rest.filter(match);rest=rest.filter(t=>!match(t));if(matches.length)html+=`<h3 class="task-group-title">${title} <small>${matches.length} 项</small></h3>`+matches.map(taskMarkup).join('');}
    return html || emptyMarkup();
  }
  function categoryMatches(task) {return !category||task.category===category;}
  function origin(item) {return item.taskId?ui.state.tasks.find(t=>t.id===item.taskId):ui.state.habits.find(h=>h.id===item.habitId);}
  function upcoming() {
    const pending=ui.state.pendingReminders || [];
    const rows=[];
    for(const task of ui.state.tasks.filter(t=>!t.completed)) {
      if(task.reminderActive&&task.nextReminderAt&&!pending.some(r=>r.taskId===task.id&&r.type===task.reminderMode))rows.push({type:task.reminderMode,taskId:task.id,title:task.title,at:task.nextReminderAt,detail:task.reminderMode==='event'?`执行 ${formatDateLabel(task.dueAt)} · 提前 ${task.reminderMinutes} 分钟`:`每 ${task.reminderMinutes} 分钟检查进度`});
      const info=domain.deadlineReminderInfo(task);
      if(info&&!pending.some(r=>r.taskId===task.id&&r.type==='deadline')) {
        const at=new Date(info.deadlineDate+'T00:00:00');at.setDate(at.getDate()-info.reminderDays);
        if(at<new Date()) {at.setTime(Date.now());if(task.deadlineLastRemindedDate===domain.toLocalDateInput())at.setDate(at.getDate()+1);}
        rows.push({type:'deadline',taskId:task.id,title:task.title,at:at.toISOString(),detail:`最晚 ${info.deadlineDate} · 提前 ${info.reminderDays} 天开始每日提醒`});
      }
    }
    for(const habit of ui.state.habits.filter(h=>h.active&&h.nextReminderAt&&!pending.some(r=>r.habitId===h.id)))rows.push({type:'habit',habitId:habit.id,title:habit.title,at:habit.nextReminderAt,detail:habit.scheduleType==='daily'?`定点 ${habit.time}`:`每 ${habit.intervalMinutes} 分钟 · 处理后重新计时`});
    return rows.sort((a,b)=>new Date(a.at)-new Date(b.at));
  }
  function reminderRow(item,pending=false) {
    const owner=origin(item), when=item.availableAt || item.at || item.occurredAt;
    const reason=pending?D.deferredReason(ui.state,item):'';
    const key=e(item.key), taskId=e(item.taskId || ''),habitId=e(item.habitId || '');
    return `<article class="reminder-row"><time>${when?e(formatDateLabel(when)):'等待处理'}</time><div><strong>${e(owner?.title || item.title)}</strong><p>${e(pending?(reason || '等待处理 · 不会重复弹出'):item.detail)}</p><small>${e(item.type==='deadline'?'截止提醒':item.type==='habit'?'每日坚持':item.type==='interval'?'循环阶段检查':item.type==='focus'?'番茄钟':'定时事项')}</small></div><div class="reminder-row-actions">
      ${owner?`<button data-reminder-style="${owner.reminderPresentation==='light'?'fullscreen':'light'}" data-task="${taskId}" data-habit="${habitId}">${styleName(owner.reminderPresentation)}</button>`:''}
      ${pending?`<button data-reminder-key="${key}" data-reminder-action="show">打开提醒</button><button data-reminder-key="${key}" data-reminder-action="dismiss">我知道了</button>${owner?`<select aria-label="稍后提醒时间" data-snooze="${key}"><option value="5">5 分钟</option><option value="10" selected>10 分钟</option><option value="30">30 分钟</option><option value="60">1 小时</option></select><button data-reminder-key="${key}" data-reminder-action="snooze">稍后</button><button class="primary-button" data-reminder-key="${key}" data-reminder-action="complete">${item.habitId?'这次做到了':'完成任务'}</button>`:''}`:`<button data-adjust-task="${taskId}" data-adjust-habit="${habitId}">查看与调整</button>`}
      </div></article>`;
  }
  function renderReminders() {
    const pending=ui.state.pendingReminders || [], future=upcoming(), history=[...(ui.state.reminderHistory || [])].reverse();
    q('reminderCenter').innerHTML=`<div class="reminder-master"><div><strong>${ui.state.preferences.remindersEnabled!==false?'提醒已开启':'提醒已暂停'}</strong><p>总开关控制任务和习惯；专注结束提示仍保留。</p></div><button class="switch" role="switch" aria-label="提醒总开关" aria-checked="${ui.state.preferences.remindersEnabled!==false}" data-pref-switch="remindersEnabled"><span></span></button></div>
      <div class="reminder-toolbar"><div class="status-tabs">${[['upcoming','即将提醒',future.length],['pending','等待处理',pending.length],['history','提醒记录',history.length]].map(([value,name,count])=>`<button data-reminder-tab="${value}" class="${value===tab?'is-active':''}">${name} ${count}</button>`).join('')}</div><button data-open-settings>提醒设置</button><button data-test-reminder="light">测试轻提示</button><button data-test-reminder="fullscreen">测试全屏</button></div>
      ${tab==='upcoming'?future.map(r=>reminderRow(r)).join(''):tab==='pending'?pending.map(r=>reminderRow(r,true)).join(''):history.map(r=>`<article class="history-row"><div><strong>${e(r.title)}</strong><small>${e(new Date(r.handledAt).toLocaleString('zh-CN'))}</small></div><b>${({dismiss:'已知晓',snooze:'稍后提醒',complete:'已完成','start-break':'开始休息','start-focus':'开始专注'})[r.action] || e(r.action)}</b></article>`).join('')}
      ${!(tab==='upcoming'?future.length:tab==='pending'?pending.length:history.length)?'<div class="empty-state"><strong>这里暂时没有提醒</strong><p>已经设置的任务与习惯会自动出现在这里。</p></div>':''}`;
  }
  function render() {
    const isReminder=ui.currentView==='reminders';document.body.classList.toggle('is-reminder-view',isReminder);q('reminderCenter').hidden=!isReminder;
    q('backlogCount').textContent=ui.state.tasks.filter(t=>domain.isTaskInView(t,'backlog')).length;
    q('reminderCount').textContent=ui.state.pendingReminders?.length || 0;
    q('appVersion').textContent=ui.state.appVersion || '1.0.0';
    q('railToggle').setAttribute('aria-expanded',String(!document.body.classList.contains('rail-collapsed')));
    const categories=[...new Set(['工作','学习','生活',...ui.state.tasks.map(t=>t.category).filter(Boolean)])];
    q('categoryNav').innerHTML='<small>我的分类</small>'+categories.map(value=>`<button type="button" data-category="${e(value)}" class="${category===value?'is-active':''}">● ${e(value)}</button>`).join('')+(category?'<button data-category="">查看全部</button>':'');
    document.querySelectorAll('.category-suggestions').forEach(group=>{
      group.innerHTML=categories.slice(0,12).map(value=>`<button type="button" data-category-value="${e(value)}">${e(value)}</button>`).join('');
    });
    if(ui.state.dataStatus?.readOnly){q('windowErrorBanner').hidden=false;q('windowErrorMessage').textContent=ui.state.dataStatus.message;q('retryWindow').hidden=true;}
    if(isReminder)renderReminders();
    const next=upcoming()[0];
    q('habitNextLabel').textContent=next?`${next.title} · ${formatDateLabel(next.at)}`:'暂无安排中的提醒';
  }
  async function settings() {
    settingsInfo=await window.doneAPI.getDataStatus();
    const syncInfo=await window.doneAPI.getSyncStatus();
    const prefs=ui.state.preferences;
    q('settingsContent').innerHTML=`${!prefs.onboardingDone?'<div class="welcome-note"><strong>欢迎使用猫狗日记</strong><p>默认数据只保存在本机。预置习惯均未开启；如需跨设备使用，可在下方自行配置可选的云同步。</p><button id="finishWelcome" class="primary-button">知道了，开始使用</button></div>':''}
      ${settingsInfo.message?`<p class="form-error">${e(settingsInfo.message)}</p>`:''}
      <h3>提醒与快捷操作</h3>
      ${[['remindersEnabled','提醒总开关'],['quietEnabled','启用勿扰时段'],['urgentThroughQuiet','允许已标为重要的提醒打破勿扰'],['soundEnabled','提醒与完成音效'],['quickShortcutEnabled','全局快捷键 Ctrl + Alt + N']].map(([key,label])=>`<label class="settings-row"><span>${label}</span><input type="checkbox" data-settings-pref="${key}" ${prefs[key]!==false&&(key==='remindersEnabled'||key==='soundEnabled'||key==='quickShortcutEnabled')||prefs[key]===true?'checked':''} /></label>`).join('')}
      <div class="dialog-grid"><label>勿扰开始<input type="time" data-settings-pref="quietStart" value="${prefs.quietStart || '22:00'}" /></label><label>勿扰结束<input type="time" data-settings-pref="quietEnd" value="${prefs.quietEnd || '08:00'}" /></label></div><p class="field-hint">当前快捷键${ui.state.quickShortcutAvailable?'已注册':'未注册或被其他软件占用'}。窗口内 Ctrl + K 仍可使用。</p>
      <h3>跨设备同步</h3><div class="sync-panel"><p class="field-hint">${syncInfo.signedIn?`已登录 ${e(syncInfo.email)} · ${syncInfo.lastSyncedAt?`上次同步 ${e(new Date(syncInfo.lastSyncedAt).toLocaleString('zh-CN'))}`:'尚未同步'} · 待上传 ${syncInfo.pending} 条`:'可选：使用 Supabase 将任务、习惯和专注记录同步到安卓。未配置时不会上传本机数据。'}</p>
      ${syncInfo.error?`<p class="form-error">上次同步未完成：${e(syncInfo.error)}</p>`:''}${!syncInfo.configured?'<div class="dialog-grid"><label>Supabase URL<input id="syncUrl" type="url" placeholder="https://你的项目.supabase.co" /></label><label>Publishable key<input id="syncPublishableKey" type="password" placeholder="仅保存到本机" /></label></div><button id="syncConfigure">保存同步配置</button>':''}
      ${!syncInfo.signedIn?'<div class="dialog-grid"><label>邮箱<input id="syncEmail" type="email" placeholder="name@example.com" /></label><label>验证码<input id="syncOtp" inputmode="numeric" placeholder="邮箱中的验证码" /></label></div><div class="settings-buttons"><button id="syncSendOtp">发送验证码</button><button id="syncVerifyOtp" class="primary-button">验证并登录</button></div>':'<div class="settings-buttons"><button id="syncNow">立即同步</button><button id="syncLogout">退出账号</button><button id="syncDeleteAccount" class="danger-button">删除云端账号</button></div>'}</div>
      <h3>数据备份与恢复</h3><p class="field-hint">每日首次保存自动备份；恢复前保留原数据。备份含任务正文，请只发给信任的人。删除任务可从下方回收站找回。</p><div class="settings-buttons"><button id="backupNow">立即备份</button><button id="exportData">导出到文件</button><button id="importData">导入备份</button></div>
      <details><summary>本机备份（${settingsInfo.backups.length}）</summary><div class="backup-list">${settingsInfo.backups.slice(0,50).map(item=>`<div><span>${e(item.name)}</span><button data-restore-backup="${e(item.name)}">恢复</button></div>`).join('') || '<p>还没有备份。</p>'}</div></details>
      <details><summary>回收站（${ui.state.trash?.length || 0}）</summary>${(ui.state.trash || []).map(item=>`<div class="trash-row"><span>${e(item.task.title)}</span><button data-restore-task="${e(item.task.id)}">恢复任务</button></div>`).join('') || '<p>回收站是空的。</p>'}</details><h3>窗口与系统</h3>`;
    if(!q('settingsDialog').open)q('settingsDialog').showModal();
  }
  async function confirmRestore(preview) {
    if(!preview)return;
    const accepted=await window.ThemeConfirm.ask({title:'用备份恢复数据？',message:`将恢复 ${preview.tasks} 项任务、${preview.habits} 个习惯、${preview.focusRecords} 条专注记录，并替换当前内容。替换前会保存原数据。`,confirmLabel:'备份并恢复',danger:true});
    if(!accepted)return;
    ui.state=await window.doneAPI.applyRestore(preview.token);renderAll();await settings();showToast('数据已恢复，旧数据备份已保留');
  }
  function renderAll(){window.dispatchEvent(new Event('diary:render'));}
  async function previewPlan(plan) {
    const preview=await window.doneAPI.previewSchedule(plan);planToken=preview.token;
    q('schedulePreviewRows').innerHTML=`<p>每日最多 ${preview.dailyCapacity} 项、${preview.dailyMinutes} 分钟。手动日期不变；未安排成功的任务保持原状。</p>`+preview.updates.map(u=>`<div class="plan-row"><strong>${e(ui.state.tasks.find(t=>t.id===u.id)?.title)}</strong><span>${u.planDate || e(formatDateLabel(u.dueAt))} · ${u.estimateMinutes} 分钟</span></div>`).join('')+(preview.conflicts.length?'<h3>需要你决定</h3>'+preview.conflicts.map(c=>`<p class="form-error">${e(c.title)}：${e(c.reason)}</p>`).join(''):'');
    q('applySchedule').disabled=!preview.updates.length;q('schedulePreviewDialog').showModal();
  }
  function openHabit(id) {
    const habit=ui.state.habits.find(h=>h.id===id);if(!habit)return;
    const config=D.habitFields(habit);q('habitSettingsId').value=id;q('habitPresentation').value=config.reminderPresentation;
    document.querySelectorAll('[name=habitDay]').forEach(box=>box.checked=config.days.includes(Number(box.value)));
    q('habitWindowEnabled').checked=config.windowEnabled;q('habitWindowStart').value=config.windowStart;q('habitWindowEnd').value=config.windowEnd;
    q('habitSettingsDialog').showModal();
  }
  function init() {
    // Keep convenient suggestions without opening an unthemed OS datalist.
    document.querySelectorAll('input[list="categoryOptions"]').forEach(input=>{
      input.removeAttribute('list');
      const choices=document.createElement('div');choices.className='category-suggestions';
      choices.setAttribute('role','group');choices.setAttribute('aria-label','常用分类');
      choices.addEventListener('click',event=>{
        const choice=event.target.closest('[data-category-value]');if(!choice)return;
        input.value=choice.dataset.categoryValue;input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();
      });
      input.after(choices);
    });
    q('legacyPreferences').append(document.querySelector('.preferences-panel'));
    document.querySelector('.window-bar').append(document.querySelector('.window-actions'));
    q('focusPanel').before(q('taskForm'));
    const focusDetails=document.createElement('details');focusDetails.className='focus-more';focusDetails.innerHTML='<summary>模式与时长</summary><div></div>';
    focusDetails.querySelector('div').append(document.querySelector('.focus-modes'),document.querySelector('.focus-duration'));
    q('focusPanel').append(focusDetails);
    q('focusPanel').classList.add('compact-focus');
    window.addEventListener('diary:render',()=>renderAllApp());
    function renderAllApp(){applyTheme();updateHeader();updateSidebar();updateFocusDisplay();renderHabits();updateFocusInsights();renderTaskList();render();}
    q('quickCaptureButton').addEventListener('click',openQuick);
    window.doneAPI.onQuickOpen(openQuick);window.doneAPI.onNotice(showToast);
    document.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();openQuick();}});
    q('railToggle').addEventListener('click',()=>{document.body.classList.toggle('rail-collapsed');document.body.classList.toggle('rail-overlay');});
    q('settingsButton').addEventListener('click',()=>safely(settings));
    q('categoryNav').addEventListener('click',event=>{const button=event.target.closest('[data-category]');if(!button)return;category=button.dataset.category;if(ui.currentView==='reminders')setView('today');renderAll();});
    document.addEventListener('click',event=>{
      const close=event.target.closest('[data-close-dialog]');if(close)q(close.dataset.closeDialog).close();
      if(event.target.closest('[data-open-settings]'))safely(settings);
      const test=event.target.closest('[data-test-reminder]');if(test)safely(()=>window.doneAPI.testReminder(test.dataset.testReminder),test);
      const toggle=event.target.closest('[data-pref-switch]');if(toggle)safely(async()=>{ui.state=await window.doneAPI.updatePreferences({[toggle.dataset.prefSwitch]:ui.state.preferences[toggle.dataset.prefSwitch]===false});renderAll();},toggle);
    });
    q('reminderCenter').addEventListener('click',event=>{
      const target=event.target.closest('button');if(!target)return;
      if(target.dataset.reminderTab){tab=target.dataset.reminderTab;renderReminders();return;}
      if(target.dataset.reminderStyle)safely(async()=>{const patch={reminderPresentation:target.dataset.reminderStyle};ui.state=target.dataset.task?await window.doneAPI.updateTask(target.dataset.task,patch):await window.doneAPI.updateHabit(target.dataset.habit,patch);renderAll();},target);
      if(target.hasAttribute('data-adjust-task')){if(target.dataset.adjustTask)openEditor(ui.state.tasks.find(t=>t.id===target.dataset.adjustTask));else openHabit(target.dataset.adjustHabit);}
      if(target.dataset.reminderKey)safely(async()=>{
        const key=target.dataset.reminderKey,action=target.dataset.reminderAction;
        if(action==='complete'&&target.closest('.reminder-row')&& !await window.ThemeConfirm.ask({title:'完成这件事？',message:'主任务和剩余小步骤会一并标记完成；习惯则仅记录本次。',confirmLabel:'确认完成'}))return;
        const select=[...q('reminderCenter').querySelectorAll('[data-snooze]')].find(s=>s.dataset.snooze===key);
        ui.state=await window.doneAPI.reminderCenterAction(key,action,Number(select?.value || 10));renderAll();
      },target);
    });
    q('applySchedule').addEventListener('click',event=>safely(async()=>{ui.state=await window.doneAPI.applySchedule(planToken);q('schedulePreviewDialog').close();renderAll();showToast('排期已应用，手动安排和未分配任务保持不变');},event.currentTarget));
    q('habitSettingsForm').addEventListener('submit',event=>{event.preventDefault();safely(async()=>{
      const days=[...document.querySelectorAll('[name=habitDay]:checked')].map(box=>Number(box.value));if(!days.length)throw Error('至少选择一天；暂停提醒请关闭该习惯开关');
      ui.state=await window.doneAPI.updateHabit(q('habitSettingsId').value,{reminderPresentation:q('habitPresentation').value,days,windowEnabled:q('habitWindowEnabled').checked,windowStart:q('habitWindowStart').value,windowEnd:q('habitWindowEnd').value});q('habitSettingsDialog').close();renderAll();
    },event.submitter);});
    q('settingsDialog').addEventListener('change',event=>{
      const input=event.target;if(!input.dataset.settingsPref)return;
      safely(async()=>{ui.state=await window.doneAPI.updatePreferences({[input.dataset.settingsPref]:input.type==='checkbox'?input.checked:input.value});renderAll();},input);
    });
    q('settingsContent').addEventListener('click',event=>{
      const button=event.target.closest('button');if(!button)return;
      safely(async()=>{
        if(button.id==='finishWelcome'){ui.state=await window.doneAPI.updatePreferences({onboardingDone:true});await settings();}
        if(button.id==='syncConfigure'){await window.doneAPI.configureSync({url:q('syncUrl').value,publishableKey:q('syncPublishableKey').value});await settings();showToast('同步配置已保存');}
        if(button.id==='syncSendOtp'){await window.doneAPI.sendSyncOtp(q('syncEmail').value);showToast('验证码已发送，请检查邮箱');}
        if(button.id==='syncVerifyOtp'){ui.state=await window.doneAPI.verifySyncOtp(q('syncEmail').value,q('syncOtp').value);await settings();showToast('已登录，点击“立即同步”上传本机数据');}
        if(button.id==='syncNow'){const result=await window.doneAPI.syncNow();ui.state=result;await settings();renderAll();showToast(`同步完成：上传 ${result.syncResult?.pushed || 0} 条，下载 ${result.syncResult?.pulled || 0} 条`);}
        if(button.id==='syncLogout'){await window.doneAPI.logoutSync();await settings();showToast('已退出同步账号，本机数据保留');}
        if(button.id==='syncDeleteAccount'){if(await window.ThemeConfirm.ask({title:'删除云端账号？',message:'云端任务、习惯、专注记录和冲突记录会永久删除；本机数据不会删除。',confirmLabel:'删除云端账号',danger:true})){await window.doneAPI.deleteSyncAccount();await settings();showToast('云端账号已删除');}}
        if(button.id==='backupNow'){await window.doneAPI.backupData();await settings();showToast('备份已保存');}
        if(button.id==='exportData'){if(await window.doneAPI.exportData())showToast('数据已导出');}
        if(button.id==='importData')await confirmRestore(await window.doneAPI.previewImport());
        if(button.dataset.restoreBackup)await confirmRestore(await window.doneAPI.previewRestore(button.dataset.restoreBackup));
        if(button.dataset.restoreTask){ui.state=await window.doneAPI.restoreTask(button.dataset.restoreTask);await settings();renderAll();showToast('任务已恢复');}
      },button);
    });
  }
  function ready(){if(!ui.state.preferences.onboardingDone||ui.state.dataStatus?.readOnly)safely(settings);}
  return {init,render,ready,capture,addFields,fillEdit,editFields,taskMeta,grouped,categoryMatches,previewPlan,openHabit,styleName};
})();
