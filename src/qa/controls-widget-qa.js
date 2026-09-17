const fs=require('node:fs');
const path=require('node:path');
const domain=require('../shared/domain');
const runtime=require('../shared/runtime');
module.exports=async({mainWindow,widgetWindow,getFocusWindow,getState,mutateState,outputDirectory,showMainWindow,hideFocusWindow,setPresenceStatus,clearPresenceStatus,showNextBigReminder,assertTransparentWidgetCorners})=>{
  const wait=(ms=220)=>new Promise(resolve=>setTimeout(resolve,ms));
  const js=async code=>{try{return await mainWindow.webContents.executeJavaScript(code);}catch(error){throw new Error(`053 renderer script: ${code}\n${error.message}`);}};
  const wjs=code=>widgetWindow.webContents.executeJavaScript(code);
  const check=(value,info)=>{if(!value)throw Error('0.5.3 QA: '+info);};
  const settled=async(predicate,label)=>{const limit=Date.now()+12000;while(Date.now()<limit){if(predicate())return;await wait(40);}check(false,label);};
  const shot=async(name,window=mainWindow)=>fs.writeFileSync(path.join(outputDirectory,name),(await window.capturePage()).toPNG());
  const close=()=>js('window.ThemedControls.close(); void 0');
  mutateState(draft=>{runtime.updateFocus(draft.focusTimer,{action:'stop'});draft.pendingReminders=[];draft.preferences.themeId='bg1';});
  showMainWindow();await wait();
  await js('setView("today"); document.querySelector("#taskTitle").value="整理实验记录"; document.querySelector("#taskForm").requestSubmit();');await wait();
  for(const themeId of domain.THEME_IDS){
    mutateState(draft=>{draft.preferences.themeId=themeId;});await wait();
    const arrow=await js(`['taskPriority','taskReminderMode'].map(id=>{const s=getComputedStyle(document.getElementById(id));return {repeat:s.backgroundRepeat,size:s.backgroundSize,image:s.backgroundImage};})`);
    check(arrow.every(item=>item.repeat==='no-repeat'&&item.size==='12px 7px'&&item.image.includes('svg')), 'one untiled arrow '+themeId);
    await shot(`053-form-${themeId}.png`);
    await js('window.ThemedControls.open(document.querySelector("#taskDate")); void 0');await wait();
    check(await js('document.querySelectorAll("#theme-value-picker .calendar-day").length===42'), 'calendar cells');
    await shot(`053-date-${themeId}.png`);
    await close();
    await js('window.ThemedControls.open(document.querySelector("#taskTime")); void 0');await wait();
    check(await js('document.querySelectorAll("[data-hour]").length===24 && document.querySelectorAll("[data-minute]").length===60'), '24h selector');
    await shot(`053-time-${themeId}.png`);
    await close();
  }
  const originalTime=await js('document.querySelector("#taskTime").value');
  await js('window.ThemedControls.open(document.querySelector("#taskTime")); document.querySelector(".picker-time-value").value="23:45"; document.querySelector(".picker-time-value").dispatchEvent(new Event("input")); document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true,cancelable:true}));');
  check(await js('document.querySelector("#addTaskDialog").open && document.querySelector("#theme-value-picker").hidden'), 'Esc cancels only picker');
  check(await js('document.querySelector("#taskTime").value')===originalTime,'Esc does not save draft');
  await js('window.ThemedControls.open(document.querySelector("#taskTime")); document.querySelector(".picker-time-value").value="24:00"; document.querySelector(".picker-confirm").click();');
  check(await js('!document.querySelector("#theme-value-picker").hidden && Boolean(document.querySelector(".picker-error").textContent)'), 'invalid time stays open');
  await js('document.querySelector(".picker-time-value").value="14:30"; document.querySelector(".picker-confirm").click();');
  check(await js('document.querySelector("#taskTime").value==="14:30" && addDateEdited'), 'time commits through input+change');
  await js('document.querySelector("#taskDate").min="2026-09-08"; document.querySelector("#taskDate").max="2026-09-10"; document.querySelector("#taskDate").value="2026-09-09"; window.ThemedControls.open(document.querySelector("#taskDate")); void 0');
  check(await js('document.querySelectorAll(".calendar-day:not(:disabled)").length===3'),'date range');
  await js(`document.querySelector('[data-date="2026-09-10"]').click()`);
  check(await js('document.querySelector("#taskDate").value==="2026-09-10"'),'date commit');
  await js('document.querySelector("#taskDate").removeAttribute("min");document.querySelector("#taskDate").removeAttribute("max"); window.ThemedControls.open(document.querySelector("#taskTime")); document.querySelector("#taskPriority").dispatchEvent(new MouseEvent("mousedown",{bubbles:true,cancelable:true})); void 0');
  check(await js('document.querySelector("#theme-value-picker").hidden && !document.querySelector(".select-pop").hidden'),'select closes time');
  await js('window.ThemedControls.open(document.querySelector("#taskDate")); void 0');
  check(await js('!document.querySelector("#theme-value-picker").hidden && document.querySelector(".select-pop").hidden'),'date closes select');
  await close();
  for(const zoom of [1,1.25,1.5]){
    mainWindow.webContents.setZoomFactor(zoom);await wait();
    for(const id of ['taskDate','taskTime']){
      await js(`window.ThemedControls.open(document.getElementById('${id}')); void 0`);await wait();
      check(await js('(()=>{const e=document.querySelector("#theme-value-picker"),r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&r.top>=0&&r.bottom<=innerHeight+1&&e.scrollWidth<=e.clientWidth+1;})()'),'picker viewport '+zoom+' '+id);
      await close();
    }
  }
  mainWindow.webContents.setZoomFactor(1);await js('document.querySelector("#cancelAdd").click();document.querySelector("#taskTitle").value="";');await wait();
  // Check numeric changes keep the old data/API contract.
  await js('document.querySelector("#focusDuration").value="180";document.querySelector("#focusDuration").closest(".theme-number").querySelectorAll(".number-step")[1].click();');
  check(await js('document.querySelector("#focusDuration").value==="180"'),'number max boundary');
  await js('document.querySelector("#focusDuration").value="25";document.querySelector("#focusDuration").dispatchEvent(new Event("change"));');await wait();
  const taskId=getState().tasks.find(task=>!task.completed).id;
  mutateState(draft=>{draft.preferences.widgetVisible=false;draft.preferences.themeId='bg1';});
  await js(`window.doneAPI.updateFocusTimer({action:'start',taskId:${JSON.stringify(taskId)},sessionId:ui.state.focusTimer.sessionId});`);await wait(500);
  const fullDeadline=Date.now()+10000;while(!getFocusWindow()?.isVisible()&&Date.now()<fullDeadline)await wait(50);
  const sessionId=getState().focusTimer.sessionId;
  await getFocusWindow().webContents.executeJavaScript('document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true,cancelable:true}));');await wait();
  await settled(()=>widgetWindow.isVisible()&&!getFocusWindow().isVisible(),'Esc frame preparation');
  check(widgetWindow.isVisible()&&!mainWindow.isVisible()&&!getFocusWindow().isVisible(),'Esc shows only widget');
  check(!getState().preferences.widgetVisible,'temporary widget does not enable preference');
  check(await wjs('document.querySelector(".widget-hero").offsetParent===null&&document.querySelector("#widgetTasks").offsetParent===null'),'task list covered');
  const geometries=[];
  for(const themeId of domain.THEME_IDS){
    mutateState(draft=>{draft.preferences.themeId=themeId;});await wait();
    const bounds=widgetWindow.getBounds();check(bounds.width===420&&bounds.height===590,'native widget dimensions');
    const metrics=await wjs(`(()=>{const selectors=['.widget-header','#widgetFocusStatus','#widgetFocusTask','#widgetCountdown','.focus-widget-track','.focus-widget-actions'];return selectors.map(s=>{const e=document.querySelector(s),r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,font:getComputedStyle(e).fontSize,fit:r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight};});})()`);
    check(metrics.every(m=>m.fit),'widget controls in bounds '+themeId);geometries.push(metrics);
    await shot(`053-focus-widget-${themeId}.png`,widgetWindow);
    assertTransparentWidgetCorners(await widgetWindow.capturePage(),themeId);
  }
  check(geometries.every(g=>JSON.stringify(g)===JSON.stringify(geometries[0])),'identical widget geometry across themes');
  await wjs('document.querySelector("#widgetPause").click()');await wait();
  check(getState().focusTimer.status==='paused','pause mini');
  await wjs('document.querySelector("#widgetPause").click()');await wait();
  check(widgetWindow.isVisible()&&!getFocusWindow().isVisible()&&getState().focusTimer.sessionId===sessionId,'resume keeps mini');
  await wjs('document.querySelector("#widgetExpand").click()');await wait();
  await settled(()=>getFocusWindow()?.isVisible()&&!widgetWindow.isVisible(),'full frame preparation');
  check(getFocusWindow().isVisible()&&!widgetWindow.isVisible(),'return full hides mini');
  hideFocusWindow('widget');await settled(()=>widgetWindow.isVisible(),'mini frame preparation');
  setPresenceStatus('有事暂离');await wait();check(!widgetWindow.isVisible(),'away hides mini');
  clearPresenceStatus();await settled(()=>widgetWindow.isVisible(),'return from away restores mini');
  mutateState(draft=>{draft.focusTimer.status='paused';draft.focusTimer.endsAt=null;draft.focusTimer.durationMinutes=180;draft.focusTimer.pausedRemainingSeconds=10800;draft.focusTimer.taskTitle='长标题布局验证';draft.tasks.find(t=>t.id===taskId).title='这是一个需要跨好几周推进并且名称非常非常长的复杂实验任务，用于检查布局不会被长标题挤坏';});await wait();
  check(await wjs('document.querySelector("#widgetCountdown").textContent==="180:00" && document.querySelector("#widgetCountdown").scrollWidth<=document.querySelector("#widgetCountdown").clientWidth'),'three-digit clock fits');
  await shot('053-long-task-widget.png',widgetWindow);
  for(const [mode,title] of [['shortBreak','短暂休息'],['longBreak','好好休息'],['focus','自由专注']]){
    mutateState(draft=>{draft.focusTimer.mode=mode;draft.focusTimer.taskId=null;draft.focusTimer.taskTitle='';});await wait();
    check(await wjs('document.querySelector("#widgetFocusTask").textContent')===title,'generic mode label '+mode);
  }
  await wjs('document.querySelector("#hideWidget").click()');await wait();check(!widgetWindow.isVisible()&&getState().focusTimer.status==='paused','closing widget keeps timer');
  mutateState(draft=>{runtime.updateFocus(draft.focusTimer,{action:'stop'});});await wait();check(!widgetWindow.isVisible(),'end restores originally hidden');
  mutateState(draft=>{draft.preferences.widgetVisible=true;draft.preferences.themeId='bg1';});showMainWindow();await settled(()=>widgetWindow.isVisible(),'ordinary widget restores');
  fs.writeFileSync(path.join(outputDirectory,'053-widget-geometry.json'),JSON.stringify(geometries,null,2));
  const calendarAlignment=[];
  for(const themeId of domain.THEME_IDS){
    mutateState(draft=>{draft.preferences.themeId=themeId;});
    for(const width of [1600,1280]){
      mainWindow.setSize(width,920);
      await js('setView("stage");document.querySelector("#stagePanel").scrollIntoView({block:"center"});');await wait();
      mainWindow.webContents.sendInputEvent({type:'mouseMove',x:0,y:0});
      const alignment=await js(`['stageStart','stageEnd'].map(id=>{
        const field=document.getElementById(id).closest('.theme-temporal'),button=field.querySelector('.temporal-trigger'),icon=button.querySelector('svg');
        const f=field.getBoundingClientRect(),b=button.getBoundingClientRect(),i=icon.getBoundingClientRect(),style=getComputedStyle(button);
        return {id,inset:f.right-i.right,centerDelta:Math.abs((i.left+i.right-b.left-b.right)/2),padding:style.paddingLeft,background:style.backgroundColor,expectedBackground:getComputedStyle(document.querySelector('#autoSchedule')).backgroundColor};
      })`);
      check(alignment.every(item=>item.inset>=12&&item.centerDelta<.5&&item.padding==='0px'),'stage calendar alignment '+themeId+' '+width);
      check(alignment.every(item=>item.background===item.expectedBackground&&item.background!=='rgba(0, 0, 0, 0)'),'calendar keeps theme button fill '+themeId+' '+width);
      calendarAlignment.push({themeId,width,alignment});
      await js('document.querySelector("#stageStart").closest(".theme-temporal").querySelector(".temporal-trigger").click();');
      check(await js('!document.querySelector("#theme-value-picker").hidden'),'calendar trigger still opens picker');
      await close();
      if(width===1600)await shot(`054-calendar-aligned-${themeId}.png`);
      if(width===1600&&themeId==='bg1'){
        const clip=await js('(()=>{const r=document.querySelector("#stagePanel").getBoundingClientRect();return {x:Math.ceil(r.x),y:Math.ceil(r.y),width:Math.floor(r.width),height:Math.floor(r.height)};})()');
        fs.writeFileSync(path.join(outputDirectory,'054-stage-calendar-fixed.png'),(await mainWindow.capturePage(clip)).toPNG());
      }
    }
  }
  mainWindow.setSize(1600,920);
  fs.writeFileSync(path.join(outputDirectory,'054-calendar-alignment.json'),JSON.stringify(calendarAlignment,null,2));
};
