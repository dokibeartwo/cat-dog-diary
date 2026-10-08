import {D,Diary,P,R} from './rules';
export type Task={id:string;title:string;completed:boolean;steps:any[];[key:string]:any};
export type State={version:1;preview:boolean;datasetKind?:'personal';habitEvents?:any[];categories?:any[];revision:number;theme:string;tasks:Task[];habits:any[];pendingReminders:any[];reminderHistory:any[];focusTimer:any;focusHistory:any[];preferences:any;presence:any;stage:any;trash:any[];lastScreen:number};
export type Command={type:string;[key:string]:any};
export const date=(value:Date|number=new Date())=>D.toLocalDateInput(new Date(value));
export const id=()=>`preview-${Date.now().toString(36)}-${Array.from(crypto.getRandomValues(new Uint32Array(2)),n=>n.toString(36)).join('')}`;
export const clone=<T,>(v:T):T=>JSON.parse(JSON.stringify(v));
export const addDays=(days:number,now=Date.now())=>{const d=new Date(now);d.setDate(d.getDate()+days);return date(d);};
export const modeLabel=(mode:string)=>({focus:'专注',shortBreak:'短休',longBreak:'长休'}[mode]||'专注');
export const timeText=(seconds:number)=>`${Math.floor(seconds/60).toString().padStart(2,'0')}:${Math.floor(seconds%60).toString().padStart(2,'0')}`;
export const remaining=(s:State,now=Date.now())=>Math.min(s.focusTimer.durationMinutes*60,D.getFocusRemainingSeconds(s.focusTimer,now));
export function newTask(now=Date.now()):Task{return {id:id(),title:'',completed:false,steps:[],createdAt:new Date(now).toISOString(),scheduleMode:'fixed',dueAt:null,planDate:null,deadlineDate:null,deadlineReminderDays:3,priority:'normal',priorityDate:null,category:'工作',notes:'',estimateMinutes:25,recurrence:{kind:'none'},reminderMode:'none',reminderMinutes:10,reminderActive:false,reminderPresentation:'fullscreen',urgentReminder:false,inStage:true};}
export function seed(now=Date.now()):State{
  const task=(title:string,extra:any)=>({...newTask(now),title,...extra});
  const tasks=[task('给重要的事，留一点专注时间',{id:'sample-focus',scheduleMode:'day',planDate:date(now),priority:'high',priorityDate:date(now),notes:'这是示例任务，可以放心编辑。把大任务拆成小步，慢慢完成。',steps:[{id:'step-1',title:'整理今天要推进的内容',completed:true},{id:'step-2',title:'专注完成最重要的一小步',completed:false},{id:'step-3',title:'记录进展，安排下一步',completed:false}]}),task('继续推进我的长期计划',{id:'sample-long',scheduleMode:'ongoing',category:'学习',reminderMode:'interval',reminderMinutes:30,reminderActive:true,deadlineDate:addDays(5,now),estimateMinutes:45}),task('晚一点，和伙伴聊聊进展',{id:'sample-meeting',dueAt:new Date(now+2*3600000).toISOString(),reminderMode:'event',reminderMinutes:10,reminderActive:true,category:'工作'}),task('给自己安排一次散步',{id:'sample-backlog',scheduleMode:'backlog',category:'生活',estimateMinutes:20}),task('整理昨天还没完成的笔记',{id:'sample-old',scheduleMode:'day',planDate:addDays(-1,now),category:'学习'}),task('开启今天的小计划',{id:'sample-done',scheduleMode:'day',planDate:date(now),completed:true,completedAt:new Date(now).toISOString(),category:'生活'})];
  for(const t of tasks)t.nextReminderAt=t.reminderActive?D.calculateNextReminderAt(t,new Date(now)):null;
  const habits=[{id:'habit-water',title:'喝水，起来走走',icon:'water',intervalMinutes:60},{id:'habit-rest',title:'放松眼睛和肩颈',icon:'leaf',intervalMinutes:45}].map(h=>({...h,scheduleType:'interval',time:'08:00',active:false,completionCount:0,reminderPresentation:'fullscreen',days:[0,1,2,3,4,5,6],windowEnabled:false,windowStart:'09:00',windowEnd:'18:00',nextReminderAt:null}));
  return {version:1,preview:true,revision:0,theme:'bg1',tasks,habits,pendingReminders:[],reminderHistory:[],focusTimer:R.normalizeFocus(),focusHistory:[],preferences:{...Diary.preferences(),notificationEnabled:false,reminderInterval:30},presence:{active:false},stage:{start:date(now),end:addDays(14,now),dailyCapacity:3,dailyMinutes:120,workdaysOnly:false},trash:[],lastScreen:0};
}
export function personalSeed(now=Date.now()):State{
  return {...seed(now),preview:false,datasetKind:'personal',tasks:[],habits:[],habitEvents:[]};
}
function finishTask(s:State,t:Task,completed:boolean,now:number){
  if(t.completed===completed)return;
  if(completed&&s.focusTimer.taskId===t.id&&s.focusTimer.status!=='idle'){P.recordSession(s,'interrupted',now);R.updateFocus(s.focusTimer,{action:'stop'},now);}
  t.completed=completed;t.completedAt=completed?new Date(now).toISOString():null;
  if(completed){t.steps=t.steps.map(p=>({...p,completed:true}));t.nextReminderAt=null;s.pendingReminders=s.pendingReminders.filter(r=>r.taskId!==t.id);const child=Diary.spawnNext(s,t,id,new Date(now));if(child&&child.reminderActive)child.nextReminderAt=D.calculateNextReminderAt(child,new Date(now));}
  else t.nextReminderAt=t.reminderActive?D.calculateNextReminderAt(t,new Date(now)):null;
}
function screen(s:State){const next=D.chooseNextScreenId(`screen${s.lastScreen}`);s.lastScreen=Number(next.slice(-1));return next;}
function advance(s:State,now:number){
  R.reconcile(s);
  const done=R.finishFocus(s,now);if(done)R.enqueue(s,{...done,screenId:done.screenId||screen(s)});
  for(const r of R.collectDue(s,now))R.enqueue(s,{...r,screenId:screen(s)});
  for(const t of s.tasks)if(D.shouldRemindDeadlineOnStartup(t,t.deadlineLastRemindedDate,new Date(now))){t.deadlineLastRemindedDate=date(now);R.enqueue(s,{key:`deadline:${t.id}:${date(now)}`,type:'deadline',taskId:t.id,title:t.title,subtitle:`最晚截止 ${t.deadlineDate}`,occurredAt:new Date(now).toISOString(),screenId:screen(s)});}
}
function validTask(raw:Task):Task{
  if(!raw.title?.trim())throw Error('先写下要做的事情吧');
  if(raw.title.length>120)throw Error('任务名称最多 120 个字');
  const t={...raw,...Diary.taskFields(raw),steps:P.normalizeSteps(raw.steps),title:raw.title.trim()};
  if(!['fixed','day','backlog','ongoing','auto'].includes(t.scheduleMode))throw Error('请选择推进方式');
  if(['fixed'].includes(t.scheduleMode)&&(!t.dueAt||!Number.isFinite(Date.parse(t.dueAt))))throw Error('请选择执行日期和时间');
  if(t.scheduleMode==='day'&&!t.planDate)throw Error('请选择计划日期');
  if(t.reminderMode==='event'&&!t.dueAt)throw Error('提前提醒需要明确的执行时间');
  if(t.recurrence.kind!=='none'&&!t.dueAt&&!t.planDate)throw Error('重复任务需要计划日期或时间');
  if(raw.deadlineDate&&!D.normalizeLocalDate(raw.deadlineDate))throw Error('最晚截止日期无效');
  if(!['none','event','interval'].includes(t.reminderMode))throw Error('请选择提醒规则');
  t.reminderMinutes=Math.max(t.reminderMode==='event'?0:1,Math.min(10080,Math.round(Number(t.reminderMinutes)||0)));
  t.deadlineReminderDays=Math.max(0,Math.min(365,Math.round(Number(t.deadlineReminderDays)||0)));
  t.reminderActive=t.reminderMode!=='none'&&t.reminderActive!==false;
  return t;
}
const ruleKey=(t:any)=>JSON.stringify([t.dueAt,t.reminderMode,t.reminderMinutes,t.reminderActive,t.deadlineDate,t.deadlineReminderDays]);
export function apply(input:State,cmd:Command,now=Date.now()):State{
  const s=clone(input);advance(s,now);
  const t=s.tasks.find(t=>t.id===cmd.id);
  switch(cmd.type){
    case 'tick':break;
    case 'theme':if(!D.THEME_IDS.includes(cmd.id))throw Error('主题不存在');s.theme=cmd.id;break;
    case 'saveTask':{
      const value=validTask(cmd.task),index=s.tasks.findIndex(x=>x.id===value.id),old=s.tasks[index];
      if(cmd.edit&&index<0)throw Error('任务已被删除，请返回清单');
      if(!old||ruleKey(value)!==ruleKey(old)){value.nextReminderAt=value.reminderActive?D.calculateNextReminderAt(value,new Date(now)):null;value.deadlineLastRemindedDate=null;s.pendingReminders=s.pendingReminders.filter(r=>r.taskId!==value.id);}
      else {value.nextReminderAt=old.nextReminderAt;value.deadlineLastRemindedDate=old.deadlineLastRemindedDate;}
      if(old){value.completed=old.completed;value.completedAt=old.completedAt;s.tasks[index]=value;}else s.tasks.unshift(value);break;
    }
    case 'complete':if(t)finishTask(s,t,cmd.completed??!t.completed,now);break;
    case 'priority':if(t)t.priorityDate=t.priorityDate===date(now)?null:date(now);break;
    case 'step':if(t){const step=t.steps.find(p=>p.id===cmd.stepId);if(step)step.completed=!step.completed;}break;
    case 'delete':if(t){if(s.focusTimer.taskId===t.id){P.recordSession(s,'interrupted',now);R.updateFocus(s.focusTimer,{action:'stop'},now);}s.trash.unshift({task:t,deletedAt:new Date(now).toISOString()});s.tasks=s.tasks.filter(x=>x.id!==t.id);s.pendingReminders=s.pendingReminders.filter(r=>r.taskId!==t.id);}break;
    case 'restore':{const item=s.trash.find(x=>x.task.id===cmd.id);if(item&&!s.tasks.some(x=>x.id===cmd.id)){item.task.nextReminderAt=item.task.reminderActive&&!item.task.completed?D.calculateNextReminderAt(item.task,new Date(now)):null;s.tasks.push(item.task);s.trash=s.trash.filter(x=>x!==item);}break;}
    case 'saveHabit':{
      const h={...cmd.habit,...Diary.habitFields(cmd.habit)};
      if(!h.title?.trim()||h.title.length>80)throw Error('每日坚持名称需为 1–80 个字');
      if(!h.days.length)throw Error('至少选择一周中的一天');
      if(h.scheduleType==='daily'&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(h.time))throw Error('请选择有效时间');
      h.intervalMinutes=Math.max(1,Math.min(1440,Math.round(Number(h.intervalMinutes)||60)));
      if(h.scheduleType==='daily'&&h.windowEnabled){const sample=new Date(`${date(now)}T${h.time}`);if(!Diary.habitAllowed({...h,active:true,days:[0,1,2,3,4,5,6]},sample))throw Error('固定时间必须位于允许提醒的时段内');}
      const previous=s.habits.find(x=>x.id===h.id);h.completionCount=previous?.completionCount||0;
      h.nextReminderAt=h.active?Diary.nextHabit(h,new Date(now)):null;s.habits=s.habits.filter(x=>x.id!==h.id);s.habits.push(h);s.pendingReminders=s.pendingReminders.filter(r=>r.habitId!==h.id);break;
    }
    case 'habitToggle':{const h=s.habits.find(x=>x.id===cmd.id);if(h){h.active=!h.active;h.nextReminderAt=h.active?Diary.nextHabit(h,new Date(now)):null;s.pendingReminders=s.pendingReminders.filter(r=>r.habitId!==h.id);}break;}
    case 'habitComplete':{const h=s.habits.find(x=>x.id===cmd.id);if(h){h.completionCount++;h.lastCompletedAt=new Date(now).toISOString();h.nextReminderAt=Diary.nextHabit(h,new Date(now));s.pendingReminders=s.pendingReminders.filter(r=>r.habitId!==h.id);Diary.history(s,{key:id(),title:h.title,type:'habit',habitId:h.id},'complete',now);}break;}
    case 'habitDelete':s.habits=s.habits.filter(x=>x.id!==cmd.id);s.pendingReminders=s.pendingReminders.filter(r=>r.habitId!==cmd.id);break;
    case 'focus':{
      if(cmd.sessionId!==undefined&&cmd.sessionId!==s.focusTimer.sessionId)throw Error('这一轮已变化，请重新操作');
      const f=s.focusTimer;
      if(cmd.action==='start'&&f.status==='idle'){
        if(cmd.taskId&&!s.tasks.some(x=>x.id===cmd.taskId&&!x.completed))throw Error('任务已完成或不存在');
        if(cmd.mode)R.updateFocus(f,{action:'select',mode:cmd.mode,durationMinutes:cmd.minutes},now);
        R.updateFocus(f,{action:'start'},now);const task=f.mode==='focus'?s.tasks.find(x=>x.id===cmd.taskId):undefined;P.beginTracking(f,task,now,true);f.taskId=task?.id||null;f.taskTitle=f.mode==='focus'?(task?.title||'自由专注'):modeLabel(f.mode);f.screenId=screen(s);
      }else if(cmd.action==='pause'&&f.status==='running'){P.closeSegment(f,now);R.updateFocus(f,{action:'pause'},now);}
      else if(cmd.action==='start'&&f.status==='paused'){R.updateFocus(f,{action:'start'},now);f.activeStartedAt=new Date(now).toISOString();}
      else if(cmd.action==='stop'){P.recordSession(s,'interrupted',now);R.updateFocus(f,{action:'stop'},now);}
      else if(cmd.action==='select')R.updateFocus(f,{action:'select',mode:cmd.mode,durationMinutes:cmd.minutes},now);
      if(cmd.newSessionId&&f.status==='running')f.sessionId=cmd.newSessionId;
      break;
    }
    case 'presence':s.presence=cmd.status?{active:true,status:D.normalizePresenceStatus(cmd.status),startedAt:new Date(now).toISOString(),screenId:screen(s)}:{active:false};break;
    case 'prefs':s.preferences={...s.preferences,...cmd.patch};break;
    case 'testReminder':{
      const item=cmd.taskId?s.tasks.find(x=>x.id===cmd.taskId):null;
      R.enqueue(s,{key:item?`task-test:${item.id}:${now}`:'test-preview',type:item?item.reminderMode:'test',taskId:item?.id,title:item?.title||'给自己一个小小的休息',subtitle:item?'循环提醒演示 · 未处理不堆积':'这是示例提醒，不会发送系统通知',detail:'放下手边的事，喝口水，看看远处。',presentation:cmd.presentation||'fullscreen',screenId:screen(s),occurredAt:new Date(now).toISOString()});break;
    }
    case 'ack':{
      const item=s.pendingReminders.find(r=>r.key===cmd.key);if(!item)break;
      if(item.type==='test'&&cmd.action==='snooze'){Diary.history(s,item,'snooze',now);item.availableAt=new Date(now+(cmd.minutes||10)*60000).toISOString();item.key=id();break;}
      R.acknowledge(s,cmd.key,cmd.action,cmd.minutes,now);
      if(cmd.action==='complete'&&item.taskId){const task=s.tasks.find(x=>x.id===item.taskId);if(task){const child=Diary.spawnNext(s,task,id,new Date(now));if(child?.reminderActive)child.nextReminderAt=D.calculateNextReminderAt(child,new Date(now));}}
      break;
    }
    case 'stage':s.stage={...cmd.stage};break;
    case 'applyPlan':{
      if(cmd.fingerprint!==JSON.stringify(s.tasks))throw Error('预览后任务发生变化，请重新生成安排');
      for(const change of cmd.plan.updates){const task=s.tasks.find(t=>t.id===change.id);if(task){Object.assign(task,change);task.nextReminderAt=task.reminderActive?D.calculateNextReminderAt(task,new Date(now)):null;}}
      s.stage={...cmd.stage};break;
    }
    case 'reset':if(!input.preview)throw Error('个人清单不能重置为示例');return seed(now);
    case 'import':if(!input.preview)throw Error('个人清单不接受示例备份');return validateBackup(cmd.data);
    default:throw Error('未支持的预览操作');
  }
  R.reconcile(s);
  if(JSON.stringify(s)===JSON.stringify(input))return input;
  s.revision=input.revision+1;return s;
}
export function makePlan(s:State,stage:any,now=Date.now()){
  if(D.calendarDays(`${stage.start}T00:00:00`,`${stage.end}T00:00:00`).length<=7)throw Error('阶段跨度需超过 7 天');
  return {plan:Diary.plan(s.tasks,stage,new Date(now)),fingerprint:JSON.stringify(s.tasks),stage};
}
export function validateBackup(value:any):State{
  if(value?.format!=='cat-dog-web-preview-v1'||value?.state?.preview!==true)throw Error('这里只接受手机预览导出的示例备份，不导入正式任务数据');
  const s=value.state;
  if(s.version!==1||!Array.isArray(s.tasks)||s.tasks.length>2000||!Array.isArray(s.habits)||!Array.isArray(s.trash)||!Array.isArray(s.focusHistory)||!s.preferences||!s.stage)throw Error('示例备份结构无效');
  const normalized=Diary.migrate({...s,schemaVersion:1});
  for(const t of normalized.tasks)validTask(t);
  const result={...seed(),...normalized,preview:true,version:1,theme:D.normalizeThemeId(s.theme),focusTimer:R.normalizeFocus(s.focusTimer)} as State;
  if(!Array.isArray(result.pendingReminders)||!Array.isArray(result.reminderHistory))throw Error('提醒数据无效');
  result.focusHistory=P.normalizeHistory(result.focusHistory);R.reconcile(result);return clone(result);
}
export const backup=(s:State)=>({format:'cat-dog-web-preview-v1',exportedAt:new Date().toISOString(),state:clone(s)});
export function visibleTasks(s:State,view:string,query='',category='',filter='all',now=Date.now()):Task[]{
  return D.sortTasks(s.tasks.filter(t=>(query||view==='all'||D.isTaskInView(t,view,{start:s.stage.start,end:s.stage.end},new Date(now)))&&(!query||P.matchesSearch(t,query))&&(!category||t.category===category)&&(filter==='all'||t.completed===(filter==='done'))));
}
