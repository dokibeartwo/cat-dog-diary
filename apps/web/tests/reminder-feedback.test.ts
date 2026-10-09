import test from 'node:test';
import assert from 'node:assert/strict';
import {FEEDBACK_KEY,ReminderFeedback} from '../src/reminder-feedback';

function fixture(options:{resume?:'reject'|'pending';audio?:boolean;vibration?:boolean;saved?:string;storageFails?:boolean}={}){
 let now=0,visible=true,tones=0,resumes=0,stops=0,resolveResume:()=>void=()=>{};
 const vibrations:(number|number[])[]=[],saved=new Map<string,string>([[FEEDBACK_KEY,options.saved||'{}']]);
 const param={setValueAtTime(){},linearRampToValueAtTime(){}};
 const ctx={state:'suspended',currentTime:0,destination:{},onstatechange:null as null|(()=>void),
  resume(){resumes++;if(options.resume==='reject')return Promise.reject(Error('denied'));if(options.resume==='pending')return new Promise<void>(resolve=>{resolveResume=()=>{ctx.state='running';ctx.onstatechange?.();resolve();};});ctx.state='running';return Promise.resolve();},
  createOscillator(){return {frequency:param,connect(){},disconnect(){},start(){tones++;},stop(){stops++;}};},
  createGain(){return {gain:param,connect(){},disconnect(){}};}
 };
 const feedback=new ReminderFeedback({audioSupported:options.audio!==false,vibrationSupported:options.vibration!==false,createAudio:()=>ctx as unknown as AudioContext,vibrate:p=>{vibrations.push(p);return true;},now:()=>now,visible:()=>visible,timeoutMs:15,storage:{getItem:key=>saved.get(key)||null,setItem:(key,value)=>{if(options.storageFails)throw Error('blocked');saved.set(key,value);}}});
 return {feedback,ctx,saved,vibrations,get tones(){return tones;},get resumes(){return resumes;},get stops(){return stops;},advance:(ms=6000)=>now+=ms,hide:()=>{visible=false;feedback.stop();},show:()=>{visible=true;},resolve:()=>resolveResume()};
}
test('feedback defaults off; storage contains only device booleans',()=>{
 const f=fixture();assert.equal(f.feedback.snapshot().sound,false);assert.equal(f.feedback.snapshot().vibration,false);
 f.feedback.setPreference('sound',true);f.feedback.setPreference('vibration',true);
 assert.deepEqual(JSON.parse(f.saved.get(FEEDBACK_KEY)!),{sound:true,vibration:true});
});
test('unsupported and corrupt saved preferences degrade without crashing',async()=>{
 const f=fixture({audio:false,vibration:false,saved:'{"sound":true,"vibration":true}'});
 assert.equal(f.feedback.snapshot().audio,'unsupported');assert.equal(f.feedback.snapshot().sound,false);
 f.feedback.setPreference('vibration',true);await f.feedback.test();assert.equal(f.feedback.snapshot().vibration,false);assert.equal(f.tones,0);
 assert.match(fixture({saved:'{'}).feedback.snapshot().storageWarning,/读取/);
});
test('gesture resumes synchronously, reports results, and rejection is recoverable',async()=>{
 const f=fixture();f.feedback.setPreference('sound',true);const done=f.feedback.test();assert.equal(f.resumes,1);assert.equal(f.feedback.snapshot().busy,true);await done;
 assert.equal(f.tones,1);assert.equal(f.feedback.snapshot().audio,'ready');assert.match(f.feedback.snapshot().message,/已播放/);
 const denied=fixture({resume:'reject'});denied.feedback.setPreference('sound',true);await denied.feedback.test();assert.equal(denied.feedback.snapshot().busy,false);assert.match(denied.feedback.snapshot().message,/未能启用/);
});
test('timeout releases button and a late browser resume never plays delayed audio',async()=>{
 const f=fixture({resume:'pending'});f.feedback.setPreference('sound',true);await f.feedback.test();assert.equal(f.feedback.snapshot().busy,false);assert.equal(f.tones,0);f.resolve();await Promise.resolve();assert.equal(f.tones,0);
});
test('hidden page, account switch and explicit stop cancel pending feedback',async()=>{
 for(const action of ['hidden','account','stop']){
  const f=fixture({resume:'pending'});f.feedback.setPreference('sound',true);const result=f.feedback.test();
  if(action==='hidden')f.hide();else if(action==='account')f.feedback.setScope('user:new');else f.feedback.stop();
  f.resolve();await result;assert.equal(f.tones,0);assert.equal(f.feedback.snapshot().busy,false);
 }
});
test('automatic feedback never attempts to unlock blocked audio',()=>{
 const f=fixture();f.feedback.setPreference('sound',true);f.feedback.deliver('guest',{key:'a'},true);assert.equal(f.resumes,0);assert.equal(f.feedback.snapshot().audio,'needs-gesture');
});
test('ticks, sync updates and foreground return do not replay an occurrence',async()=>{
 const f=fixture();f.feedback.setPreference('sound',true);await f.feedback.test();const item={key:'a',occurredAt:'2026-10-09'};
 f.feedback.deliver('guest',item,true);assert.equal(f.tones,2);
 for(let i=0;i<10;i++){f.advance();f.feedback.deliver('guest',{...item},true);}
 f.hide();f.show();f.feedback.deliver('guest',item,true);assert.equal(f.tones,2);
});
test('suppressed and hidden reminders remain eligible when allowed, catch-up is quiet',()=>{
 const f=fixture();f.feedback.setPreference('vibration',true);
 f.feedback.deliver('guest',{key:'quiet'},false);f.hide();f.feedback.deliver('guest',{key:'quiet'},true);
 assert.equal(f.vibrations.filter(Array.isArray).length,0);
 f.show();f.feedback.deliver('guest',{key:'quiet'},true);f.feedback.deliver('guest',{key:'backlog'},true);
 assert.equal(f.vibrations.filter(Array.isArray).length,1);f.advance();f.feedback.deliver('guest',{key:'backlog'},true);assert.equal(f.vibrations.filter(Array.isArray).length,1);
});
test('new occurrences and snoozes play once; accounts use separate dedupe identities',()=>{
 const f=fixture();f.feedback.setPreference('vibration',true);
 for(const [scope,item] of [['guest',{key:'test',occurredAt:'1'}],['guest',{key:'test',occurredAt:'2'}],['guest',{key:'test',occurredAt:'2',availableAt:'later'}],['user:other',{key:'test',occurredAt:'1'}]] as const){f.advance();f.feedback.deliver(scope,item,true);}
 assert.equal(f.vibrations.filter(Array.isArray).length,4);
 f.advance();f.feedback.deliver('guest',{key:'test',occurredAt:'1'},true);assert.equal(f.vibrations.filter(Array.isArray).length,4);
});
test('storage failure is visible and cross-tab disable stops outputs',async()=>{
 const blocked=fixture({storageFails:true});blocked.feedback.setPreference('sound',true);assert.match(blocked.feedback.snapshot().storageWarning,/未保存/);
 const f=fixture();f.feedback.setPreference('sound',true);await f.feedback.test();f.saved.set(FEEDBACK_KEY,'{}');f.feedback.refreshPreferences();assert.equal(f.feedback.snapshot().sound,false);assert.ok(f.stops>1);
});
test('hardware refusal and exceptions never claim vibration success',async()=>{
 for(const throws of [false,true]){
  const f=fixture();f.feedback.env.vibrate=()=>{if(throws)throw Error('unsupported');return false;};f.feedback.setPreference('vibration',true);await f.feedback.test();assert.match(f.feedback.snapshot().message,/未接受/);
 }
});
