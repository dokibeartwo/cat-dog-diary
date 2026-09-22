'use strict';
const fs=require('node:fs'),path=require('node:path');
const assert=require('node:assert/strict');
module.exports=async function qa(api){
  const output=path.join(process.cwd(),'qa-reports','v1-'+Date.now());fs.mkdirSync(output,{recursive:true});
  const checks=[],errors=[];
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  async function until(predicate,message,limit=15000){const end=Date.now()+limit;while(Date.now()<end){if(await predicate())return;await wait(80);}throw Error('Timeout: '+message);}
  const run=(code)=>Promise.race([api.main().webContents.executeJavaScript(code,true),new Promise((_,reject)=>setTimeout(()=>reject(Error('Renderer command timed out: '+code.slice(0,100))),10000))]);
  fs.writeFileSync(path.join(output,'progress.log'),'qa-start\n');
  api.main().webContents.on('console-message',details=>{if(details.level==='error')errors.push(details.message);});
  async function shot(name,win=api.main(),region){
    fs.appendFileSync(path.join(output,'progress.log'),'capture '+name+'\n');
    assert.ok(win?.isVisible(),name+' must capture an actually visible window');
    await wait(120);
    const frame=await Promise.race([win.webContents.capturePage(region),new Promise((_,reject)=>setTimeout(()=>reject(Error('Capture timeout: '+name)),5000))]);
    fs.writeFileSync(path.join(output,name+'.png'),frame.toPNG());
  }
  async function click(selector,win=api.main()){
    assert.ok(win?.isVisible(),'click window must be visible: '+selector);win.focus();
    await win.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({block:'nearest',behavior:'instant'})`);
    await wait(50);
    const rect=await win.webContents.executeJavaScript(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('missing: '+${JSON.stringify(selector)});const r=e.getBoundingClientRect(),x=Math.round(r.x+r.width/2),y=Math.round(r.y+r.height/2);return {x,y,disabled:e.disabled,hit:e.contains(document.elementFromPoint(x,y))}})()`);
    assert.equal(Boolean(rect.disabled),false,selector+' must be enabled');
    assert.ok(rect.hit,selector+' must be the element at the click location');
    win.webContents.sendInputEvent({type:'mouseDown',x:rect.x,y:rect.y,button:'left',clickCount:1});win.webContents.sendInputEvent({type:'mouseUp',x:rect.x,y:rect.y,button:'left',clickCount:1});await wait(160);
  }
  async function esc(win){win.webContents.sendInputEvent({type:'keyDown',keyCode:'ESC'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'ESC'});await wait(150);}
  function check(name,condition){assert.ok(condition,name);checks.push(name);console.log('PASS '+name);}
  async function checkDockMenu(buttonId,popoverId,label){
    await click('#'+buttonId);
    check(label+' compact dock geometry',await run(`(()=>{const p=document.getElementById('${popoverId}'),r=p.getBoundingClientRect(),b=document.getElementById('${buttonId}').getBoundingClientRect();return !p.hidden&&r.width>=250&&r.width<=300&&r.left>=8&&r.right<=innerWidth-8&&r.top>=8&&r.bottom<=innerHeight-8&&Math.abs(r.left-b.left)<2&&r.bottom<=b.top-8})()`));
  }
  async function checkStageGeometry(label){
    check(label+' date range arrow centered and grouped',await run(`(()=>{
      const rect=s=>document.querySelector(s).getBoundingClientRect();
      const a=document.querySelector('#stageStart').closest('.theme-temporal').getBoundingClientRect();
      const b=document.querySelector('#stageEnd').closest('.theme-temporal').getBoundingClientRect();
      const r=rect('.stage-date-range .range-arrow'),p=rect('.stage-controls');
      return Math.abs(a.y+a.height/2-r.y-r.height/2)<=1&&Math.abs(b.y+b.height/2-r.y-r.height/2)<=1&&Math.abs((a.right+b.left)/2-r.x-r.width/2)<=1&&a.right<=r.left&&r.right<=b.left&&a.left>=p.left&&b.right<=p.right;
    })()`));
  }
  try{
    fs.appendFileSync(path.join(output,'progress.log'),'waiting-main\n');
    await until(()=>run(`Boolean(document.querySelector('#taskList .task-card') && window.Workbench && !document.querySelector('#settingsDialog').open)`),'initialize');
    api.main().setSize(1600,1000);api.main().showInactive();
    await run(`window.addEventListener('error',e=>console.error(e.message));window.addEventListener('unhandledrejection',e=>console.error(String(e.reason)))`);
  }catch(error){
    fs.appendFileSync(path.join(output,'progress.log'),error.stack+'\n');
    await shot('startup-failure').catch(()=>{});
    throw error;
  }
  try{
    api.mutate(state=>{state.preferences.soundEnabled=false;state.preferences.notifications=false;state.tasks[0].priorityDate=new Date().toLocaleDateString('en-CA');state.habits.forEach(h=>h.active=false);});
    check('habit interval input accepts one minute',await run(`document.querySelector('#habitInterval').min==='1'`));
    const habitBefore=Date.now();
    await run(`window.doneAPI.addHabit({title:'一分钟间隔验收',scheduleType:'interval',intervalMinutes:1})`);
    const shortHabit=api.state().habits.at(-1);
    check('one-minute habit is scheduled without a hidden five-minute clamp',shortHabit.intervalMinutes===1&&Date.parse(shortHabit.nextReminderAt)>=habitBefore+60000&&Date.parse(shortHabit.nextReminderAt)<=Date.now()+60000);
    api.mutate(state=>{state.habits.find(h=>h.id===shortHabit.id).active=false;});
    for(const theme of ['bg1','bg2','bg3','bg4','bg5','bg6']){
      await run(`window.doneAPI.updatePreferences({themeId:'${theme}'})`);await wait(200);await shot('today-'+theme);
      const bounds=await run(`({x:document.documentElement.scrollWidth>innerWidth,y:document.documentElement.scrollHeight>innerHeight,theme:document.documentElement.dataset.themeId})`);
      check(theme+' theme and outer layout',!bounds.x&&!bounds.y&&bounds.theme===theme);
    }
    for(const theme of ['bg1','bg2','bg3','bg4','bg5','bg6']){
      await run(`window.doneAPI.updatePreferences({themeId:'${theme}'})`);
      await checkDockMenu('themeMenuButton','themePopover',theme+' themes');
      await shot('compact-theme-'+theme);
      await click('#themePopover [data-theme-id='+theme+']');
      check(theme+' theme selection closes dock',await run(`document.querySelector('#themePopover').hidden&&document.documentElement.dataset.themeId==='${theme}'`));
      await checkDockMenu('presenceMenuButton','presencePopover',theme+' presence');
      await shot('compact-presence-'+theme);
      await esc(api.main());
      check(theme+' presence Escape closes without changing status',await run(`document.querySelector('#presencePopover').hidden&&document.querySelector('#presenceMenuButton').getAttribute('aria-expanded')==='false'`)&&!api.state().presence.active);
      await click('[data-view=stage]');
      await run(`document.querySelector('.stage-controls').scrollIntoView({block:'center',behavior:'instant'})`);
      await checkStageGeometry(theme);
      await shot('stage-alignment-'+theme);
      await click('[data-view=today]');
    }
    await run(`window.doneAPI.updatePreferences({themeId:'bg1'})`);
    for(const width of [1600,1280,1093,960])for(const height of [800,640]){
      api.main().setSize(width,height);await wait(160);
      await checkDockMenu('themeMenuButton','themePopover',width+'x'+height+' themes');
      await esc(api.main());
      await checkDockMenu('presenceMenuButton','presencePopover',width+'x'+height+' presence');
      await click('[data-view=stage]');
      check(width+'x'+height+' outside click closes dock',await run(`document.querySelector('#presencePopover').hidden`));
      await run(`document.querySelector('.stage-controls').scrollIntoView({block:'center',behavior:'instant'})`);
      await checkStageGeometry(width+'x'+height);
      check(width+'x'+height+' stage no horizontal overflow',await run(`document.querySelector('.content-scroll').scrollWidth<=document.querySelector('.content-scroll').clientWidth`));
      await shot('stage-alignment-'+width+'x'+height);
      await click('[data-view=today]');
    }
    api.main().setSize(1600,1000);await wait(160);
    await run(`window.doneAPI.updatePreferences({themeId:'bg1'})`);
    for(const theme of ['bg1','bg2','bg3','bg4','bg5','bg6']){
      await run(`window.doneAPI.updatePreferences({themeId:'${theme}'})`);
      await run(`document.querySelector('#taskTitle').value='检查主题控件'`);await click('#taskForm .add-button');
      await click('#taskPriority');
      check(theme+' form select keeps one arrow and fits',await run(`(()=>{const p=document.querySelector('#theme-select-popup'),r=p.getBoundingClientRect();return !p.hidden && r.left>=0 && r.right<=innerWidth && r.bottom<=innerHeight && getComputedStyle(document.querySelector('#taskPriority')).backgroundRepeat==='no-repeat'})()`));
      await esc(api.main());check(theme+' form survives picker Esc',await run(`document.querySelector('#addTaskDialog').open`));
      await click('#taskDateField .temporal-trigger');
      check(theme+' date picker is themed',await run(`document.querySelector('#theme-value-picker').matches(':popover-open') && document.querySelectorAll('.calendar-day').length===42`));
      await esc(api.main());await click('#taskTimeField .temporal-trigger');
      check(theme+' time picker is themed',await run(`document.querySelector('#theme-value-picker').matches(':popover-open')`));
      await esc(api.main());
      check(theme+' reminder style uses themed radio',await run(`getComputedStyle(document.querySelector('[name=taskPresentation]')).appearance==='none'`));
      await shot('form-controls-'+theme);await click('#cancelAdd');
    }
    await run(`window.doneAPI.updatePreferences({themeId:'bg1'})`);
    await run(`document.querySelector('#taskTitle').value='明天下午3点项目讨论，提前10分钟提醒'`);
    await click('#taskForm .add-button');
    check('quick capture opens from actual click',await run(`document.querySelector('#addTaskDialog').open`));
    check('Chinese capture date, clock and title',await run(`document.querySelector('#taskTime').value==='15:00' && document.querySelector('#captureTitle').value==='项目讨论'`));
    await shot('quick-add');
    const before=api.state().tasks.length;await click('#cancelAdd');check('cancel does not create and preserves original text',api.state().tasks.length===before&&await run(`document.querySelector('#taskTitle').value.includes('明天')`));
    await click('#taskForm .add-button');await click('#confirmAdd');
    await until(()=>api.state().tasks.length===before+1,'save actual task');
    check('confirmed input persisted once',api.state().tasks.at(-1).title==='项目讨论');
    await run(`document.querySelector('#taskTitle').value='今天阅读文献'`);await click('#taskForm .add-button');await click('#confirmAdd');
    await until(()=>api.state().tasks.length===before+2,'day task');
    check('day-only task has no manufactured execution time',!api.state().tasks.at(-1).dueAt&&Boolean(api.state().tasks.at(-1).planDate));
    await click('[data-view=reminders]');await shot('reminder-center');
    await click('[data-test-reminder=light]');
    await until(()=>api.reminder()?.isVisible(),'light visible');
    check('light first frame is rendered',await api.reminder().webContents.executeJavaScript(`document.querySelector('#reminderTitle').textContent==='提醒已经准备好啦'&&document.body.classList.contains('is-light')`));
    await shot('light',api.reminder());await click('#dismissButton',api.reminder());
    await until(()=>!api.reminder().isVisible(),'light dismissed');
    check('dismiss keeps reminder-center navigation',await run(`ui.currentView==='reminders'`));
    await click('[data-test-reminder=fullscreen]');await until(()=>api.reminder()?.isVisible(),'fullscreen reminder');await shot('fullscreen-reminder',api.reminder());await esc(api.reminder());
    await until(()=>!api.reminder().isVisible(),'fullscreen dismissed');
    const sampleId=api.state().tasks.find(t=>!t.completed).id;
    api.mutate(state=>{const task=state.tasks.find(t=>t.id===sampleId);task.deadlineDate='2099-01-01';task.reminderPresentation='fullscreen';});
    for(const theme of ['bg1','bg2','bg3','bg4','bg5','bg6']){
      await run(`window.doneAPI.updatePreferences({themeId:'${theme}'})`);
      const key='qa-snooze-'+theme;
      api.enqueue({key,type:'deadline',taskId:sampleId,title:'运行多组对照实验',subtitle:'距离截止还有 3 天',detail:'每天推进一点，不设具体执行时间',occurredAt:new Date().toISOString()});
      await until(()=>api.reminder()?.isVisible(),'themed reminder visible');
      await click('#snoozeMinutes',api.reminder());
      check(theme+' themed snooze popup',await api.reminder().webContents.executeJavaScript(`!document.querySelector('#theme-select-popup').hidden && document.querySelectorAll('.select-pop__option').length===5 && document.documentElement.dataset.themeId==='${theme}'`));
      await shot('snooze-'+theme,api.reminder());
      const region=await api.reminder().webContents.executeJavaScript(`(()=>{const r=document.querySelector('#theme-select-popup').getBoundingClientRect(),f=document.querySelector('footer').getBoundingClientRect();const x=Math.max(0,Math.floor(innerWidth/2-480)),y=Math.max(0,Math.floor(r.top-30));return {x,y,width:Math.min(960,innerWidth-x),height:Math.min(innerHeight-y,Math.ceil(f.bottom-y+30))}})()`);
      await shot('snooze-detail-'+theme,api.reminder(),region);
      await esc(api.reminder());
      check(theme+' Esc closes only selector',api.reminder().isVisible()&&api.state().pendingReminders.some(r=>r.key===key));
      await click('#snoozeMinutes',api.reminder());
      api.reminder().webContents.sendInputEvent({type:'keyDown',keyCode:'End'});
      api.reminder().webContents.sendInputEvent({type:'keyDown',keyCode:'Return'});
      await wait(80);
      check(theme+' keyboard selects 1 hour',await api.reminder().webContents.executeJavaScript(`document.querySelector('#snoozeMinutes').value==='60' && document.querySelector('#theme-select-popup').hidden`));
      await esc(api.reminder());await until(()=>!api.reminder().isVisible(),'themed reminder dismissed');
    }
    await click('[data-view=today]');
    for(const theme of ['bg1','bg2','bg3','bg4','bg5','bg6']){
      await run(`window.doneAPI.showMainWindow();window.doneAPI.updatePreferences({themeId:'${theme}'})`);
      await click('#focusStart');await until(()=>api.focus()?.isVisible(),'focus ready');
      check(theme+' first focus frame countdown',await api.focus().webContents.executeJavaScript(`document.body.innerText.includes('25:')||document.body.innerText.includes('24:')`));
      const session=api.state().focusTimer.sessionId;
      await esc(api.focus());await until(()=>api.widget()?.isVisible(),'widget after Esc');
      check(theme+' widget same session',api.state().focusTimer.sessionId===session&&api.state().presentation.focusWidget);
      await shot('widget-'+theme,api.widget());
      await click('#widgetPause',api.widget());check(theme+' paused',api.state().focusTimer.status==='paused');
      await click('#widgetPause',api.widget());check(theme+' continue stays compact',api.state().focusTimer.status==='running'&&!api.focus().isVisible());
      await run(`window.doneAPI.showFocusWindow()`);await until(()=>api.focus().isVisible(),'reopen full');
      check(theme+' returning preserves session',api.state().focusTimer.sessionId===session);
      await run(`window.doneAPI.updateFocusTimer({action:'stop',sessionId:'${session}'})`);await wait(120);
    }
    await run(`window.doneAPI.updatePreferences({themeId:'bg1'});window.doneAPI.showMainWindow()`);
    for(const width of [1280,1093,960]){
      api.main().setSize(width,800);await wait(200);await shot('today-'+width);
      check('no horizontal overflow at '+width,await run(`document.documentElement.scrollWidth<=innerWidth`));
      await run(`document.querySelector('#taskTitle').value='明天读书'`);await click('#taskForm .add-button');await shot('quick-'+width);check('modal bounded '+width,await run(`(()=>{const r=document.querySelector('#addTaskDialog').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight})()`));await esc(api.main());
    }
    api.main().setSize(1600,1000);await click('#settingsButton');await shot('settings');
    check('settings no auto registration in QA',api.state().quickShortcutAvailable===false);
    check('no renderer errors',errors.length===0);
    fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({passed:true,checks,errors},null,2));console.log(JSON.stringify({output,checks:checks.length,passed:true}));api.finish(0);
  }catch(error){await shot('failure').catch(()=>{});fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({passed:false,checks,errors,error:error.stack},null,2));console.error(JSON.stringify({output,error:error.stack}));api.finish(1);}
};
