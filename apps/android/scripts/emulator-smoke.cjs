// Runs ONLY against a disposable CI emulator with a fresh app installation.
const {execFileSync}=require('node:child_process');
const fs=require('node:fs');
const path=require('node:path');
const out=path.join(__dirname,'..','smoke-output');fs.mkdirSync(out,{recursive:true});
const adb=(...args)=>execFileSync('adb',args,{encoding:'utf8',timeout:30000});
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function xml(){adb('shell','uiautomator','dump','/sdcard/catdog-ui.xml');return adb('shell','cat','/sdcard/catdog-ui.xml');}
async function tap(label){
  const tree=await xml(),nodes=tree.match(/<node\b[^>]*>/g)||[];
  const node=nodes.find(n=>(n.includes(`text="${label}"`)||n.includes(`content-desc="${label}"`))&&n.includes('enabled="true"'));
  if(!node)throw Error(`UI control missing: ${label}`);
  const bounds=node.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
  if(!bounds)throw Error('Control bounds missing');
  adb('shell','input','tap',String(Math.floor((+bounds[1]+ +bounds[3])/2)),String(Math.floor((+bounds[2]+ +bounds[4])/2)));await delay(700);
}
function screenshot(name){fs.writeFileSync(path.join(out,name+'.png'),execFileSync('adb',['exec-out','screencap','-p'],{timeout:30000}));}
(async()=>{
  try{
    adb('logcat','-c');adb('shell','am','start','-W','-n','com.dokibeartwo.catdogdiary/.MainActivity');await delay(7000);
    if(!(await xml()).includes('猫狗日记'))throw Error('App did not render its brand');screenshot('01-today');
    await tap('＋ 记下一件事');if(!(await xml()).includes('安排下一步'))throw Error('Task editor did not open');screenshot('02-task-editor');
    adb('shell','input','keyevent','4');await delay(600);
    await tap('专注');await tap('开始这一轮');screenshot('03-focus-running');
    await tap('暂停');if(!(await xml()).includes('已暂停'))throw Error('Timer did not pause');screenshot('04-focus-paused');
    await tap('设置');await tap('晴空蜜桃');screenshot('05-theme-settings');
    await tap('今天');screenshot('06-theme-today');
    const log=adb('logcat','-d');fs.writeFileSync(path.join(out,'device-log.txt'),log);
    if(/FATAL EXCEPTION|ReactNativeJS:.*(?:Error|TypeError|ReferenceError)/.test(log))throw Error('Native or JS runtime error; see device-log.txt');
    fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:true,api:35,checks:['cold-start','task-editor','focus-start','focus-pause','theme-switch']},null,2));
    console.log('Installed APK smoke passed; screenshots captured. This is not physical-device notification validation.');
  }catch(error){screenshot('failure');fs.writeFileSync(path.join(out,'failure-ui.xml'),await xml());fs.writeFileSync(path.join(out,'device-log.txt'),adb('logcat','-d'));throw error;}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
