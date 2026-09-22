// Runs ONLY against a disposable CI emulator with a fresh app installation.
const {execFileSync}=require('node:child_process');
const fs=require('node:fs');
const path=require('node:path');
const {findNode,keyboardShown,launcherDialog}=require('./ui-tree.cjs');
const {startDynamicUi}=require('./dynamic-ui.cjs');
const {captureFile,recordFailure}=require('./smoke-diagnostics.cjs');
const out=path.join(__dirname,'..','smoke-output');fs.mkdirSync(out,{recursive:true});
const packageName='com.dokibeartwo.catdogdiary',warnings=[],checks=[];
const adb=(...args)=>execFileSync('adb',args,{encoding:'utf8',timeout:30000,maxBuffer:16*1024*1024});
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let launcherDismissals=0,dynamicUi;
async function xml(){
  for(;;){
    const tree=await dynamicUi.source();
    const close=launcherDialog(tree);if(!close)return tree;
    // The fresh API 35 system launcher can ANR after APK installation, even
    // after our first frame. Close only that named system component; never
    // dismiss a CatDog app ANR, suppress system dialogs, or waive an assertion.
    if(launcherDismissals>=2)throw Error('Disposable emulator launcher remains unhealthy');
    screenshot(`system-launcher-anr-${++launcherDismissals}`);
    warnings.push('Emulator Quickstep ANR: closed the system launcher, not the application');
    await tapNode(close);await delay(1500);
  }
}
async function tapNode(node){
  const bounds=node.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
  if(!bounds)throw Error('Control bounds missing');
  adb('shell','input','tap',String(Math.floor((+bounds[1]+ +bounds[3])/2)),String(Math.floor((+bounds[2]+ +bounds[4])/2)));await delay(700);
}
async function tap(label,scroll=false,options={}){
  for(let attempt=0;attempt<(scroll?10:1);attempt++){
    const tree=await xml();
    if(!tree.includes(`package="${packageName}"`))throw Error(`App is not foreground while looking for: ${label}`);
    const node=findNode(tree,label,options);if(node){await tapNode(node);return;}
    if(scroll){adb('shell','input','swipe','540','1700','540','650','350');await delay(300);}
  }
  throw Error(`UI control missing: ${label}`);
}
async function type(label,value){
  await tap(label,true,{editable:true});
  const focused=findNode(await xml(),label,{editable:true});
  if(!focused?.includes('focused="true"'))throw Error(`Input did not receive focus: ${label}`);
  adb('shell','input','text',value.replaceAll(' ','%s'));await delay(300);
  const entered=findNode(await xml(),label,{editable:true});
  if(!entered?.includes(`text="${value}"`))throw Error(`Input value did not persist: ${label}`);
  if(label==='间隔（分钟）'){checks.push('numeric-input-visible-above-keyboard');screenshot('08-numeric-keyboard');}
  // Back without an actual soft keyboard closes the editor (or even the app).
  if(keyboardShown(adb('shell','dumpsys','input_method')))adb('shell','input','keyevent','4');
  await delay(300);
}
async function check(label,content){if(!(await xml()).includes(content))throw Error(label);checks.push(label);}
async function until(label,predicate,timeout=15000){
  const end=Date.now()+timeout;
  while(Date.now()<end){if(await predicate()){checks.push(label);return;}await delay(1500);}
  throw Error(label);
}
async function launch(){
  adb('shell','am','start','-W','-n',`${packageName}/.MainActivity`);
  const end=Date.now()+45000;
  while(Date.now()<end){
    const tree=await xml();
    if(tree.includes(`package="${packageName}"`)&&tree.includes('猫狗日记')){checks.push('app-cold-start');return;}
    await delay(1000);
  }
  throw Error('App did not render its brand within 45 seconds');
}
function screenshot(name){captureFile(path.join(out,name+'.png'),'adb',['exec-out','screencap','-p']);}
(async()=>{
  try{
    if(adb('shell','getprop','ro.kernel.qemu').trim()!=='1')throw Error('Smoke testing is allowed only on an isolated emulator');
    dynamicUi=await startDynamicUi(out);
    adb('logcat','-c');await launch();screenshot('01-today');
    adb('shell','svc','wifi','disable');adb('shell','svc','data','disable');
    await tap('＋ 记下一件事');await check('task-editor-open','安排下一步');screenshot('02-task-editor');
    await type('这件事叫什么','Offline QA task');await tap('稍后分配',true);await tap('确认加入',true);
    await tap('清单');await check('offline-task-created','Offline QA task');screenshot('03-task-saved');
    adb('shell','am','force-stop',packageName);await launch();await tap('清单');await check('offline-task-survives-process-restart','Offline QA task');
    await tap('专注');await tap('开始这一轮',true);await check('focus-start','正在进行');screenshot('04-focus-running');
    await tap('暂停',true);await check('focus-pause','已暂停');screenshot('05-focus-paused');
    adb('shell','am','force-stop',packageName);await launch();await tap('专注');await check('paused-focus-survives-restart','已暂停');
    for(const [index,name]of ['星糖梦境','晴空蜜桃','莓果心动','奶杏布丁','青柠糖球','蜜桃心语'].entries()){
      await tap('设置');await tap(name,true);screenshot(`theme-${index+1}-settings`);
      await tap('今天');await check(`theme-${index+1}-usable`,'今天，专心做好一件事。');screenshot(`theme-${index+1}-today`);
    }
    // Exercise real Android permission dialogs and elapsed time. Never inject
    // notification records, alter the device clock, or grant permissions via adb.
    await tap('专注');await tap('结束本轮',true);await tap('确认',true);
    await check('focus-finish-keeps-partial-history','提前结束');
    await tap('设置');await tap('星糖梦境');await tap('允许醒目通知',true);
    let grant;
    await until('notification-permission-dialog',async()=>{
      grant=findNode(await xml(),null,{resourceId:'com.android.permissioncontroller:id/permission_allow_button',packageName:'com.android.permissioncontroller'});
      return !!grant;
    });
    screenshot('06-notification-permission');await tapNode(grant);
    await until('notification-permission-granted',async()=>(await xml()).includes('通知权限：已允许'));
    const exactAllowed=()=>/SCHEDULE_EXACT_ALARM:\s*allow\b/.test(adb('shell','appops','get',packageName,'SCHEDULE_EXACT_ALARM'));
    if(!exactAllowed()){
      await tap('闹钟和提醒权限',true);
      const setting=findNode(await xml(),'Allow setting alarms and reminders');
      if(!setting?.includes('package="com.android.settings"'))throw Error('Android exact-alarm permission screen missing');
      await tapNode(setting);await until('exact-alarm-user-setting',async()=>exactAllowed());
      screenshot('07-exact-alarm-permission');adb('shell','input','keyevent','4');await delay(700);
    }
    await tap('坚持');await tap('＋ 添加每日坚持');
    await type('每天想坚持的小事','Offline reminder QA');await type('间隔（分钟）','1');
    await tap('保存每日坚持',true);await check('offline-habit-created','Offline reminder QA');
    await until('foreground-reminder-delivered',async()=>{const tree=await xml();return tree.includes('Offline reminder QA')&&!!findNode(tree,'我知道了');},90000);
    const firstReminder=await xml();fs.writeFileSync(path.join(out,'foreground-reminder-ui.xml'),firstReminder);screenshot('08-foreground-reminder');
    // Leaving it unhandled beyond the next interval must not create another
    // screen or replace its displayed occurrence time.
    const occurrence=(firstReminder.match(/text="([^"]*\d{1,2}:\d{2}:\d{2}[^"]*)"/)||[])[1];
    if(!occurrence)throw Error('Reminder occurrence time is not visible');
    const keepUntil=Date.now()+65000;
    while(Date.now()<keepUntil){await delay(10000);if(!(await xml()).includes(`text="${occurrence}"`))throw Error('Unacknowledged reminder occurrence changed');}
    const unchanged=await xml();
    if(!unchanged.includes(`text="${occurrence}"`)||!findNode(unchanged,'我知道了'))throw Error('Unacknowledged reminder was replaced');
    checks.push('unhandled-interval-keeps-same-occurrence');
    await tap('我知道了');await delay(5000);
    if(findNode(await xml(),'我知道了'))throw Error('Acknowledged reminder immediately reappeared');
    checks.push('acknowledgement-restarts-interval');
    adb('shell','input','keyevent','3');await delay(1000);
    adb('shell','cmd','statusbar','expand-notifications');
    await until('background-system-notification-delivered',async()=>!!findNode(await xml(),'Offline reminder QA'),90000);
    screenshot('09-background-notification');
    fs.writeFileSync(path.join(out,'notification-diagnostics.txt'),adb('shell','dumpsys','notification','--noredact'));
    adb('shell','cmd','statusbar','collapse');await launch();
    await until('return-from-background-opens-reminder',async()=>!!findNode(await xml(),'我知道了'));
    await tap('我知道了');await tap('坚持');await tap('暂停提醒',true);
    await check('habit-paused','已暂停');
    const log=adb('logcat','-d');fs.writeFileSync(path.join(out,'device-log.txt'),log);
    if(/FATAL EXCEPTION[^]*?Process: com\.dokibeartwo\.catdogdiary|ReactNativeJS:.*(?:Error|TypeError|ReferenceError)/.test(log))throw Error('App native or JS runtime error; see device-log.txt');
    fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:true,api:35,checks,warnings},null,2));
    console.log('Installed APK smoke passed; screenshots captured. This is not physical-device notification validation.');
  }catch(error){
    await recordFailure(out,{error,checks,warnings},{
      screenshot:()=>screenshot('failure'),
      async hierarchy(){
        const tree=dynamicUi?await dynamicUi.source():'UI instrumentation unavailable';
        fs.writeFileSync(path.join(out,'failure-ui.xml'),tree);
        console.error('Visible diagnostic labels:',(tree.match(/(?:text|resource-id)="[^"]+"/g)||[]).join('\n').slice(-5000));
      },
      log:()=>captureFile(path.join(out,'device-log.txt'),'adb',['logcat','-d'])
    });
    throw error;
  }
  finally{await dynamicUi?.close();}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
