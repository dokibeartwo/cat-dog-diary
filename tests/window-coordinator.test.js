const test=require('node:test');const assert=require('node:assert/strict');const {EventEmitter}=require('node:events');
const {WindowCoordinator}=require('../src/window-coordinator');
function fixture(){
  const state={focusTimer:{status:'idle',sessionId:null},preferences:{widgetVisible:false,themeId:'bg1'}};
  let overlay=null,now=0,id=0,shownMain=0;const timers=new Map(),created=[],logs=[];
  class Win extends EventEmitter{
    constructor(role){super();this.role=role;this.visible=false;this.dead=false;this.webContents=new EventEmitter();this.webContents.send=(name,payload)=>{if(name==='ui:prepare')this.request=payload;};}
    isDestroyed(){return this.dead;}isVisible(){return this.visible;}isMinimized(){return false;}restore(){}focus(){}setFullScreen(value){this.full=value;}
    show(){this.visible=true;this.emit('show');}showInactive(){this.show();}hide(){if(this.visible){this.visible=false;this.emit('hide');}}
    destroy(){this.dead=true;this.visible=false;this.emit('closed');}
  }
  const coordinator=new WindowCoordinator({state:()=>state,snapshot:()=>({...state,presentation:coordinator.state()}),overlay:()=>overlay,
    create:role=>{const win=new Win(role);created.push(win);return win;},load:(_role,win)=>win.webContents.emit('did-start-loading'),
    changed(){},hideMain(){},showMain(){shownMain++;},setPreference:value=>{state.preferences.widgetVisible=value;},quitting:()=>false,
    setTimeout:(fn,delay)=>{const key=++id;timers.set(key,{at:now+delay,fn});return key;},clearTimeout:key=>timers.delete(key),log:entry=>logs.push(entry)});
  const advance=ms=>{now+=ms;for(const [key,item]of [...timers])if(item.at<=now){timers.delete(key);item.fn();}};
  const loaded=role=>coordinator.records[role].win.webContents.emit('did-finish-load');
  const ack=role=>{const win=coordinator.records[role].win;return coordinator.ready(win.webContents,win.request);};
  return {state,coordinator,created,logs,advance,loaded,ack,setOverlay:value=>{overlay=value;coordinator.sync();},mainShows:()=>shownMain};
}
test('load and native first-paint events alone never reveal an unprepared frame',()=>{
  const f=fixture();f.coordinator.setWidget(true);const w=f.created[0];
  w.emit('ready-to-show');f.loaded('widget');assert.equal(w.isVisible(),false);
  assert.equal(f.ack('widget'),true);assert.equal(w.isVisible(),true);
});
test('late acknowledgement cannot reopen a cancelled display request',()=>{
  const f=fixture();f.coordinator.setWidget(true);f.loaded('widget');const w=f.created[0],signal=w.request;
  f.coordinator.setWidget(false);f.coordinator.ready(w.webContents,signal);assert.equal(w.isVisible(),false);
  f.coordinator.setWidget(true);assert.equal(f.coordinator.ready(w.webContents,signal),false);
  f.ack('widget');assert.equal(w.isVisible(),true);
});
test('missing ready rebuilds once then exposes a recoverable error',()=>{
  const f=fixture();f.coordinator.setWidget(true);f.advance(8001);f.advance(100);
  assert.equal(f.created.length,2);f.advance(8001);f.advance(10000);
  assert.equal(f.created.length,2);assert.equal(f.coordinator.state().error.role,'widget');assert.equal(f.mainShows(),1);
  f.coordinator.setWidget(true);f.loaded('widget');f.ack('widget');assert.equal(f.coordinator.state().error,null);
});
test('old renderer generation is rejected after rebuilding',()=>{
  const f=fixture();f.coordinator.setWidget(true);f.loaded('widget');const old=f.created[0],signal=old.request;
  old.webContents.emit('render-process-gone');f.advance(100);f.loaded('widget');
  assert.equal(f.coordinator.ready(old.webContents,signal),false);f.ack('widget');assert.equal(f.created[1].isVisible(),true);
});
test('explicit widget request clears hidden fullscreen intent and leaves daily preference alone',()=>{
  const f=fixture();f.state.focusTimer={status:'running',sessionId:'abc'};f.coordinator.requestFull();f.loaded('focus');f.ack('focus');
  f.coordinator.setWidget(true);f.loaded('widget');f.ack('widget');
  assert.equal(f.coordinator.state().focusView,'widget');assert.equal(f.coordinator.state().widgetRequested,true);
  assert.equal(f.coordinator.state().widgetVisible,true);assert.equal(f.state.preferences.widgetVisible,false);assert.equal(f.created[0].isVisible(),false);
});
test('overlay suppresses actual visibility while preserving intent',()=>{
  const f=fixture();f.coordinator.setWidget(true);f.loaded('widget');f.ack('widget');f.setOverlay('presence');
  assert.equal(f.coordinator.state().widgetRequested,true);assert.equal(f.coordinator.state().widgetVisible,false);
  f.setOverlay(null);assert.equal(f.coordinator.state().widgetVisible,true);
});
test('focus recovery never resets the timer or session',()=>{
  const f=fixture();f.state.focusTimer={status:'paused',sessionId:'same',pausedRemainingSeconds:1234};f.coordinator.requestFull();f.loaded('focus');f.ack('focus');
  f.created[0].webContents.emit('render-process-gone');f.advance(100);f.loaded('focus');f.ack('focus');
  assert.deepEqual(f.state.focusTimer,{status:'paused',sessionId:'same',pausedRemainingSeconds:1234});
});
test('external minimize releases fullscreen state and can show compact view',()=>{
  const f=fixture();f.state.focusTimer={status:'running',sessionId:'x'};f.coordinator.requestFull();f.loaded('focus');f.ack('focus');
  f.created[0].emit('minimize');f.advance(0);f.loaded('widget');f.ack('widget');
  assert.equal(f.coordinator.state().focusView,'widget');assert.equal(f.coordinator.state().widgetVisible,true);
});
