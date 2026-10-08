import test from 'node:test';
import assert from 'node:assert/strict';
import {AutoSync,SyncState} from '../src/auto-sync';
const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
function fixture(){
 let now=0,serial=0,calls=0;const timers=new Map<number,{at:number;fn:()=>void}>();
 const state:SyncState={key:'a:1',enabled:true,online:true,visible:true,pending:''};
 let run=async()=>{};
 const sync=new AutoSync(()=>({...state}),async()=>{calls++;await run();},{now:()=>now,set:(fn,ms)=>{const id=++serial;timers.set(id,{at:now+ms,fn});return id;},clear:id=>{timers.delete(id);}});
 async function advance(ms:number){const end=now+ms;await flush();for(;;){const next=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;now=next[1].at;timers.delete(next[0]);next[1].fn();await flush();}now=end;await flush();}
 return {state,sync,advance,timers,calls:()=>calls,setRun:(fn:()=>Promise<void>)=>{run=fn;}};
}
test('automatic first check and five-second receiving need no manual action',async()=>{const f=fixture();f.sync.observe();await f.advance(0);assert.equal(f.calls(),1);await f.advance(4999);assert.equal(f.calls(),1);await f.advance(1);assert.equal(f.calls(),2);});
test('unrelated notifications cannot postpone a pending edit forever',async()=>{const f=fixture();f.sync.observe();await f.advance(0);f.state.pending='edit-1';f.sync.observe();for(let i=0;i<10;i++){await f.advance(100);f.sync.observe();}assert.equal(f.calls(),2);});
test('edits during upload are followed up immediately after it settles',async()=>{const f=fixture();f.sync.observe();await f.advance(0);let release!:()=>void;f.setRun(()=>new Promise<void>(r=>{release=r;}));f.state.pending='edit-1';f.sync.observe();await f.advance(600);f.state.pending='edit-2';f.sync.observe();f.setRun(async()=>{f.state.pending='';});release();await f.advance(600);assert.equal(f.calls(),3);});
test('failures retry with capped backoff; successful retry returns to normal polling',async()=>{const f=fixture();f.setRun(async()=>{throw Error('offline');});f.sync.observe();await f.advance(0);assert.equal(f.calls(),1);await f.advance(1999);assert.equal(f.calls(),1);await f.advance(1);assert.equal(f.calls(),2);await f.advance(4000);assert.equal(f.calls(),3);f.setRun(async()=>{});await f.advance(8000);assert.equal(f.calls(),4);await f.advance(5000);assert.equal(f.calls(),5);});
test('offline and pause stop requests; wake performs immediate recovery',async()=>{const f=fixture();f.sync.observe();await f.advance(0);f.state.online=false;f.sync.observe();await f.advance(100000);assert.equal(f.calls(),1);f.state.online=true;f.sync.observe(true);await f.advance(0);assert.equal(f.calls(),2);f.state.enabled=false;f.sync.observe();await f.advance(100000);assert.equal(f.calls(),2);f.state.enabled=true;f.sync.observe(true);await f.advance(0);assert.equal(f.calls(),3);});
test('background idle polling stops and visibility wake does not require a new edit',async()=>{const f=fixture();f.sync.observe();await f.advance(0);f.state.visible=false;await f.advance(60000);assert.equal(f.calls(),2);f.state.visible=true;f.sync.observe(true);await f.advance(0);assert.equal(f.calls(),3);});
test('manual and automatic exchanges never overlap or schedule a retry for the wrong account',async()=>{const f=fixture();let release!:()=>void;f.setRun(()=>new Promise<void>(r=>{release=r;}));const first=f.sync.runNow();await flush();f.state.key='b:2';f.sync.observe(true);const second=f.sync.runNow();f.setRun(async()=>{});release();await Promise.all([first,second]);await f.advance(0);assert.equal(f.calls(),2);assert.equal(f.timers.size,1);});
