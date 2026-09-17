// Window intent is independent from native visibility and renderer readiness.
// Rebuilding a renderer never changes tasks, timers, or reminder state.
const crypto = require('node:crypto');
class WindowCoordinator {
  constructor(deps) {
    this.deps=deps; this.view='main'; this.miniWanted=deps.state()?.focusTimer.status!=='idle'&&Boolean(deps.state()?.preferences.widgetVisible); this.wasActive=false;
    this.records={widget:null,focus:null}; this.failures={widget:0,focus:0};
    this.blockedErrors={widget:false,focus:false}; this.error=null; this.sequence=0;
    this.syncing=false; this.stopped=false;
    this.defer=deps.setTimeout || setTimeout; this.cancel=deps.clearTimeout || clearTimeout;
  }
  active() { return this.deps.state()?.focusTimer?.status !== 'idle'; }
  blocked() { return this.deps.overlay() || null; }
  wanted(role) {
    if(role==='focus') return this.active() && this.view==='fullscreen';
    return this.active() ? this.view!=='fullscreen' && this.miniWanted : Boolean(this.deps.state()?.preferences.widgetVisible);
  }
  desired(role) { return this.wanted(role) && !this.blocked() && !this.blockedErrors[role]; }
  key(role) {
    const s=this.deps.state();
    return JSON.stringify([role,s?.preferences.themeId,s?.focusTimer.sessionId || null,role==='widget'&&this.active(),this.view]);
  }
  log(event,role,extra={}) { this.deps.log?.({event,role,view:this.view,...extra}); }
  changed() { this.deps.changed?.(); }
  state() {
    const widget=this.records.widget, focus=this.records.focus;
    return {
      focusView:this.view, focusWidget:this.active()&&this.view!=='fullscreen'&&this.miniWanted,
      widgetRequested:this.wanted('widget'), widgetVisible:Boolean(widget?.win && !widget.win.isDestroyed() && widget.win.isVisible()),
      widgetPhase:widget?.phase||'absent', focusPhase:focus?.phase||'absent',
      blockedBy:this.blocked() || (this.view==='fullscreen' ? 'fullscreen' : null), error:this.error
    };
  }
  resetRequest(role) {
    this.failures[role]=0;this.blockedErrors[role]=false;this.error=null;
    const rec=this.records[role];if(rec){rec.failed=false;rec.readyKey=null;rec.request=null;this.cancel(rec.timeout);}
  }
  requestFull() {
    if(!this.active())return;
    this.view='fullscreen';this.miniWanted=false;this.resetRequest('focus');this.sync();this.changed();
  }
  leaveFull(target) {
    if(!['main','widget'].includes(target))throw Error('无效的专注显示方式');
    this.view=target==='widget'&&this.active()?'widget':'main';this.miniWanted=this.view==='widget';
    if(this.miniWanted){this.resetRequest('widget');this.deps.hideMain();}
    else this.deps.showMain();
    this.sync();this.changed();
  }
  setWidget(enabled) {
    if(typeof enabled!=='boolean')throw Error('小组件显示状态必须是布尔值');
    if(this.active()) {this.view='widget';this.miniWanted=enabled;}
    else this.deps.setPreference(enabled);
    if(enabled)this.resetRequest('widget');
    this.sync();this.changed();return this.state();
  }
  finish() { this.view='main';this.miniWanted=false;this.wasActive=false;this.sync(); }
  ensure(role) {
    let rec=this.records[role];
    if(rec && !rec.win.isDestroyed())return rec;
    const win=this.deps.create(role);
    rec={win,generation:crypto.randomUUID(),phase:'loading',loaded:false,readyKey:null,request:null,timeout:null,failed:false,internal:false};
    this.records[role]=rec;
    const current=()=>this.records[role]===rec && !this.stopped && !this.deps.quitting();
    const lifecycle=(name,fn)=>win.on(name,(...args)=>{if(current())fn(...args);});
    // All handlers are installed BEFORE navigation.
    win.webContents.on('did-start-loading',()=>{
      if(!current())return;rec.loaded=false;rec.phase='loading';rec.readyKey=null;rec.request=null;
      this.hide(rec);this.arm(role,rec);this.log('load-start',role);this.changed();
    });
    win.webContents.on('did-finish-load',()=>{
      if(!current())return;rec.loaded=true;rec.phase='preparing';this.log('load-finish',role);this.prepare(role,rec);this.changed();
    });
    win.webContents.on('did-fail-load',(_e,code,_description,_url,isMainFrame)=>{
      if(current() && isMainFrame!==false && code!==-3)this.fail(role,rec,'load-failed');
    });
    win.webContents.on('render-process-gone',()=>{if(current())this.fail(role,rec,'renderer-gone');});
    lifecycle('unresponsive',()=>this.fail(role,rec,'unresponsive'));
    lifecycle('show',()=>{this.log('shown',role,{requestId:rec.request?.id});this.changed();});
    lifecycle('hide',()=>{if(!rec.internal)this.externalHide(role);});
    lifecycle('minimize',()=>{if(!rec.internal)this.externalHide(role);});
    lifecycle('close',event=>{if(!this.deps.quitting()){event.preventDefault();role==='focus'?this.leaveFull('widget'):this.setWidget(false);}});
    lifecycle('closed',()=>{this.log('closed',role);if(this.wanted(role))this.fail(role,rec,'window-closed');else this.records[role]=null;});
    this.log('created',role);this.arm(role,rec);
    Promise.resolve(this.deps.load(role,win)).catch(()=>{if(current())this.fail(role,rec,'navigation-rejected');});
    return rec;
  }
  externalHide(role) {
    if(this.blocked() || !this.wanted(role))return;
    if(role==='focus'){this.view='widget';this.miniWanted=true;this.resetRequest('widget');}
    else if(this.active())this.miniWanted=false;
    else this.deps.setPreference(false);
    this.log('external-hide',role);this.defer(()=>{this.sync();this.changed();},0);
  }
  hide(rec) {
    if(!rec || rec.win.isDestroyed())return;
    rec.internal=true;
    try{rec.win.hide();}finally{rec.internal=false;}
  }
  arm(role,rec) {
    this.cancel(rec.timeout);
    rec.timeout=this.defer(()=>{
      if(this.records[role]===rec && this.desired(role) && rec.readyKey!==this.key(role))this.fail(role,rec,'ready-timeout');
    },8000);
    rec.timeout?.unref?.();
  }
  prepare(role,rec) {
    if(!rec.loaded || rec.failed || rec.win.isDestroyed())return;
    const key=this.key(role);
    if(rec.request?.key===key)return;
    rec.request={id:++this.sequence,key};rec.phase='preparing';this.arm(role,rec);
    rec.win.webContents.send('ui:prepare',{generation:rec.generation,requestId:rec.request.id,state:this.deps.snapshot()});
    this.log('prepare',role,{requestId:rec.request.id});
  }
  context(sender) {
    for(const role of ['widget','focus']) {
      const rec=this.records[role];
      if(rec?.win.webContents===sender && !rec.win.isDestroyed()) {
        // Renderer bootstrap can ask before did-finish-load; bootstrap itself
        // proves script loading, but NOT frame readiness.
        rec.loaded=true;this.prepare(role,rec);
        return {generation:rec.generation,requestId:rec.request.id,state:this.deps.snapshot()};
      }
    }
    return null;
  }
  ready(sender,signal) {
    for(const role of ['widget','focus']) {
      const rec=this.records[role];
      if(!rec || rec.win.webContents!==sender || rec.failed || rec.generation!==signal?.generation || rec.request?.id!==signal.requestId || rec.request.key!==this.key(role))continue;
      rec.readyKey=rec.request.key;rec.phase='ready';this.cancel(rec.timeout);
      this.log('frame-ready',role,{requestId:signal.requestId});this.sync();this.changed();return true;
    }
    return false;
  }
  reportFailure(sender,signal) {
    for(const role of ['widget','focus']) {
      const rec=this.records[role];
      if(rec?.win.webContents===sender && rec.generation===signal?.generation && rec.request?.id===signal.requestId)this.fail(role,rec,'ui-initialization-failed');
    }
  }
  fail(role,rec,reason) {
    if(this.records[role]!==rec || rec.failed || this.stopped)return;
    rec.failed=true;rec.phase='error';this.cancel(rec.timeout);this.hide(rec);
    this.log('failed',role,{reason,retries:this.failures[role]});
    this.records[role]=null;if(!rec.win.isDestroyed())rec.win.destroy();
    if(!this.wanted(role)){this.changed();return;}
    if(this.failures[role]<1){this.failures[role]++;this.defer(()=>this.sync(),100);}
    else {
      this.blockedErrors[role]=true;
      this.error={role,message:role==='focus'?'专注画面加载失败，计时已保留。请重试或返回清单。':'小组件加载失败，任务和计时已保留。请重试。'};
      // Release a failed fullscreen's hold on all other windows.
      if(role==='focus')this.view='main';
      this.deps.showMain();this.changed();
    }
  }
  sync() {
    if(this.syncing || this.stopped || this.deps.quitting() || !this.deps.state())return;
    this.syncing=true;
    try {
      const active=this.active();
      if(!active && this.wasActive){this.view='main';this.miniWanted=false;}
      this.wasActive=active;
      for(const role of ['focus','widget']) {
        if(!this.desired(role)){this.hide(this.records[role]);continue;}
        const rec=this.ensure(role);if(!rec.loaded)continue;
        this.prepare(role,rec);
        if(rec.readyKey!==this.key(role))continue;
        if(!rec.win.isVisible()) {
          if(rec.win.isMinimized())rec.win.restore();
          if(role==='focus') {
            // Fullscreen is requested only AFTER business UI, fonts and assets
            // have rendered. A cold empty page is never shown fullscreen.
            rec.win.show();rec.win.setFullScreen(true);rec.win.focus();
          } else rec.win.showInactive();
        }
      }
    } finally {this.syncing=false;}
  }
  dispose() {this.stopped=true;for(const rec of Object.values(this.records))if(rec)this.cancel(rec.timeout);}
}
module.exports={WindowCoordinator};
