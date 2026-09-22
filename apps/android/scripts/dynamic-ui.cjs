// Instrumentation lives only in the disposable emulator. It does not patch
// the app, pause its clock, suppress its dialogs, or read its private database.
const {execFileSync,spawn}=require('node:child_process');
const fs=require('node:fs'),path=require('node:path');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function startDynamicUi(output){
  const adb=(...args)=>execFileSync('adb',args,{encoding:'utf8',timeout:30000});
  const apks=path.resolve(__dirname,'../../../scripts/android-qa/node_modules/appium-uiautomator2-server/apks');
  for(const name of fs.readdirSync(apks).filter(n=>n.endsWith('.apk')))adb('install','-r',path.join(apks,name));
  adb('forward','tcp:6790','tcp:6790');
  const fd=fs.openSync(path.join(output,'ui-instrumentation.log'),'w');
  const child=spawn('adb',['shell','am','instrument','-w','io.appium.uiautomator2.server.test/androidx.test.runner.AndroidJUnitRunner'],{stdio:['ignore',fd,fd]});
  fs.closeSync(fd);let session;
  const request=async(route,method='GET',body)=>{
    const response=await fetch(`http://127.0.0.1:6790${route}`,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)});
    const result=await response.json();
    if(!response.ok||result.value?.error)throw Error(`UI instrumentation: ${result.value?.message||response.status}`);
    return result;
  };
  try{
    const end=Date.now()+45000;let ready=false;
    while(Date.now()<end){try{await request('/status');ready=true;break;}catch{await delay(750);}}
    if(!ready)throw Error('UI instrumentation failed to start; see ui-instrumentation.log');
    const created=await request('/session','POST',{capabilities:{alwaysMatch:{platformName:'Android'},firstMatch:[{}]}});
    session=created.value?.sessionId||created.sessionId;
    if(!session)throw Error('UI instrumentation did not create a session');
    await request(`/session/${session}/appium/settings`,'POST',{settings:{waitForIdleTimeout:0,waitForSelectorTimeout:0}});
    return {
      async source(){const result=await request(`/session/${session}/source`);if(typeof result.value!=='string'||!result.value.includes('<hierarchy'))throw Error('Fresh UI hierarchy missing');return result.value;},
      async close(){try{await request(`/session/${session}`,'DELETE');}catch{}child.kill();try{adb('forward','--remove','tcp:6790');}catch{}}
    };
  }catch(error){child.kill();throw error;}
}
module.exports={startDynamicUi};
