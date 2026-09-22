'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
module.exports=async api=>{
  const output=path.join(process.cwd(),'qa-reports','release-smoke-'+Date.now());fs.mkdirSync(output,{recursive:true});
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  async function until(fn,label){const end=Date.now()+16000;while(Date.now()<end){if(await fn())return;await sleep(80);}throw Error('Timeout: '+label);}
  const js=code=>api.main().webContents.executeJavaScript(code);
  const record={version:api.version,exe:process.execPath,autoStart:api.autoStart,clean:api.clean,passed:false};
  try{
    await until(()=>js(`Boolean(window.doneAPI&&ui.state.appVersion&&window.Workbench)`),'main business state');
    assert.equal(await js(`ui.state.appVersion`),api.version);
    if(api.autoStart)assert.equal(api.main().isVisible(),false);
    else await until(()=>api.main().isVisible(),'manual launch visible');
    await until(()=>api.widget()?.isVisible(),'widget cold start');
    const bounds=api.widget().getBounds();assert.equal(bounds.width,420);assert.equal(bounds.height,590);
    const image=await api.widget().webContents.capturePage();
    const pixels=image.resize({width:84}).toBitmap();const colors=new Set();
    for(let n=0;n<pixels.length;n+=4)if(pixels[n+3]>0)colors.add(`${pixels[n]>>4}:${pixels[n+1]>>4}:${pixels[n+2]>>4}`);
    assert.ok(colors.size>12,'widget must have rendered real content');
    fs.writeFileSync(path.join(output,'widget.png'),image.toPNG());
    if(api.clean){const state=api.state();assert.equal(state.tasks.length,0);assert.ok(state.habits.every(h=>!h.active));assert.equal(state.quickShortcutAvailable,false);
      const welcome=await js(`(()=>{const b=document.querySelector('#finishWelcome');if(!b)return null;const s=getComputedStyle(b);return {radius:parseFloat(s.borderRadius),height:b.getBoundingClientRect().height}})()`);
      assert.ok(welcome&&welcome.radius>=12&&welcome.height>=44,'first-run action uses the same themed button sizing');
    }
    if(api.main().isVisible())fs.writeFileSync(path.join(output,'main.png'),(await api.main().webContents.capturePage()).toPNG());
    record.passed=true;record.widgetBounds=bounds;record.colors=colors.size;
  }catch(error){record.error=error.stack;}
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(record,null,2));console.log(JSON.stringify({output,...record}));api.finish(record.passed?0:1);
};
