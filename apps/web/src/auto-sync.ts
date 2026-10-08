export type SyncState={key:string;enabled:boolean;online:boolean;visible:boolean;pending:string};
type Clock={now:()=>number;set:(fn:()=>void,ms:number)=>any;clear:(id:any)=>void};
const browserClock:Clock={now:()=>Date.now(),set:(fn,ms)=>setTimeout(fn,ms),clear:id=>clearTimeout(id)};

// One scheduler owns automatic and manual exchanges. Queue changes during a
// request are checked again on completion; render/timer updates cannot postpone
// an already scheduled upload. No intervals accumulate while offline/paused.
export class AutoSync {
 private timer:any=null;private due=Infinity;private running:Promise<void>|null=null;
 private runningKey='';private key='';private pending='';private failures=0;private wakeAgain=false;
 constructor(private read:()=>SyncState,private exchange:()=>Promise<void>,private clock:Clock=browserClock){}
 private cancel(){if(this.timer!==null)this.clock.clear(this.timer);this.timer=null;this.due=Infinity;}
 private schedule(ms:number){
  if(this.running)return;
  const due=this.clock.now()+ms;if(this.timer!==null&&this.due<=due)return;
  this.cancel();this.due=due;this.timer=this.clock.set(()=>{this.timer=null;this.due=Infinity;void this.runNow().catch(()=>{});},ms);
 }
 observe(wake=false){
  const s=this.read(),changed=s.key!==this.key,newWork=!!s.pending&&s.pending!==this.pending;
  if(changed){this.cancel();this.key=s.key;this.failures=0;this.wakeAgain=false;}
  this.pending=s.pending;
  if(!s.enabled||!s.online){this.cancel();return;}
  if(this.running){if(wake||changed)this.wakeAgain=true;return;}
  if(wake||changed){this.failures=0;this.schedule(0);}
  else if(newWork)this.schedule(this.failures?this.retryDelay():600);
  else if(s.visible)this.schedule(this.failures?this.retryDelay():5000);
 }
 private retryDelay(){return Math.min(30000,2000*2**Math.max(0,this.failures-1));}
 async runNow():Promise<void>{
  const s=this.read();
  if(!s.enabled)return;
  if(!s.online)throw Error('当前离线，修改已保存在本机，联网后会自动同步');
  if(this.running){const same=this.runningKey===s.key;try{await this.running;}catch(e){if(same)throw e;}if(same)return;return this.runNow();}
  this.cancel();this.key=s.key;this.runningKey=s.key;this.pending=s.pending;this.wakeAgain=false;
  let failed=false;
  const work=Promise.resolve().then(async()=>{const current=this.read();if(current.key===s.key&&current.enabled&&current.online)await this.exchange();});
  this.running=work;
  try{await work;if(this.read().key===s.key)this.failures=0;}
  catch(e){failed=true;if(this.read().key===s.key)this.failures++;throw e;}
  finally{
   this.running=null;const next=this.read();this.pending=next.pending;
   if(next.enabled&&next.online){
    if(next.key!==s.key||this.wakeAgain){this.failures=0;this.schedule(0);}
    else if(failed&&(next.visible||next.pending))this.schedule(this.retryDelay());
    else if(next.pending)this.schedule(600);
    else if(next.visible)this.schedule(5000);
   }
  }
 }
}
