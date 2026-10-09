import {useEffect,useState,useSyncExternalStore} from 'react';
import {Btn,Modal,Toggle} from './controls';
import {FEEDBACK_KEY,ReminderFeedback} from './reminder-feedback';

const Audio=window.AudioContext||(window as any).webkitAudioContext;
let storage:Storage|undefined;try{storage=window.localStorage;}catch{/* Private/restricted mode. */}
export const reminderFeedback=new ReminderFeedback({
 audioSupported:!!Audio,vibrationSupported:typeof navigator.vibrate==='function',
 createAudio:()=>new Audio(),vibrate:p=>navigator.vibrate(p),
 visible:()=>document.visibilityState==='visible',now:()=>Date.now(),storage
});
export function useReminderFeedback(dataset:string,item:any,allowed:boolean){
 const state=useSyncExternalStore(reminderFeedback.subscribe,reminderFeedback.snapshot);
 const [visible,setVisible]=useState(document.visibilityState==='visible');
 useEffect(()=>{
  const change=()=>{const next=document.visibilityState==='visible';if(!next)reminderFeedback.stop();setVisible(next);};
  const settings=(e:StorageEvent)=>{if(e.key===FEEDBACK_KEY||e.key===null)reminderFeedback.refreshPreferences();};
  const stop=()=>reminderFeedback.stop();
  document.addEventListener('visibilitychange',change);window.addEventListener('pagehide',stop);
  window.addEventListener('storage',settings);
  return()=>{document.removeEventListener('visibilitychange',change);window.removeEventListener('pagehide',stop);window.removeEventListener('storage',settings);reminderFeedback.stop();};
 },[]);
 const occurrence=item?JSON.stringify([item.key,item.occurredAt,item.availableAt]):'';
 useEffect(()=>{reminderFeedback.deliver(dataset,item,allowed&&visible);return()=>reminderFeedback.stop();},[dataset,occurrence,allowed,visible]);
 return state;
}
export function ReminderSettings({onClose,experience}:{onClose:()=>void;experience:()=>void}){
 const state=useSyncExternalStore(reminderFeedback.subscribe,reminderFeedback.snapshot);
 const installed=matchMedia('(display-mode: standalone)').matches||(navigator as any).standalone===true;
 return <Modal title="手机提醒设置" onClose={onClose}>
  <p className="soft-box">当前支持网页前台提醒：页面内大屏、短提示音，以及支持设备上的震动。设置只留在本浏览器，不随账号同步。</p>
  <Toggle label="声音提醒" detail={!reminderFeedback.env.audioSupported?'此浏览器不支持网页音频':state.audio==='ready'?'本次页面声音已就绪；请保持合适的媒体音量':'开启或重新打开页面后，请点击测试启用声音'} on={state.sound} disabled={!reminderFeedback.env.audioSupported||state.busy} change={v=>{reminderFeedback.setPreference('sound',v);if(v)void reminderFeedback.test();}}/>
  <Toggle label="震动提醒" detail={reminderFeedback.env.vibrationSupported?'实际效果受手机硬件、浏览器及系统设置影响':undefined} on={state.vibration} disabled={!reminderFeedback.env.vibrationSupported||state.busy} change={v=>{reminderFeedback.setPreference('vibration',v);if(v)void reminderFeedback.test();}}/>
  {!reminderFeedback.env.vibrationSupported&&<p className="muted">此浏览器不支持页面震动；iPhone Safari 可使用大屏和声音。</p>}
  <div className="actions"><Btn kind="primary" disabled={state.busy} onClick={()=>void reminderFeedback.test()}>{state.busy?'正在启用声音…':'测试声音／震动'}</Btn><Btn onClick={()=>{reminderFeedback.stop();experience();}}>体验大屏提醒</Btn></div>
  <p className="soft-box" role="status" aria-live="polite">{state.message}</p>
  {state.storageWarning&&<p role="alert">{state.storageWarning}</p>}
  <p className="muted">测试按钮会主动试听；日常提醒沿用勿扰、离席和事项开关规则。专注完成与主动测试保留；紧急提醒按原有设置处理。</p>
  <h3>添加到手机桌面</h3>
  {installed&&<span className="pill">当前已在独立窗口打开</span>}
  <ol className="explain-list"><li>iPhone：用 Safari 打开，点分享 → 添加到主屏幕；如有“作为网页 App 打开”，将其开启。</li><li>安卓：用 Chrome 打开，点右上角菜单 → 添加到主屏幕／安装。自带浏览器若有“添加到桌面”也可尝试。</li><li>以后点小熊图标进入；若要求登录，使用原来的邮箱即可，不需要电脑开机。</li></ol>
  <h3>后台与锁屏提醒：尚未接入</h3>
  <p>添加图标不代表支持后台提醒或离线启动。切换 App、关闭网页或锁屏后不保证响铃；返回前台时重新检查时间。页面内大屏不会覆盖其他 App。</p>
  <p className="muted">后续将接入服务端推送。iPhone 需要 iOS 16.4 或以上并从主屏幕打开，再主动允许通知；系统决定锁屏通知是否响铃或震动。</p>
 </Modal>;
}
export function ReminderSoundHint(){
 const state=useSyncExternalStore(reminderFeedback.subscribe,reminderFeedback.snapshot);
 if(!state.sound||state.audio==='ready')return null;
 return <div className="soft-box"><p>浏览器尚未启用声音；本条页面提醒仍有效。</p><Btn disabled={state.busy} onClick={()=>void reminderFeedback.test()}>{state.busy?'正在启用声音…':'点此启用并测试声音'}</Btn><p role="status" aria-live="polite">{state.message}</p></div>;
}
