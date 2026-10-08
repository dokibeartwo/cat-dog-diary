import React,{useState,useSyncExternalStore,useEffect,useRef} from 'react';
import {Modal,Btn,Field,Toggle} from './controls';
import {getRecord,getSnapshot,subscribe,activeDataset} from './store';
import * as Cloud from './cloud';
import {date} from './model';
export function exportPersonal(){
 const record=getRecord();if(!record)throw Error('请切换到个人清单后导出');
 const blob=new Blob([JSON.stringify({format:'cat-dog-web-personal-v2',exportedAt:new Date().toISOString(),state:record.state,replica:record.replica,backups:record.backups||[]},null,2)],{type:'application/json'});
 const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`猫狗日记-个人清单-${date()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
const pretty=(v:any)=>v==null?'未设置':typeof v==='object'?JSON.stringify(v,null,2):String(v);
const labels:Record<string,string>={title:'名称',notes:'备注',dueAt:'计划执行时间',planDate:'计划日期',deadlineDate:'截止日期',completed:'完成状态',priority:'优先级',themeId:'主题',deletedAt:'删除状态',reminderMinutes:'提醒间隔'};
export function AccountPanel({onClose}:{onClose:()=>void}){
 const cloud=useSyncExternalStore(Cloud.subscribeCloud,Cloud.cloudSnapshot),s=useSyncExternalStore(subscribe,getSnapshot),r=getRecord();
 const [email,setEmail]=useState(''),[sentTo,setSentTo]=useState(''),[code,setCode]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[cooldown,setCooldown]=useState(0),[includeGuest,setIncludeGuest]=useState(false),[preview,setPreview]=useState<any>(null),[deleteOpen,setDeleteOpen]=useState(false),[deleteText,setDeleteText]=useState('');
 const lock=useRef(false),mounted=useRef(true);
 useEffect(()=>{mounted.current=true;const t=setInterval(()=>setCooldown(c=>Math.max(0,c-1)),1000);return()=>{mounted.current=false;clearInterval(t);};},[]);
 async function act(fn:()=>Promise<any>){if(lock.current)return;lock.current=true;setBusy(true);setError('');setMessage('');try{await fn();}catch(e){if(mounted.current)setError((e as Error).message);}finally{lock.current=false;if(mounted.current)setBusy(false);}}
 const account=activeDataset().startsWith('user:'),rawConflicts:any[]=r?.replica.conflicts||[],conflicts=rawConflicts.filter(c=>c.conflict_id&&Array.isArray(c.conflict_fields));
 return <Modal title="账号与同步" full onClose={()=>{if(!busy)onClose();}}><div className="account-panel">
 <h2>把同一份清单，带在身边。</h2>
 {s.preview?<><p className="soft-box">当前是示例清单。开始使用时会建立独立的空白个人清单，示例任务不会上传，也不会被删除。</p><Btn className="wide primary" onClick={()=>void act(Cloud.usePersonal)} disabled={busy}>创建自己的清单</Btn></>:<>
 <span className="pill">{account?'账号清单':'本机个人清单 · 未登录'}</span>
 {!cloud.configured?<p className="soft-box">本版本未配置云服务。个人任务仍可在本机保存和导出，不会上传。</p>:!cloud.userId||!account?<>
 <p>登录后，确认合并才会把个人任务、备注、习惯、专注记录和主题存入云端。不同账号的数据分开保存。</p>
 <form onSubmit={e=>{e.preventDefault();void act(async()=>{if(sentTo){await Cloud.verifyCode(sentTo,code);}else{await Cloud.sendCode(email);setSentTo(email.trim());setCooldown(60);setMessage('发送请求已受理，请查收邮箱（也看看垃圾邮件）。');}});}}>
 <Field label="邮箱地址"><input aria-label="登录邮箱" type="email" autoComplete="email" value={email} disabled={busy||!!sentTo} onChange={e=>setEmail(e.target.value)} placeholder="填写你自己的邮箱" required/></Field>
 {sentTo&&<Field label="邮件验证码"><input aria-label="邮件验证码" inputMode="numeric" autoComplete="one-time-code" value={code} maxLength={10} onChange={e=>setCode(e.target.value.replace(/\D/g,''))} required/></Field>}
 <Btn className="wide primary" type="submit" disabled={busy||!cloud.ready}>{busy?'正在处理…':sentTo?'验证并登录':'发送验证码'}</Btn>
 {sentTo&&<div className="actions"><Btn disabled={busy} onClick={()=>{setSentTo('');setCode('');}}>更换邮箱</Btn><Btn disabled={busy||cooldown>0} onClick={()=>void act(async()=>{await Cloud.sendCode(sentTo);setCooldown(60);setMessage('发送请求已受理，请查收最新验证码');})}>{cooldown?`${cooldown} 秒后重发`:'重新发送'}</Btn></div>}
 </form><small>不需要 Google 密码、数据库密码或任何密钥。验证码只填在这里，不用发给开发者。</small>
 </>:<>
 <p className="account-email">{cloud.email}</p>
 {!r?.replica.migrated?<>
 <p className="soft-box">还没有开始同步。先查看本机和云端数量，再决定是否合并；确认前自动保留一份本地备份。</p>
 <Toggle label="带上未登录时的个人清单" detail="只包含本机个人清单，不包含示例预览" on={includeGuest} disabled={busy} change={v=>{setIncludeGuest(v);setPreview(null);}}/>
 <Btn className="wide primary" disabled={busy} onClick={()=>void act(async()=>setPreview(await Cloud.previewMerge(includeGuest)))}>预览首次合并</Btn>
 {preview&&<div className="soft-box"><div className="sync-preview"><div><small>本机待合并</small><strong>{preview.local.task||0} 项任务</strong><small>{preview.local.habit||0} 个习惯</small></div><div><small>云端已有</small><strong>{preview.cloud.task||0} 项任务</strong><small>{preview.cloud.habit||0} 个习惯</small></div></div><p>同一字段的不同修改不会静默覆盖，会留待你选择。确认后开启自动同步。</p><Btn className="wide primary" disabled={busy} onClick={()=>void act(async()=>{await Cloud.mergeAccount(preview.token);setPreview(null);setMessage('首次合并已完成');})}>备份并确认合并</Btn></div>}
 </>:<>
 <Toggle label="自动同步" detail="修改后自动上传，前台约每 5 秒检查另一端；返回页面和恢复网络时立即检查" on={!r.paused} disabled={busy||cloud.busy} change={v=>void act(()=>Cloud.pauseSync(!v))}/>
 <div className="soft-box"><b>{r.paused?'自动同步已暂停':!cloud.online?'当前离线，联网后自动同步':cloud.message}</b><p>待上传：{r.replica.outbox.length} 条</p><small>最后同步：{r.lastSyncedAt?new Date(r.lastSyncedAt).toLocaleString('zh-CN'):'尚未完成'}</small></div>
 <Btn className="wide" disabled={busy||cloud.busy||r.paused||!cloud.online} onClick={()=>void act(Cloud.syncNow)}>{cloud.busy?'同步中…':'立即同步'}</Btn><small>自动同步默认开启，平时无需点击。关闭网页或手机锁屏后可能暂停，重新打开会继续检查。</small>
 {rawConflicts.length>conflicts.length&&<p className="soft-box">有修改等待核对；联网同步后可查看两边内容并选择保留。原修改仍保留在冲突记录中。</p>}
 {conflicts.length>0&&<section><h3>需要你选择的修改</h3>{conflicts.map((c:any)=><article className="conflict-card" key={c.conflict_id}><b>{c.remote_payload?.title||c.local_patch?.title||'同一项内容发生变化'}</b>{c.conflict_fields.map((field:string)=><div key={field}><small>{labels[field]||field}</small><p>本次修改：{field==='deletedAt'?(c.local_operation==='delete'?'删除':'编辑 / 恢复'):pretty(c.local_patch?.[field])}</p><p>云端内容：{field==='deletedAt'?(c.remote_deleted_at?'已删除':'仍保留'):pretty(c.remote_payload?.[field])}</p></div>)}<div className="actions"><Btn disabled={busy} onClick={()=>void act(()=>Cloud.resolveConflict(c,false))}>保留云端</Btn><Btn disabled={busy} onClick={()=>void act(()=>Cloud.resolveConflict(c,true))}>{c.local_operation==='delete'?'确认删除':c.remote_deleted_at?'明确恢复':'采用本次修改'}</Btn></div></article>)}</section>}
 </>}
 <Btn className="wide" disabled={busy||cloud.busy} onClick={()=>void act(Cloud.signOut)}>退出当前账号</Btn><small>退出不会删除云端数据；本机账号分区也会保留，再次登录同一账号才能打开。</small>
 </>}
 <h3>数据与隐私</h3><Btn className="wide" onClick={()=>{try{exportPersonal();setMessage('已导出个人数据、待同步修改和合并前备份，不含登录凭据');}catch(e){setError((e as Error).message);}}}>导出个人数据与备份</Btn>
 {account&&<Btn className="wide danger" disabled={busy||cloud.busy} onClick={()=>setDeleteOpen(true)}>删除云端账号…</Btn>}
 {!account&&<Btn className="wide quiet" disabled={busy} onClick={()=>void act(Cloud.usePreview)}>返回示例预览</Btn>}
 <p className="footnote">本地保存受浏览器清理数据影响，请定期导出。当前使用 Supabase 云端存储；提醒只在网页打开时检查，后台推送尚未接入。</p>
 </>}
 {(error||cloud.error)&&<p role="alert" className="error">{error||cloud.error}</p>}{message&&<p role="status">{message}</p>}
 </div>{deleteOpen&&<Modal title="删除云端账号" level={5} onClose={()=>{if(!busy)setDeleteOpen(false);}}><p>这会永久删除账号及云端任务、习惯、专注记录，并清除此浏览器的该账号分区。不会删除示例或未登录清单。其他离线设备的本地副本无法被远程擦除。</p><Btn className="wide" onClick={exportPersonal}>先导出我的数据</Btn><Field label="输入：删除我的云端账号"><input aria-label="删除账号确认文字" value={deleteText} onChange={e=>setDeleteText(e.target.value)}/></Field><div className="actions"><Btn disabled={busy} onClick={()=>setDeleteOpen(false)}>取消</Btn><Btn kind="danger" disabled={busy||deleteText!=='删除我的云端账号'} onClick={()=>void act(async()=>{await Cloud.deleteAccount(deleteText);setDeleteOpen(false);})}>永久删除账号</Btn></div></Modal>}</Modal>;
}
