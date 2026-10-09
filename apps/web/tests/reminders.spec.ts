import {test,expect,Page} from '@playwright/test';

async function mockFeedback(page:Page,mode='ok'){
 await page.addInitScript((mode)=>{
  const metrics={tones:0,resumes:0,vibrations:[] as any[],contexts:[] as any[]};(window as any).feedbackMetrics=metrics;
  class AudioMock {
   state='suspended';currentTime=0;destination={};onstatechange:()=>void=()=>{};
   constructor(){metrics.contexts.push(this);}
   finishResume:()=>void=()=>{};
   resume(){metrics.resumes++;if(mode==='reject')return Promise.reject(Error('blocked'));if(mode==='pending')return new Promise<void>(resolve=>{this.finishResume=()=>{this.state='running';this.onstatechange();resolve();};});this.state='running';this.onstatechange();return Promise.resolve();}
   createGain(){return {gain:{setValueAtTime(){},linearRampToValueAtTime(){}},connect(){},disconnect(){}};}
   createOscillator(){return {frequency:{setValueAtTime(){}},connect(){},disconnect(){},start(){metrics.tones++;},stop(){}};}
  }
  Object.defineProperty(window,'AudioContext',{value:AudioMock,configurable:true});
  Object.defineProperty(navigator,'vibrate',{value:mode==='unsupported'?undefined:(p:any)=>{metrics.vibrations.push(p);return mode!=='vibrate-refused';},configurable:true});
 },mode);
}
async function openSettings(page:Page){
 await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'设置',exact:true}).click();
 await page.getByRole('button',{name:/手机提醒设置/}).click();
 await expect(page.getByRole('dialog',{name:'手机提醒设置'})).toBeVisible();
}
async function patchPreview(page:Page,patch:any){
 await page.evaluate(async(patch)=>{
  await new Promise<void>((resolve,reject)=>{const req=indexedDB.open('cat-dog-diary-clickable-preview-v1',1);req.onsuccess=()=>{const db=req.result,tx=db.transaction('preview','readwrite'),store=tx.objectStore('preview'),read=store.get('state');read.onsuccess=()=>{const s=read.result;store.put({...s,...patch,preferences:{...s.preferences,...patch.preferences},revision:s.revision+1},'state');};tx.oncomplete=()=>{db.close();resolve();};tx.onabort=()=>reject(tx.error);};});
  window.dispatchEvent(new Event('focus'));
 },patch);
}
const tones=(page:Page)=>page.evaluate(()=>(window as any).feedbackMetrics.tones);
const alert={key:'feedback-test',type:'test',title:'隔离测试提醒',occurredAt:'2026-10-09T08:00:00Z',presentation:'fullscreen'};

test('unsupported vibration is honest and home-screen instructions are accessible',async({page})=>{
 await mockFeedback(page,'unsupported');await page.goto('./');await openSettings(page);
 await expect(page.getByRole('switch',{name:/震动提醒/})).toBeDisabled();
 await expect(page.getByText(/iPhone Safari 可使用大屏和声音/)).toBeVisible();
 await expect(page.getByRole('heading',{name:'后台与锁屏提醒：尚未接入'})).toBeVisible();
 await expect(page.getByText(/iPhone：用 Safari/)).toBeVisible();
 await page.screenshot({path:'artifacts/mobile-reminder-settings.png',fullPage:true});
});
test('click feedback, persistence, no repeat on ticks or refresh, and next occurrence',async({page})=>{
 await mockFeedback(page);await page.goto('./');await openSettings(page);
 await page.getByRole('switch',{name:/声音提醒/}).click();await expect(page.getByRole('status')).toContainText('已播放测试音');
 await page.getByRole('switch',{name:/震动提醒/}).click();await expect(page.getByRole('status')).toContainText('已请求震动');
 await page.getByRole('button',{name:'测试声音／震动',exact:true}).click();await expect(page.getByRole('status')).toContainText('请确认');
 await page.reload();await openSettings(page);await expect(page.getByRole('switch',{name:/声音提醒/})).toBeChecked();
 await expect(page.getByRole('switch',{name:/声音提醒/})).toContainText('请点击测试');
 await page.getByRole('button',{name:'测试声音／震动',exact:true}).click();await expect.poll(()=>tones(page)).toBe(1);
 await page.getByRole('button',{name:'体验大屏提醒'}).click();await expect(page.getByRole('heading',{name:'给自己一个小小的休息'})).toBeVisible();
 await expect.poll(()=>tones(page)).toBe(2);await page.waitForTimeout(1300);await expect.poll(()=>tones(page)).toBe(2);
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect.poll(()=>tones(page)).toBe(2);
 await page.getByRole('button',{name:'我知道了',exact:true}).click();await page.waitForTimeout(5100);
 await page.getByRole('button',{name:/体验一次提醒/}).click();await expect.poll(()=>tones(page)).toBe(3);
});
for(const mode of ['reject','pending'])test(`audio ${mode} gives useful feedback and releases controls`,async({page})=>{
 await mockFeedback(page,mode);await page.goto('./');await openSettings(page);await page.getByRole('switch',{name:/声音提醒/}).click();
 await expect(page.getByRole('status')).toContainText('声音未能启用');await expect(page.getByRole('button',{name:'测试声音／震动'})).toBeEnabled();
 await page.getByRole('switch',{name:/声音提醒/}).click();await expect(page.getByRole('switch',{name:/声音提醒/})).not.toBeChecked();
});
test('changing dataset cancels an in-flight audio test without leaking delayed sound',async({page})=>{
 await mockFeedback(page,'pending');await page.goto('./');await openSettings(page);
 await page.getByRole('switch',{name:/声音提醒/}).click();await page.getByRole('button',{name:'关闭手机提醒设置'}).click();
 await page.getByRole('button',{name:'开始使用',exact:true}).click();await page.getByRole('button',{name:'创建自己的清单',exact:true}).click();
 await expect(page.getByText('本机个人清单 · 未登录',{exact:true})).toBeVisible();
 await page.evaluate(()=>(window as any).feedbackMetrics.contexts[0].finishResume());await page.waitForTimeout(100);expect(await tones(page)).toBe(0);
});
test('hidden and away pages stay quiet; returning catches up once',async({page})=>{
 await mockFeedback(page);await page.goto('./');await openSettings(page);await page.getByRole('switch',{name:/声音提醒/}).click();await expect.poll(()=>tones(page)).toBe(1);await page.keyboard.press('Escape');
 await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{value:'hidden',configurable:true});document.dispatchEvent(new Event('visibilitychange'));});
 await patchPreview(page,{pendingReminders:[alert]});await page.waitForTimeout(1100);expect(await tones(page)).toBe(1);
 await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{value:'visible',configurable:true});document.dispatchEvent(new Event('visibilitychange'));});
 await expect.poll(()=>tones(page)).toBe(2);await page.getByRole('button',{name:'我知道了',exact:true}).click();
 await patchPreview(page,{presence:{active:true,status:'吃饭中',startedAt:new Date().toISOString()},pendingReminders:[{...alert,key:'later',title:'等回来再提醒'}]});await expect(page.getByRole('heading',{name:'吃饭中'})).toBeVisible();await page.waitForTimeout(1100);expect(await tones(page)).toBe(2);
 await page.getByRole('button',{name:'我回来了'}).click();await expect(page.getByRole('heading',{name:'等回来再提醒'})).toBeVisible();
 // A rapid backlog is still visible, but is not allowed to produce a burst.
 expect(await tones(page)).toBe(2);
});
test('ordinary task obeys reminder switch and quiet hours without changing tasks',async({page})=>{
 await mockFeedback(page);await page.goto('./');await openSettings(page);await page.getByRole('switch',{name:/声音提醒/}).click();await expect.poll(()=>tones(page)).toBe(1);await page.keyboard.press('Escape');
 const item={...alert,type:'interval',taskId:'sample-long'};
 await patchPreview(page,{preferences:{remindersEnabled:false},pendingReminders:[item]});await page.waitForTimeout(1100);expect(await tones(page)).toBe(1);await expect(page.getByRole('heading',{name:alert.title})).toHaveCount(0);
 // Keep the whole assertion inside the quiet window, even at xx:xx:59.
 const times=await page.evaluate(()=>{const t=new Date();return {quietStart:new Date(t.getTime()-3600000).toTimeString().slice(0,5),quietEnd:new Date(t.getTime()+3600000).toTimeString().slice(0,5)};});
 await patchPreview(page,{preferences:{remindersEnabled:true,quietEnabled:true,...times}});await page.waitForTimeout(1100);expect(await tones(page)).toBe(1);
 await patchPreview(page,{preferences:{quietEnabled:false}});await expect(page.getByRole('heading',{name:alert.title})).toBeVisible();await expect.poll(()=>tones(page)).toBe(2);
});
test('phone settings fit all six themes at narrow width and large text',async({page})=>{
 await mockFeedback(page);await page.setViewportSize({width:360,height:720});await page.goto('./');
 for(const theme of ['bg1','bg2','bg3','bg4','bg5','bg6']){
  await patchPreview(page,{theme});await openSettings(page);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();await page.keyboard.press('Escape');
 }
 await page.evaluate(()=>document.documentElement.style.fontSize='32px');await openSettings(page);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
 await expect(page.getByRole('button',{name:'测试声音／震动'})).toBeEnabled();await page.screenshot({path:'artifacts/mobile-reminder-large-font.png',fullPage:true});
});
