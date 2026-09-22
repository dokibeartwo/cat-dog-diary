// Runs ONLY against a disposable CI emulator with a fresh app installation.
const {execFileSync}=require('node:child_process');
const fs=require('node:fs');
const path=require('node:path');
const out=path.join(__dirname,'..','smoke-output');fs.mkdirSync(out,{recursive:true});
const packageName='com.dokibeartwo.catdogdiary',warnings=[],checks=[];
const adb=(...args)=>execFileSync('adb',args,{encoding:'utf8',timeout:30000});
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function xml(){adb('shell','uiautomator','dump','/sdcard/catdog-ui.xml');return adb('shell','cat','/sdcard/catdog-ui.xml');}
function findNode(tree,label){return (tree.match(/<node\b[^>]*>/g)||[]).find(n=>(n.includes(`text="${label}"`)||n.includes(`content-desc="${label}"`))&&n.includes('enabled="true"'));}
async function tapNode(node){
  const bounds=node.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
  if(!bounds)throw Error('Control bounds missing');
  adb('shell','input','tap',String(Math.floor((+bounds[1]+ +bounds[3])/2)),String(Math.floor((+bounds[2]+ +bounds[4])/2)));await delay(700);
}
async function tap(label,scroll=false){
  for(let attempt=0;attempt<(scroll?10:1);attempt++){
    const node=findNode(await xml(),label);if(node){await tapNode(node);return;}
    if(scroll){adb('shell','input','swipe','540','1700','540','650','350');await delay(300);}
  }
  throw Error(`UI control missing: ${label}`);
}
async function type(label,value){await tap(label,true);adb('shell','input','text',value.replaceAll(' ','%s'));adb('shell','input','keyevent','4');await delay(300);}
async function check(label,content){if(!(await xml()).includes(content))throw Error(label);checks.push(label);}
async function launch(){
  adb('shell','am','start','-W','-n',`${packageName}/.MainActivity`);
  const end=Date.now()+45000;let handledLauncher=false;
  while(Date.now()<end){
    const tree=await xml();
    // API 35's freshly booted launcher may ANR while scanning installed apps.
    // Dismiss ONLY this identified system-launcher dialog, never an app ANR.
    if(tree.includes("Quickstep isn't responding")&&!handledLauncher){
      screenshot('system-launcher-anr');warnings.push('Fresh emulator Quickstep ANR; chose Wait once');
      const wait=findNode(tree,'Wait');if(wait)await tapNode(wait);handledLauncher=true;continue;
    }
    if(tree.includes(`package="${packageName}"`)&&tree.includes('猫狗日记')){checks.push('app-cold-start');return;}
    await delay(1000);
  }
  throw Error('App did not render its brand within 45 seconds');
}
function screenshot(name){fs.writeFileSync(path.join(out,name+'.png'),execFileSync('adb',['exec-out','screencap','-p'],{timeout:30000}));}
(async()=>{
  try{
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
    const log=adb('logcat','-d');fs.writeFileSync(path.join(out,'device-log.txt'),log);
    if(/FATAL EXCEPTION[^]*?Process: com\.dokibeartwo\.catdogdiary|ReactNativeJS:.*(?:Error|TypeError|ReferenceError)/.test(log))throw Error('App native or JS runtime error; see device-log.txt');
    fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:true,api:35,checks,warnings},null,2));
    console.log('Installed APK smoke passed; screenshots captured. This is not physical-device notification validation.');
  }catch(error){screenshot('failure');fs.writeFileSync(path.join(out,'failure-ui.xml'),await xml());fs.writeFileSync(path.join(out,'device-log.txt'),adb('logcat','-d'));fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:false,checks,warnings,error:error.message},null,2));throw error;}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
