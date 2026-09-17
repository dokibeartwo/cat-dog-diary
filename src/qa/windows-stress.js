const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const domain=require('../shared/domain');
module.exports=async api=>{
  const run=Number((process.argv.find(arg=>arg.startsWith('--qa-run='))||'--qa-run=1').split('=')[1]);
  const output=path.join(os.tmpdir(),'cat-dog-diary-054-stress');fs.mkdirSync(output,{recursive:true});
  const report={run,coldStart:true,cycles:[],firstFrames:[],confirmations:[],faults:[]};
  const frames=[];let failure=null;
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const until=async(fn,label,limit=12000)=>{const end=Date.now()+limit;while(Date.now()<end){if(failure)throw failure;try{if(await fn()){await Promise.all([...frames]);if(failure)throw failure;return;}}catch(error){if(failure||Date.now()+100>=end)throw error;}await wait(40);}throw Error('054 timeout: '+label);};
  const check=(value,label)=>{if(!value)throw Error('054 assertion: '+label);};
  const js=(win,code)=>win.webContents.executeJavaScript(code);
  const click=async(win,selector)=>{
    const pos=await js(win,`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing control');e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()`);
    win.webContents.sendInputEvent({type:'mouseMove',...pos});
    win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...pos});
    win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...pos});
    await wait(80);
  };
  const escape=async win=>{win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});await wait(70);};
  const observe=(role,win)=>{
    win.on('show',()=>{
      const promise=(async()=>{
        const image=await win.capturePage();
        const sample=image.resize({width:160}).toBitmap();const colors=new Set();let opaque=0;
        for(let i=0;i<sample.length;i+=4){if(sample[i+3]>20){opaque++;colors.add(`${sample[i]>>4},${sample[i+1]>>4},${sample[i+2]>>4}`);}}
        if(!(opaque>300&&colors.size>12))fs.writeFileSync(path.join(output,`failed-first-${run}-${role}.png`),image.toPNG());
        check(opaque>300&&colors.size>12,'nonblank first visible '+role+JSON.stringify({opaque,colors:colors.size,size:image.getSize()}));
        const content=await js(win,role==='focus'?`({text:document.querySelector('#countdown').textContent,theme:document.documentElement.dataset.themeId})`:`({text:document.querySelector('#focusWidget').hidden?document.querySelector('#dateLabel').textContent:document.querySelector('#widgetCountdown').textContent,theme:document.documentElement.dataset.themeId})`);
        check(Boolean(content.text)&&domain.THEME_IDS.includes(content.theme),'first frame business content '+role);
        report.firstFrames.push({role,colors:colors.size,...content});
        if(report.firstFrames.filter(item=>item.role===role).length===1)fs.writeFileSync(path.join(output,`cold-${run}-${role}.png`),image.toPNG());
      })().catch(error=>{failure=error;});frames.push(promise);
    });
  };
  if(api.widget())observe('widget',api.widget());
  const create=api.coordinator.deps.create;api.coordinator.deps.create=role=>{const win=create(role);observe(role,win);return win;};
  await until(()=>js(api.main(),`Boolean(window.doneAPI&&ui.state.tasks?.length)`),'main initialize');
  if(process.argv.includes('--autostart'))check(!api.main().isVisible(),'login launch keeps main hidden');
  api.showMainWindow();
  await click(api.main(),'#widgetSwitch');
  if(!api.getState().presentation.widgetRequested)await click(api.main(),'#widgetSwitch');
  await until(()=>api.getState().presentation.widgetVisible,'normal widget cold');
  const themes=run===1?domain.THEME_IDS:[domain.THEME_IDS[(run-1)%6]];
  for(const theme of themes){
    api.mutateState(draft=>{draft.preferences.themeId=theme;});
    await click(api.main(),'#focusStart');
    await until(()=>api.focus()?.isVisible(),'cold focus');
    const session=api.getState().focusTimer.sessionId;
    for(let cycle=0;cycle<(run===1?10:1);cycle++){
      await escape(api.focus());await until(()=>api.getState().presentation.widgetVisible&&!api.focus()?.isVisible(),'Esc to mini');
      check(!api.main().isVisible(),'Esc hides main');
      if(cycle===0){await click(api.widget(),'#widgetPause');await until(()=>api.getState().focusTimer.status==='paused','mini pause');await click(api.widget(),'#widgetPause');await until(()=>api.getState().focusTimer.status==='running','mini resume');}
      await click(api.widget(),'#widgetExpand');await until(()=>api.focus()?.isVisible()&&!api.getState().presentation.widgetVisible,'mini to full');
      check(api.getState().focusTimer.sessionId===session,'session unchanged');report.cycles.push({theme,cycle});
    }
    await click(api.focus(),'#stopButton');await until(()=>js(api.focus(),`document.querySelector('#themeConfirm').open`),'focus confirm');
    await escape(api.focus());check(api.focus().isVisible(),'cancel confirm does not leave full');
    await click(api.focus(),'#stopButton');await until(()=>js(api.focus(),`document.querySelector('#themeConfirm').open`),'focus confirm reopened');
    fs.writeFileSync(path.join(output,`confirm-full-${theme}.png`),(await api.focus().capturePage()).toPNG());
    await click(api.focus(),'#themeConfirmAccept');await until(()=>api.getState().focusTimer.status==='idle','stop focus');
    api.showMainWindow();
    // Every theme renders the same shared confirmation with readable sizing.
    await click(api.main(),'#focusStart');await until(()=>api.focus()?.isVisible(),'focus again');await click(api.focus(),'#backButton');
    await click(api.main(),'#focusReset');await until(()=>js(api.main(),`document.querySelector('#themeConfirm').open`),'main reset confirm');
    const sizes=await js(api.main(),`(()=>{const d=document.querySelector('#themeConfirm');return {p:parseFloat(getComputedStyle(d.querySelector('p')).fontSize),button:parseFloat(getComputedStyle(d.querySelector('button')).fontSize),h:d.querySelector('button').getBoundingClientRect().height};})()`);
    check(sizes.p>=16&&sizes.button>=18&&sizes.h>=44,'dialog sizes');
    fs.writeFileSync(path.join(output,`confirm-main-${theme}.png`),(await api.main().capturePage()).toPNG());
    await click(api.main(),'#themeConfirmAccept');await until(()=>api.getState().focusTimer.status==='idle','reset accepted');report.confirmations.push({theme,kind:'reset-and-stop'});
  }
  if(run===1){
    // Real renderer crash and navigation failure; never touch production data.
    await click(api.main(),'#focusStart');await until(()=>api.focus()?.isVisible(),'before crash');
    const session=api.getState().focusTimer.sessionId;const old=api.focus();
    old.webContents.forcefullyCrashRenderer();
    await until(()=>api.focus()&&api.focus()!==old&&api.focus().isVisible(),'renderer crash recovery');
    check(api.getState().focusTimer.sessionId===session,'crash preserves timer');report.faults.push('real-renderer-crash-recovered');
    api.focus().webContents.forcefullyCrashRenderer();
    await until(()=>api.getState().presentation.error?.role==='focus','bounded second failure');
    check(api.main().isVisible(),'error fallback main');
    await click(api.main(),'#retryWindow');await until(()=>api.focus()?.isVisible(),'explicit retry');report.faults.push('second-failure-bounded-and-retry');
    await click(api.focus(),'#backButton');await click(api.main(),'#widgetSwitch');await until(()=>api.widget()?.isVisible(),'widget before bad load');
    const prior=api.widget();prior.loadURL('file:///C:/catdog-qa-intentionally-missing-page.html').catch(()=>{});
    await until(()=>api.widget()&&api.widget()!==prior&&api.widget().isVisible(),'failed navigation recovery');report.faults.push('real-navigation-failure-recovered');
    await click(api.main(),'#focusReset');await until(()=>js(api.main(),`document.querySelector('#themeConfirm').open`),'reset after failure');await click(api.main(),'#themeConfirmAccept');
    await until(()=>api.getState().focusTimer.status==='idle','idle');
    // Cover all remaining confirmation entry points using ordinary input events.
    const taskId=api.getState().tasks.find(t=>!t.completed).id;
    api.mutateState(draft=>{draft.tasks.find(t=>t.id===taskId).steps=[{id:'qa-step',title:'确认框测试步骤',completed:false}];});
    await js(api.main(),`setView('stage');ui.openSteps.add(${JSON.stringify(taskId)});render();void 0;`);
    const selector=`[data-id="${taskId}"]`;
    for(const suffix of ['[data-action="toggle"]','[data-action="step-delete"]','[data-action="delete"]']){
      await click(api.main(),selector+' '+suffix);await until(()=>js(api.main(),`document.querySelector('#themeConfirm').open`),'task confirm '+suffix);await escape(api.main());report.confirmations.push({kind:suffix});
    }
    await until(()=>api.widget()?.isVisible(),'normal widget available');
    await click(api.widget(),selector+' .widget-check');await until(()=>js(api.widget(),`document.querySelector('#themeConfirm').open`),'widget completion confirm');await escape(api.widget());report.confirmations.push({kind:'widget-step-complete'});
    await click(api.main(),selector+' [data-action="start-focus"]');await until(()=>api.focus()?.isVisible(),'task focus');await click(api.focus(),'#backButton');
    const other=api.getState().tasks.find(t=>!t.completed&&t.id!==taskId).id;
    await click(api.main(),`[data-id="${other}"] [data-action="start-focus"]`);await until(()=>js(api.main(),`document.querySelector('#themeConfirm').open`),'switch task confirm');await escape(api.main());report.confirmations.push({kind:'switch-task'});
    await click(api.main(),'#focusReset');await until(()=>js(api.main(),`document.querySelector('#themeConfirm').open`),'confirm across completion');
    const rounds=api.getState().focusTimer.sessionsCompleted;
    api.mutateState(draft=>{draft.focusTimer.endsAt=new Date(Date.now()-100).toISOString();});
    await until(()=>api.getState().focusTimer.status==='idle','real timer completes during confirmation');
    await js(api.main(),`document.querySelector('#themeConfirmAccept').click();void 0;`);await wait(80);
    check(api.getState().focusTimer.sessionsCompleted===rounds+1,'no duplicate settlement after stale confirmation');
    report.confirmations.push({kind:'timer-completes-during-confirmation'});
  }
  await Promise.all(frames);if(failure)throw failure;
  check(report.firstFrames.some(x=>x.role==='focus')&&report.firstFrames.some(x=>x.role==='widget'),'cold first frames recorded');
  fs.writeFileSync(path.join(output,`run-${run}.json`),JSON.stringify(report,null,2));
  console.log(`STABILITY PASS run=${run} cycles=${report.cycles.length} firstFrames=${report.firstFrames.length} faults=${report.faults.length}`);
  api.finish();
};
