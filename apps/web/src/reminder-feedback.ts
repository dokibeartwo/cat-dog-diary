// Device-only feedback. No task content, account session or cloud data is stored here.
export const FEEDBACK_KEY='cat-dog-diary-device-feedback-v1';
export type FeedbackPreferences={sound:boolean;vibration:boolean};
type Environment={
 audioSupported:boolean;vibrationSupported:boolean;
 createAudio:()=>AudioContext;vibrate:(pattern:number|number[])=>boolean;
 visible:()=>boolean;now:()=>number;storage?:Pick<Storage,'getItem'|'setItem'>;
 timeoutMs?:number;
};
type Snapshot=FeedbackPreferences&{audio:'off'|'needs-gesture'|'ready'|'unsupported';busy:boolean;message:string;storageWarning:string};
export class ReminderFeedback {
 private context?:AudioContext;
 private listeners=new Set<()=>void>();
 private nodes=new Set<OscillatorNode>();
 private seen=new Set<string>();
 private scope='';private generation=0;private lastPlayed=-Infinity;
 private state:Snapshot;
 constructor(readonly env:Environment){
  let saved:Partial<FeedbackPreferences>={},storageWarning='';
  try{saved=JSON.parse(env.storage?.getItem(FEEDBACK_KEY)||'{}')||{};}catch{storageWarning='无法读取设备设置，本次仍可使用。';}
  this.state={sound:saved.sound===true&&env.audioSupported,vibration:saved.vibration===true&&env.vibrationSupported,audio:env.audioSupported?'off':'unsupported',busy:false,message:'先开启需要的声音或震动，再点击测试。',storageWarning};
  if(this.state.sound)this.state.audio='needs-gesture';
 }
 snapshot=()=>this.state;
 subscribe=(fn:()=>void)=>{this.listeners.add(fn);return()=>{this.listeners.delete(fn);};};
 private update(patch:Partial<Snapshot>){this.state={...this.state,...patch};this.listeners.forEach(fn=>fn());}
 private audioState():Snapshot['audio']{return !this.env.audioSupported?'unsupported':!this.state.sound?'off':this.context?.state==='running'?'ready':'needs-gesture';}
 setPreference(name:keyof FeedbackPreferences,value:boolean){
  this.stop();
  const allowed=name==='sound'?this.env.audioSupported:this.env.vibrationSupported;
  this.update({[name]:value&&allowed,message:value?'已开启；请测试本机效果。':'已关闭。'});
  this.update({audio:this.audioState()});
  try{this.env.storage?.setItem(FEEDBACK_KEY,JSON.stringify({sound:this.state.sound,vibration:this.state.vibration}));}
  catch{this.update({storageWarning:'浏览器未保存设备设置，重新打开后需要再设置。'});}
 }
 refreshPreferences(){
  try{const saved=JSON.parse(this.env.storage?.getItem(FEEDBACK_KEY)||'{}')||{};this.stop();this.update({sound:saved.sound===true&&this.env.audioSupported,vibration:saved.vibration===true&&this.env.vibrationSupported});this.update({audio:this.audioState()});}catch{/* Retain this tab's settings. */}
 }
 setScope(scope:string){if(scope!==this.scope){this.stop();this.scope=scope;}}
 stop(){
  this.generation++;
  for(const node of this.nodes){try{node.stop();node.disconnect();}catch{/* Already ended. */}}
  this.nodes.clear();
  if(this.env.vibrationSupported)try{this.env.vibrate(0);}catch{/* Optional hardware. */}
  if(this.state.busy)this.update({busy:false,message:'测试已停止；回到页面后可重新测试。'});
 }
 private tone(){
  const ctx=this.context;if(!ctx||ctx.state!=='running')return false;
  try{
   const osc=ctx.createOscillator(),gain=ctx.createGain(),at=ctx.currentTime;
   osc.type='sine';osc.frequency.setValueAtTime(660,at);osc.frequency.setValueAtTime(880,at+.18);
   gain.gain.setValueAtTime(0,at);gain.gain.linearRampToValueAtTime(.12,at+.02);gain.gain.linearRampToValueAtTime(0,at+.42);
   osc.connect(gain);gain.connect(ctx.destination);this.nodes.add(osc);
   osc.onended=()=>{this.nodes.delete(osc);osc.disconnect();gain.disconnect();};osc.start(at);osc.stop(at+.45);return true;
  }catch{return false;}
 }
 private buzz(){try{return this.env.vibrationSupported&&this.env.vibrate([140,80,140]);}catch{return false;}}
 // Must be called directly from a click: construct/resume before the first await.
 async test(){
  if(this.state.busy||!this.env.visible())return;
  this.stop();const generation=this.generation;
  const results:string[]=[];
  if(this.state.vibration)results.push(this.buzz()?'已请求震动，请确认手机是否振动。':'浏览器未接受震动请求，请检查设备或换用支持的浏览器。');
  if(!this.state.sound){this.update({message:results.join(' ')||'声音和震动都未开启；页面内提醒仍可使用。'});return;}
  this.update({busy:true,message:'正在启用声音…'});
  let timeout:ReturnType<typeof setTimeout>|undefined;
  try{
   if(!this.context||this.context.state==='closed'){
    this.context=this.env.createAudio();
    this.context.onstatechange=()=>this.update({audio:this.audioState()});
   }
   const resume=this.context.resume();
   await Promise.race([resume,new Promise<never>((_,reject)=>{timeout=setTimeout(()=>reject(Error('timeout')),this.env.timeoutMs??2500);})]);
   if(generation!==this.generation||!this.env.visible())return;
   results.unshift(this.tone()?'已播放测试音，请确认媒体音量和静音设置。':'声音尚未就绪，请再次点击测试。');
  }catch{
   if(generation!==this.generation)return;
   results.unshift('声音未能启用，请再次点击测试，并检查浏览器与媒体音量。');
  }finally{
   clearTimeout(timeout);
   if(generation===this.generation)this.update({busy:false,audio:this.audioState(),message:results.join(' ')});
  }
 }
 deliver(scope:string,item:{key:string;occurredAt?:string;availableAt?:string}|undefined,allowed:boolean){
  this.setScope(scope);
  if(!allowed||!this.env.visible()||!item)return;
  const key=JSON.stringify([scope,item.key,item.occurredAt||'',item.availableAt||'']);
  if(this.seen.has(key))return;
  this.seen.add(key);if(this.seen.size>1000)this.seen.delete(this.seen.values().next().value!);
  // Catch-up retains every visual reminder but never produces a burst of sound.
  const now=this.env.now();if(now-this.lastPlayed<5000)return;
  this.lastPlayed=now;
  if(this.state.sound){this.tone();this.update({audio:this.audioState()});}
  if(this.state.vibration)this.buzz();
 }
}
