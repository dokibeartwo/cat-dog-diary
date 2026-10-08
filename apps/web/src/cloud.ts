import {createClient,Session} from '@supabase/supabase-js';
import {activeDataset,generation,switchDataset,getRecord,getSnapshot,readRecord,transact,subscribe,deviceId,dispatch as localDispatch,eraseDeletedAccount} from './store';
import {J,Pj,FocusLease,confirmMerge,materializeRecord,guardFocusLease} from './sync-model';
import {Command,remaining} from './model';
import {AutoSync} from './auto-sync';
declare const __CLOUD_CONFIG__:{url:string;key:string}|null;
const config=typeof __CLOUD_CONFIG__==='undefined'?null:__CLOUD_CONFIG__;
const client=config?createClient(config.url,config.key,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false,storageKey:'cat-dog-web-auth-v2'},global:{fetch:(url,options)=>fetch(url,{...options,signal:AbortSignal.timeout(20000)})}}):null;
type CloudStatus={configured:boolean;ready:boolean;email:string;userId:string;busy:boolean;online:boolean;message:string;error:string;conflicts:any[]};
let status:CloudStatus={configured:!!client,ready:false,email:'',userId:'',busy:false,online:navigator.onLine,message:'尚未登录',error:'',conflicts:[]},session:Session|null=null;
let accountAction=false;
const automatic=new AutoSync(()=>{const r=getRecord();return {
 key:`${session?.user.id||''}:${activeDataset()}:${generation()}`,
 enabled:!!session&&activeDataset()===`user:${session.user.id}`&&!!r?.replica.migrated&&!r.paused&&!accountAction,
 online:navigator.onLine,visible:document.visibilityState==='visible',
 pending:r?.replica.outbox.length?JSON.stringify(r.replica.outbox.map((m:any)=>[m.mutationId,m.operation,m.patch])):''
};},exchangeOnce);
const listeners=new Set<()=>void>();
const set=(patch:Partial<CloudStatus>)=>{status={...status,...patch};listeners.forEach(cb=>cb());};
export const cloudSnapshot=()=>status;
export const subscribeCloud=(cb:()=>void)=>{listeners.add(cb);return()=>{listeners.delete(cb);};};
function errorText(e:any){
 const code=e?.code||'';
 if(code==='otp_expired')return '验证码不正确或已过期，请检查或重新获取';
 if(code==='over_email_send_rate_limit'||code==='over_request_rate_limit'||e?.status===429)return '发送太频繁，请稍后再试，不要连续点击';
 if(code==='email_address_not_authorized')return '发信服务尚未允许这个收件地址，请检查 SMTP 配置';
 if(code==='unexpected_failure')return '邮件服务暂时未能发送，请检查 Supabase 的发信设置';
 if(e?.name==='AbortError'||e?.name==='TimeoutError'||e?.name==='AuthRetryableFetchError'||e instanceof TypeError)return '网络暂时不可用，修改已保存在本机，稍后重试';
 if(e?.status===401)return '登录已失效，请重新获取验证码登录';
 return e instanceof Error&&!code?e.message:'云端暂时未完成操作，数据仍在本机保留，请稍后重试';
}
function context(){const key=activeDataset(),start=generation(),uid=session?.user.id;
 if(!client||!uid||key!==`user:${uid}`)throw Error('请先切换到个人清单并登录');
 const check=()=>{if(activeDataset()!==key||generation()!==start||session?.user.id!==uid)throw Error('账号或清单已变化，本次同步已停止');};
 const token=session!.access_token;
 const request=async(path:string,body?:any)=>{
  check();
  const response=await fetch(config!.url+path,{method:body===undefined?'GET':'POST',headers:{apikey:config!.key,Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(20000)});
  check();const raw=await response.text(),data=raw?JSON.parse(raw):null;check();
  return response.ok?{data,error:null}:{data:null,error:{...data,status:response.status}};
 };
 const rpc=(name:string,body:any={})=>request('/rest/v1/rpc/'+name,body);
 return {key,start,uid,check,request,rpc};
}
export async function initializeCloud(){
 if(!client){set({ready:true});return;}
 let transition=Promise.resolve();
 const accept=(s:Session|null)=>{
  const changed=session?.user.id!==s?.user.id;session=s;const uid=s?.user.id||'';set({ready:true,userId:uid,email:s?.user.email||'',...(changed?{conflicts:[],error:'',message:uid?'已登录，等待确认同步':'尚未登录'}:{})});
  transition=transition.then(async()=>{if(session?.user.id!==s?.user.id)return;if(activeDataset()!=='preview')await switchDataset(uid?`user:${uid}`:'guest');automatic.observe(changed);}).catch(e=>set({error:errorText(e)}));
 };
 // Keep the auth callback synchronous: calling SDK methods inside it can deadlock.
 client.auth.onAuthStateChange((_event,s)=>accept(s));
 const {data,error}=await client.auth.getSession();if(error)set({error:errorText(error)});accept(data.session);await transition;
 const wake=()=>{set({online:navigator.onLine});automatic.observe(true);void maintainFocusLease();};
 subscribe(()=>automatic.observe());window.addEventListener('online',wake);window.addEventListener('offline',()=>{set({online:false});automatic.observe();});window.addEventListener('focus',wake);
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')wake();});
 setInterval(()=>{if(document.visibilityState==='visible')void maintainFocusLease();},30000);wake();
}
export async function usePersonal(){if(getSnapshot().focusTimer.status!=='idle')throw Error('请先结束本轮专注，再切换清单');await switchDataset(session?`user:${session.user.id}`:'guest');}
export async function usePreview(){if(getSnapshot().focusTimer.status!=='idle')throw Error('请先结束本轮专注，再切换清单');await switchDataset('preview');}
export async function sendCode(email:string){
 if(!client)throw Error('这个版本尚未配置登录服务');if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))throw Error('请输入完整邮箱地址');
 const {error}=await client.auth.signInWithOtp({email:email.trim(),options:{shouldCreateUser:true}});if(error)throw Error(errorText(error));
}
export async function verifyCode(email:string,token:string){
 if(!client)throw Error('登录服务未配置');if(!/^\d{6,10}$/.test(token.trim()))throw Error('请填写邮件中的数字验证码');
 const {data,error}=await client.auth.verifyOtp({email:email.trim(),token:token.trim(),type:'email'});if(error)throw Error(errorText(error));
 if(!data.session)throw Error('未获得登录会话，请重试');
 session=data.session;set({userId:session.user.id,email:session.user.email||'',error:''});await switchDataset(`user:${session.user.id}`);
}
export async function signOut(){
 if(getSnapshot().focusTimer.status!=='idle')throw Error('请先结束本轮专注再退出账号');
 if(status.busy)throw Error('请等当前同步结束后再退出');
 accountAction=true;automatic.observe();
 try{const {error}=await client!.auth.signOut({scope:'local'});if(error)throw Error(errorText(error));session=null;set({userId:'',email:'',message:'已退出，账号数据保留在独立分区',conflicts:[]});await switchDataset('guest');}
 finally{accountAction=false;automatic.observe(true);}
}
async function pullAll(cursor:any,ctx:ReturnType<typeof context>){
 const entities:any[]=[];
 for(let i=0;i<1000;i++){
  ctx.check();const {data,error}=await ctx.rpc('pull_changes',{p_cursor:cursor?.updatedAt??null,p_cursor_entity:cursor?.entityId??'',p_limit:500});ctx.check();if(error)throw error;
  if(!Array.isArray(data?.items))throw Error('云端响应格式不正确，未覆盖本机数据');
  for(const row of data.items)Pj.validateEntity(row);entities.push(...data.items);
  const next=data.nextCursor?{updatedAt:data.nextCursor.updatedAt,entityId:data.nextCursor.entity}:cursor;
  if(data.hasMore&&J.equal(next,cursor))throw Error('同步进度未前进，请联系维护者');cursor=next;
  if(!data.hasMore)return {entities,cursor};
 }throw Error('本次数据量超出处理范围，未覆盖本机数据');
}
let mergeDraft:any=null;
export async function previewMerge(includeGuest:boolean){
 const ctx=context();if(getRecord()?.replica.migrated)throw Error('这个账号已完成首次合并');
 const [record,guest,page]=await Promise.all([readRecord(ctx.key),includeGuest?readRecord('guest'):undefined,pullAll(null,ctx)]);ctx.check();
 const local=[...J.materialize(record.replica),...(guest?J.materialize(guest.replica):[])],stats=J.mergePreview(local,page.entities),token=crypto.randomUUID();
 mergeDraft={...ctx,token,includeGuest,cloud:page.entities,fingerprint:stats.fingerprint,guestFingerprint:guest?J.fingerprint(J.materialize(guest.replica)):null,at:Date.now()};
 return {...stats,token};
}
export async function mergeAccount(token:string){
 const ctx=context(),draft=mergeDraft;
 if(!draft||draft.token!==token||draft.key!==ctx.key||draft.start!==ctx.start||Date.now()-draft.at>600000)throw Error('合并预览已失效，请重新预览');
 ctx.check();
 await transact((r,guest)=>{if(r.replica.migrated)throw Error('另一个窗口已完成合并');confirmMerge(r,guest,draft.cloud,draft.fingerprint,deviceId());},ctx.key,ctx.start,draft.includeGuest);
 mergeDraft=null;await syncNow();
}
export async function syncNow(){
 context();const r=getRecord();if(!r?.replica.migrated)throw Error('请先预览并确认首次同步');if(r.paused)throw Error('同步已暂停，请先恢复');if(accountAction)throw Error('账号操作正在进行，请稍候');
 await automatic.runNow();
}
async function exchangeOnce(){
 const ctx=context();
  set({busy:true,error:'',message:'正在同步…'});
  try{
   const outgoing:any[]=[];const start=await transact(current=>{current.replica.outbox.forEach((m:any)=>{m.attempted=true;outgoing.push(J.transportMutation(m));});},ctx.key,ctx.start);
   const results:any[]=[];
   for(let i=0;i<outgoing.length;i+=100){ctx.check();const batch=outgoing.slice(i,i+100),{data,error}=await ctx.rpc('push_mutations',{p_mutations:batch});ctx.check();if(error)throw error;
    if(!Array.isArray(data)||data.length!==batch.length||new Set(data.map(row=>row.mutationId)).size!==batch.length||data.some(row=>!['applied','duplicate','conflict'].includes(row.status)||!batch.some(m=>m.mutationId===row.mutationId)))throw Error('云端未确认全部操作，修改仍在本机保留');results.push(...data);
   }
   const page=await pullAll(start.replica.cursor,ctx);ctx.check();
   await transact(current=>{J.commitExchange(current.replica,results,page.entities,page.cursor);materializeRecord(current);current.lastSyncedAt=new Date().toISOString();},ctx.key,ctx.start);
   if(page.cursor?.updatedAt){const {error}=await ctx.rpc('ack_sync_cursor',{p_device_id:deviceId(),p_cursor:page.cursor.updatedAt,p_cursor_entity:page.cursor.entityId||''});if(error)throw error;}
   const {data:conflicts,error}=await ctx.request('/rest/v1/sync_conflicts?select=*&status=eq.open&order=created_at&limit=100');ctx.check();if(error)throw error;
   await transact(current=>{current.replica.conflicts=conflicts||[];},ctx.key,ctx.start);
   set({conflicts:conflicts||[],message:conflicts?.length?'有修改冲突，请选择保留的内容':'本次同步完成'});
  }catch(e){try{ctx.check();set({error:errorText(e),message:'尚未同步完成'});}catch{}throw Error(errorText(e));}
  finally{set({busy:false});}
}
export async function pauseSync(paused:boolean){await transact(r=>{r.paused=paused;});set({message:paused?'同步已暂停，修改保留在本机':'同步已恢复'});if(!paused)await syncNow();}
export async function resolveConflict(conflict:any,keepLocal:boolean){
 const ctx=context();if(status.busy)throw Error('请等待当前同步结束');
 const action=keepLocal?(conflict.local_operation==='delete'?'delete':conflict.remote_deleted_at||conflict.local_operation==='restore'?'restore':'merge'):'keepRemote';
 const {data,error}=await ctx.rpc('resolve_conflict',{p_conflict_id:conflict.conflict_id,p_resolution:{action,fields:conflict.local_patch,expectedRevision:conflict.remote_revision}});ctx.check();if(error)throw Error(errorText(error));
 if(!data?.resolved){await syncNow();throw Error('云端内容又有变化，请重新查看后选择');}await syncNow();
}
export async function deleteAccount(confirmation:string){
 const ctx=context();if(confirmation!=='删除我的云端账号')throw Error('请输入完整确认文字');
 if(status.busy||getSnapshot().focusTimer.status!=='idle')throw Error('请先结束同步和本轮专注');
 accountAction=true;automatic.observe();
 try{const {data,error}=await ctx.rpc('delete_account');ctx.check();if(error)throw Error(errorText(error));if(!data?.deleted)throw Error('云端未确认账号已删除，本机副本暂时保留，请重试');
 await eraseDeletedAccount(ctx.key);await client!.auth.signOut({scope:'local'});session=null;set({userId:'',email:'',conflicts:[],message:'云端账号已删除'});}
 finally{accountAction=false;automatic.observe(true);}
}
// Acquire an account lease before starting/resuming a round. Offline account
// starts are blocked, while guest focus and an already-running round still work.
async function focusLock<T>(action:()=>Promise<T>):Promise<T>{return navigator.locks?await navigator.locks.request('cat-dog-web-focus-v2',action):await action();}
let maintainingLease=false;
async function maintainFocusLease(){return focusLock(renewFocusLease);}
async function renewFocusLease(){
 if(maintainingLease||!navigator.onLine||!session||activeDataset()!==`user:${session.user.id}`)return;
 const current=getSnapshot().focusTimer;if(current.status==='idle'||(current.status==='running'&&remaining(getSnapshot())<=0))return;
 const ctx=context(),sessionId=current.sessionId;maintainingLease=true;
 try{
  const seconds=current.status==='paused'?120:remaining(getSnapshot())+120;
  const {data,error}=await ctx.rpc('acquire_focus_lease',{p_device_id:deviceId(),p_session_id:sessionId,p_lease_seconds:Math.min(14400,seconds)});ctx.check();if(error)throw error;
  await transact(r=>{if(r.state.focusTimer.sessionId!==sessionId||r.state.focusTimer.status==='idle')return;if(data?.ok){r.focusLease={sessionId,expiresAt:data.expiresAt};}else{guardFocusLease(r,Date.now(),true);delete r.focusLease;}},ctx.key,ctx.start);
  if(!data?.ok)set({error:'另一台设备已在专注，本机已暂停；请结束另一台设备的专注后再继续'});
 }catch{/* A valid persisted lease still covers this round during a network outage. */}
 finally{maintainingLease=false;}
}
export async function dispatch(command:Command){return command.type==='focus'?focusLock(()=>dispatchCommand(command)):dispatchCommand(command);}
async function dispatchCommand(command:Command){
 const s=getSnapshot(),key=activeDataset(),start=generation(),prior=s.focusTimer,account=key.startsWith('user:');
 let leaseId:string|undefined,lease:FocusLease|undefined;
 if(account&&command.type==='focus'&&command.action==='start'&&prior.status!=='running'){
  const ctx=context();leaseId=prior.status==='paused'?prior.sessionId:crypto.randomUUID();
  const seconds=prior.status==='paused'?remaining(s):Number(command.minutes||prior.durationMinutes)*60;
  const {data,error}=await ctx.rpc('acquire_focus_lease',{p_device_id:deviceId(),p_session_id:leaseId,p_lease_seconds:Math.min(14400,seconds+120)});ctx.check();
  if(error)throw Error(errorText(error));if(!data?.ok)throw Error('另一台设备正在专注，请先在那台设备结束本轮');
  if(!Number.isFinite(Date.parse(data.expiresAt)))throw Error('云端未确认专注有效期，请稍后重试');
  lease={sessionId:leaseId!,expiresAt:data.expiresAt};
  command={...command,newSessionId:leaseId,sessionId:prior.sessionId};
 }
 if(key!==activeDataset()||start!==generation())throw Error('账号已变化，请重新操作');
 let next;
 try{next=await localDispatch(command,lease);}catch(e){
  if(leaseId&&client&&key===activeDataset()){
   const current=getSnapshot().focusTimer;
   const cleanup=context();
   if(current.status!=='idle')await cleanup.rpc('acquire_focus_lease',{p_device_id:deviceId(),p_session_id:current.sessionId,p_lease_seconds:Math.min(14400,remaining(getSnapshot())+120)});
   else await cleanup.rpc('release_focus_lease',{p_device_id:deviceId(),p_session_id:leaseId});
  }throw e;
 }
 if(account&&prior.status!=='idle'&&next.focusTimer.status==='idle'&&session&&client){
  void context().rpc('release_focus_lease',{p_device_id:deviceId(),p_session_id:prior.sessionId}).then(()=>{}).catch(()=>{});
 }
 return next;
}
