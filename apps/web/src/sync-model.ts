import {State,clone,personalSeed} from './model';
import {D,Diary,R,P} from './rules';
export const {journal:J,projection:Pj}=(globalThis as any).DiarySyncCore;
export type FocusLease={sessionId:string;expiresAt:string};
export type RecordData={state:State;replica:any;paused:boolean;focusLease?:FocusLease;sequence?:number;lastSyncedAt?:string;backups?:{at:string;state:State;guest?:State}[]};
export const newRecord=():RecordData=>({state:personalSeed(),replica:J.emptyReplica(),paused:false});
// A persisted grant covers offline completion only through the scheduled end.
// Never settle an unowned/legacy round merely because a tab wakes up late.
export function guardFocusLease(record:RecordData,now=Date.now(),force=false){
 const f=record.state.focusTimer;if(f.status!=='running')return false;
 const end=Date.parse(f.endsAt),expires=Date.parse(record.focusLease?.expiresAt||'');
 if(!force&&record.focusLease?.sessionId===f.sessionId&&expires>=Math.min(now,end))return false;
 const cutoff=Math.min(now,end-1000,Number.isFinite(expires)?expires:now);
 P.closeSegment(f,cutoff);R.updateFocus(f,{action:'pause'},cutoff);record.state.revision++;delete record.focusLease;return true;
}
export function project(s:State):Map<string,any>{
 if(s.preview||s.datasetKind!=='personal')throw Error('示例数据不能上传，请先建立个人清单');
 return Pj.projectState({...s,stagePlan:s.stage,preferences:{...s.preferences,themeId:s.theme},tasks:s.tasks.map(t=>({...t,steps:t.steps.map((p,i)=>({...p,position:i}))}))});
}
export function recordChange(record:RecordData,next:State,deviceId:string){
 const before=project(record.state);
 next.habitEvents=next.habitEvents||[];
 for(const habit of next.habits){const old=record.state.habits.find(h=>h.id===habit.id);const count=Math.max(0,(habit.completionCount||0)-(old?.completionCount||0));
  for(let i=0;i<count;i++)next.habitEvents.push({id:crypto.randomUUID(),habitId:habit.id,occurredAt:habit.lastCompletedAt||new Date().toISOString(),completed:true,source:'web'});
 }
 const after=project(next),rows=new Map(J.materialize(record.replica).map((e:any)=>[J.keyOf(e),e]));
 for(const key of new Set([...before.keys(),...after.keys()])){
  const a=before.get(key),b=after.get(key),prior:any=rows.get(key);
  J.enqueue(record.replica,a,b,{deviceId,mutationId:crypto.randomUUID(),operation:!a&&b&&prior?.deletedAt?'restore':undefined});
 }
 record.state=next;
}
const taskRule=(t:any)=>JSON.stringify([t?.dueAt,t?.reminderMode,t?.reminderMinutes,t?.reminderActive,t?.completed]);
export function materializeRecord(record:RecordData){
 const old=record.state,rows=J.materialize(record.replica),mapped=Pj.applyEntities({...old,stagePlan:old.stage,preferences:{...old.preferences,themeId:old.theme}},rows);
 const next:State={...mapped,preview:false,datasetKind:'personal',theme:D.normalizeThemeId(mapped.preferences.themeId),stage:mapped.stagePlan||old.stage,revision:old.revision+1};
 const trash=new Map(old.trash.map(x=>[x.task.id,x]));
 for(const e of rows){if(e.entityType!=='task')continue;if(e.deletedAt){trash.set(e.entityId,{deletedAt:e.deletedAt,task:{...e.payload,id:e.entityId,steps:rows.filter((p:any)=>p.entityType==='step'&&p.payload.taskId===e.entityId).map((p:any)=>({...p.payload,id:p.entityId}))}});}else trash.delete(e.entityId);}
 next.trash=[...trash.values()];
 for(const t of next.tasks){const prev=old.tasks.find(p=>p.id===t.id);if(!prev||taskRule(prev)!==taskRule(t))t.nextReminderAt=t.reminderActive&&!t.completed?D.calculateNextReminderAt(t,new Date()):null;}
 for(const h of next.habits){const prev=old.habits.find(p=>p.id===h.id);if(!prev||!J.equal(Pj.habitPayload(prev),Pj.habitPayload(h)))h.nextReminderAt=h.active?Diary.nextHabit(h,new Date()):null;}
 R.reconcile(next);record.state=next;
}
export function confirmMerge(record:RecordData,guest:RecordData|undefined,cloud:any[],fingerprint:string,deviceId:string){
 const local=[...J.materialize(record.replica),...(guest?J.materialize(guest.replica):[])];
 if(J.fingerprint(local)!==fingerprint)throw Error('预览后本机数据已改变，请重新预览');
 record.backups=[...(record.backups||[]),{at:new Date().toISOString(),state:clone(record.state),...(guest?{guest:clone(guest.state)}:{})}].slice(-5);
 record.replica=J.prepareMerge(local,cloud,()=>crypto.randomUUID(),deviceId);materializeRecord(record);
}
