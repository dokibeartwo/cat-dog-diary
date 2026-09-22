import {activeDataset,getMeta,setMeta,newId,getDeviceId,saveEntity} from './local-db';
import {acquireFocusLease,releaseFocusLease} from './sync';
const rules=require('../../../../packages/core/src/mobile-rules');
export type FocusMode='focus'|'shortBreak'|'longBreak';
export type FocusState={sessionId:string;mode:FocusMode;durationSec:number;startedAt:string;endsAt:string;running:boolean;completed:boolean;pausedRemainingSec:number;taskId?:string;taskTitle?:string;elapsedSec:number;segmentStart?:string;segments?:{start:string;end:string}[];leaseCheckedAt?:number;leaseExpiresAt?:number;endedEarly?:boolean};
export const EMPTY_FOCUS:FocusState={sessionId:'',mode:'focus',durationSec:1500,startedAt:'',endsAt:'',running:false,completed:false,pausedRemainingSec:1500,elapsedSec:0};
const key=()=>`focus.state.${activeDataset()}`;
export function readFocus():FocusState {return getMeta(key(),{...EMPTY_FOCUS});}
function write(value:FocusState):FocusState{setMeta(key(),value);return value;}
export const remaining=(focus:FocusState,now=Date.now()):number=>rules.focusRemaining(focus,now);
function closedSegments(f:FocusState,now=Date.now()) {
  const segments=[...(f.segments||[])];
  if(f.running&&f.segmentStart){const end=Math.min(now,Date.parse(f.endsAt));if(end>Date.parse(f.segmentStart))segments.push({start:f.segmentStart,end:new Date(end).toISOString()});}
  return segments;
}
function guard(dataset:string,sessionId:string){if(activeDataset()!==dataset||readFocus().sessionId!==sessionId)throw Error('账号或专注状态已变化，请重试');}
export async function startFocus(mode:FocusMode,minutes:number,task?:{id:string;title:string}):Promise<FocusState>{
  const dataset=activeDataset(),previous=readFocus();if(previous.sessionId&&!previous.completed)throw Error('请先结束当前一轮');
  if(!Number.isInteger(minutes)||minutes<1||minutes>180)throw Error('时长应为 1–180 分钟');
  const sessionId=newId('focus');
  if(!await acquireFocusLease(getDeviceId(),sessionId,minutes*60+120))throw Error('另一台设备正在专注，请先结束那一轮');
  guard(dataset,previous.sessionId);
  const now=Date.now();return write({sessionId,mode,durationSec:minutes*60,startedAt:new Date(now).toISOString(),endsAt:new Date(now+minutes*60000).toISOString(),running:true,completed:false,pausedRemainingSec:minutes*60,elapsedSec:0,segments:[],segmentStart:new Date(now).toISOString(),leaseCheckedAt:now,leaseExpiresAt:now+(minutes*60+120)*1000,...(mode==='focus'&&task?{taskId:task.id,taskTitle:task.title}:{})});
}
export async function toggleFocus():Promise<FocusState>{
  const dataset=activeDataset(),f=readFocus();if(!f.sessionId||f.completed)return f;
  const now=Date.now();
  if(f.running){const left=remaining(f,now);if(left===0)return finishFocus();return write({...f,running:false,pausedRemainingSec:left,elapsedSec:f.durationSec-left,segments:closedSegments(f,now),segmentStart:undefined});}
  if(!await acquireFocusLease(getDeviceId(),f.sessionId,f.pausedRemainingSec+120))throw Error('另一台设备正在专注，本轮保持暂停');
  guard(dataset,f.sessionId);
  const resumedAt=Date.now();return write({...f,running:true,endsAt:new Date(resumedAt+f.pausedRemainingSec*1000).toISOString(),segmentStart:new Date(resumedAt).toISOString(),leaseCheckedAt:resumedAt,leaseExpiresAt:resumedAt+(f.pausedRemainingSec+120)*1000});
}
export async function finishFocus(early=false):Promise<FocusState>{
  const dataset=activeDataset(),f=readFocus();if(!f.sessionId||f.completed)return f;
  const left=remaining(f);if(!early&&left>0)return f;
  const segments=closedSegments(f);
  // The history ID is the session ID: retrying after a crash is idempotent.
  if(f.mode==='focus')await saveEntity('focus_session',{id:f.sessionId,taskId:f.taskId||null,taskTitle:f.taskTitle||'',startedAt:f.startedAt,endedAt:early?new Date().toISOString():f.endsAt,outcome:early?'interrupted':'completed',durationSeconds:Math.floor(segments.reduce((sum,s)=>sum+Date.parse(s.end)-Date.parse(s.start),0)/1000),segments},dataset);
  guard(dataset,f.sessionId);
  const next=write({...f,running:false,completed:true,pausedRemainingSec:0,endedEarly:early,segments,segmentStart:undefined});
  void releaseFocusLease(getDeviceId(),f.sessionId).catch(()=>undefined);return next;
}
export async function renewFocusLease():Promise<FocusState>{
  const dataset=activeDataset(),f=readFocus();if(!f.sessionId||f.completed)return f;
  const seconds=f.running?remaining(f)+120:90;
  try{
    if(!await acquireFocusLease(getDeviceId(),f.sessionId,seconds))throw Error('另一台设备已接管专注');
    guard(dataset,f.sessionId);
    const latest=readFocus();if(latest.sessionId!==f.sessionId||latest.completed)return latest;
    return write({...latest,leaseCheckedAt:Date.now(),leaseExpiresAt:Date.now()+seconds*1000});
  }catch(error){
    // Never silently continue two account timers after the lease expires.
    const latest=readFocus();
    if(activeDataset()===dataset&&latest.sessionId===f.sessionId&&!latest.completed&&latest.running&&Date.now()>(f.leaseExpiresAt||0))write({...latest,running:false,pausedRemainingSec:remaining(latest),elapsedSec:latest.durationSec-remaining(latest),segments:closedSegments(latest),segmentStart:undefined});
    throw error;
  }
}
