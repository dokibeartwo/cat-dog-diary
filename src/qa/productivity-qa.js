const fs = require('node:fs');
const path = require('node:path');
const domain = require('../shared/domain');
const runtime = require('../shared/runtime');
module.exports = async ({ mainWindow, getFocusWindow, getState, mutateState, outputDirectory, hideFocusWindow }) => {
  const js = (code) => mainWindow.webContents.executeJavaScript(code);
  const wait = (ms = 220) => new Promise((resolve) => setTimeout(resolve, ms));
  const check = (value, message) => { if (!value) throw new Error('0.5.2 QA: ' + message); };
  const shot = async (name, window = mainWindow) => fs.writeFileSync(path.join(outputDirectory, name), (await window.capturePage()).toPNG());
  const down = (id) => js(`document.querySelector('#${id}').dispatchEvent(new MouseEvent('mousedown', {bubbles:true,cancelable:true})); void 0;`);
  const escape = () => js(`document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape',bubbles:true,cancelable:true})); void 0;`);

  for (const themeId of domain.THEME_IDS) {
    mutateState((draft) => { draft.preferences.themeId = themeId; });
    await js('setView("stage"); document.querySelector("#stagePanel").scrollIntoView({block:"center"});'); await wait();
    await down('dailyCapacity'); await wait();
    const result = await js(`(() => {
      const pop = document.querySelector('.select-pop'); const rows = [...pop.querySelectorAll('.select-pop__option')];
      const r = pop.getBoundingClientRect();
      return {visible:!pop.hidden,count:rows.length,text:rows.map(row=>row.textContent),
        size:parseFloat(getComputedStyle(rows[0]).fontSize), fit:r.left>=0 && r.right<=innerWidth && r.top>=0 && r.bottom<=innerHeight,
        selected:getComputedStyle(pop.querySelector('.is-selected')).backgroundColor};
    })()`);
    check(result.visible && result.count === 6 && result.size >= 16 && result.fit, 'capacity dropdown ' + themeId + ': ' + JSON.stringify(result));
    await shot(`051-dropdown-${themeId}.png`);
    await js("document.querySelectorAll('.select-pop__option')[2].click()"); await wait();
    check(await js("document.querySelector('#dailyCapacity').value === '3'"), 'dropdown commit');
    await down('habitScheduleType'); await wait();
    check(await js("!document.querySelector('.select-pop').hidden && document.querySelectorAll('.select-pop__option').length===2"), 'habit dropdown');
    await escape();
  }
  mutateState((draft) => { draft.preferences.themeId = 'bg1'; });
  await js('document.querySelector("#taskTitle").value="菜单边界测试"; document.querySelector("#taskForm").requestSubmit(); document.querySelector("#taskPlanMode").value="ongoing"; document.querySelector("#taskPlanMode").dispatchEvent(new Event("change"));');
  await wait(); await down('taskReminderMode'); await wait();
  await js("document.querySelectorAll('.select-pop__option')[1].click()");
  check(await js("document.querySelector('#taskReminderMode').value !== 'event'"), 'disabled option cannot be selected');
  await js("document.querySelector('#taskReminderMode').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true})); document.querySelector('#taskReminderMode').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));");
  check(await js("document.querySelector('#taskReminderMode').value === 'interval'"), 'keyboard skips disabled option');
  await down('taskReminderMode'); await escape();
  check(await js("document.querySelector('#addTaskDialog').open && document.querySelector('.select-pop').hidden"), 'Esc closes menu, not form');
  await js("document.querySelector('#cancelAdd').click()");

  const now = Date.now();
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate()-1); yesterday.setHours(15,0,0,0);
  mutateState((draft) => {
    draft.tasks = [
      {id:'qa-long',title:'完成模型对照实验',notes:'先做一个可复现的小结果',dueAt:null,scheduleMode:'ongoing',priority:'high',completed:false,inStage:true,reminderMode:'none',createdAt:new Date(now).toISOString(),steps:[{id:'s1',title:'整理训练数据',completed:true},{id:'s2',title:'运行对照代码',completed:false},{id:'s3',title:'整理图表和实验结论',completed:false}]},
      {id:'qa-carry',title:'回复昨天的重要邮件',notes:'还没完成也不会被漏掉',dueAt:yesterday.toISOString(),scheduleMode:'fixed',priority:'normal',completed:false,inStage:true,reminderMode:'none',createdAt:yesterday.toISOString(),steps:[]},
      {id:'qa-future',title:'下周项目复盘',notes:'讨论下一阶段计划',dueAt:new Date(now+8*86400000).toISOString(),scheduleMode:'fixed',priority:'normal',completed:false,inStage:true,reminderMode:'none',createdAt:new Date(now).toISOString(),steps:[]}
    ];
    draft.focusHistory = [{id:'qa-history',taskId:'qa-long',taskTitle:'完成模型对照实验',startedAt:new Date(now-3600000).toISOString(),endedAt:new Date(now-2100000).toISOString(),outcome:'completed',durationSeconds:1500,segments:[{start:new Date(now-3600000).toISOString(),end:new Date(now-2100000).toISOString()}]}];
    runtime.updateFocus(draft.focusTimer,{action:'stop'});
  });
  await js("ui.search=''; document.querySelector('#taskSearch').value=''; document.querySelector('#taskTitle').value=''; setView('today'); ui.openSteps.add('qa-long'); render(); document.querySelector('.content-scroll').scrollTop=0;"); await wait();
  check(await js("document.querySelector('.task-group-title').textContent.includes('之前未完成') && document.querySelector('[data-id=qa-carry]')"), 'carryover visible in today');
  await shot('052-today-overview.png');
  await js("document.querySelector('[data-id=qa-long]').scrollIntoView({block:'center'});"); await wait();
  await shot('052-task-steps.png');
  check(await js("getComputedStyle(document.querySelector('[data-id=qa-long] .task-actions')).opacity==='1'"), 'task focus button visible without hover');
  await js("document.querySelector('[data-id=qa-long] [data-step-id=s2]').click()"); await wait();
  check(getState().tasks[0].steps[1].completed && !getState().tasks[0].completed,'step completion leaves parent open');
  await js("document.querySelector('input[data-step-draft=qa-long]').value='记录随机种子'; document.querySelector('input[data-step-draft=qa-long]').dispatchEvent(new Event('input',{bubbles:true})); document.querySelector('[data-id=qa-long] [data-action=step-add]').click(); document.querySelector('[data-id=qa-long] [data-action=step-add]').click();"); await wait();
  check(getState().tasks[0].steps.length===4,'step add prevents duplicate');
  await js("document.querySelector('#taskSearch').value='随机种子'; document.querySelector('#taskSearch').dispatchEvent(new Event('input'));"); await wait();
  check(await js("document.querySelectorAll('.task-card').length===1 && document.querySelector('.task-card').dataset.id==='qa-long'"),'search finds substep');
  await js("document.querySelector('#taskSearch').value='下周项目复盘'; document.querySelector('#taskSearch').dispatchEvent(new Event('input'));"); await wait();
  check(await js("document.querySelectorAll('.task-card').length===1 && document.querySelector('.task-card').dataset.id==='qa-future'"),'search spans all tasks');
  await js("document.querySelector('#clearSearch').click(); document.querySelector('[data-id=qa-long] [data-action=start-focus]').click()"); await wait(600);
  const focus = getFocusWindow();
  const readyUntil=Date.now()+10000;
  while(!getFocusWindow()?.isVisible()&&Date.now()<readyUntil)await wait(50);
  check(getState().focusTimer.taskId==='qa-long' && getFocusWindow()?.isVisible(),'task-linked full screen');
  check(await focus.webContents.executeJavaScript("document.querySelector('#focusedTask').textContent==='完成模型对照实验'"),'focused task label');
  await shot('052-task-focus.png',focus);
  await focus.webContents.executeJavaScript("document.querySelector('#pauseButton').click()"); await wait();
  await focus.webContents.executeJavaScript("document.querySelector('#backButton').click()"); await wait();
  check(getState().focusTimer.status==='paused','back preserves paused session');
  await js("document.querySelector('#focusHistoryButton').click()"); await wait();
  check(await js("document.querySelectorAll('.history-row').length===1"),'history UI');
  await shot('052-focus-history.png');
  await js("document.querySelector('#closeHistory').click()");
  // Date rollover must refresh today and preserve entered substep drafts.
  await js("lastListDate='1999-01-01'; ui.stepDrafts.set('qa-long','跨天保留输入'); refreshTemporalUi();");
  check(await js("lastListDate===domain.toLocalDateInput() && document.querySelector('input[data-step-draft=qa-long]').value==='跨天保留输入'"),'midnight refresh preserves drafts');
  for (const themeId of domain.THEME_IDS) {
    mutateState((draft) => { draft.preferences.themeId=themeId; });
    await js("document.querySelector('.content-scroll').scrollTop=0;"); await wait();
    await shot(`052-main-${themeId}.png`);
    for (const [width,height] of [[1600,920],[1280,720]]) {
      mainWindow.setSize(width,height); await wait();
      check(await js("document.querySelector('.main-content').scrollWidth <= document.querySelector('.main-content').clientWidth+1"),'main width fits '+themeId+' '+width);
    }
  }
  mainWindow.setSize(1600,920);
  hideFocusWindow();
};
