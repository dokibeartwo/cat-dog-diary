'use strict';
const domain = require('../../../src/shared/domain');
const diary = require('../../../src/shared/diary-v1');
const { stable } = require('./replica');
const day = now => domain.toLocalDateInput(new Date(now));
function todayTasks(tasks,now=Date.now()) {
  const today=day(now);
  return tasks.filter(t => !t.completed && (t.scheduleMode==='ongoing' || (t.planDate && t.planDate<=today) || (t.dueAt && day(t.dueAt)<=today) || (t.deadlineDate && t.deadlineDate<=today)));
}
function reminderSpecs(tasks,habits,focus,now=Date.now()) {
  const result=[];
  const add=(key,type,item,at,rule) => {if(at && Number.isFinite(Date.parse(at))) result.push({key,type,sourceId:item.id,title:item.title,at:new Date(at).toISOString(),rule:stable(rule)});};
  for(const t of tasks.filter(t=>!t.completed)) {
    if(t.reminderMode && t.reminderMode!=='none' && t.reminderActive!==false) {
      const rule={mode:t.reminderMode,dueAt:t.dueAt,minutes:t.reminderMinutes};
      add(`${t.reminderMode}:${t.id}`,t.reminderMode,t,domain.calculateNextReminderAt(t,new Date(now)),rule);
    }
    const info=domain.deadlineReminderInfo(t,new Date(now));
    if(info) {
      const start=new Date(`${t.deadlineDate}T09:00:00`); start.setDate(start.getDate()-(t.deadlineReminderDays ?? 3));
      add(`deadline:${t.id}`,'deadline',t,info.shouldRemind?new Date(now).toISOString():start.toISOString(),{date:t.deadlineDate,days:t.deadlineReminderDays,day:day(now)});
    }
  }
  for(const h of habits.filter(h=>h.active!==false)) add(`habit:${h.id}`,'habit',h,diary.nextHabit(h,new Date(now)),
    {mode:h.scheduleType,minutes:h.intervalMinutes,time:h.time,days:h.days,window:h.windowEnabled,start:h.windowStart,end:h.windowEnd,timezone:new Date(now).getTimezoneOffset()});
  if(focus?.sessionId && (focus.running || (focus.completed && !focus.endedEarly))) add(`focus:${focus.sessionId}`,'focus',{id:focus.sessionId,title:focus.mode==='focus'?'这一轮专注完成啦':'休息结束啦'},focus.endsAt,{endsAt:focus.endsAt});
  return result;
}
// One outstanding occurrence per source. Wall time advancing does not queue
// missed intervals. Only acknowledgement starts the next interval.
function reconcileReminders(previous,specs,now=Date.now(),focus=null) {
  const rows=[];
  for(const spec of specs) {
    let old=previous.find(r=>r.key===spec.key && r.rule===spec.rule);
    // Keep the acknowledgement marker while its rule still exists. Removing
    // it would make the very next rebuild create the same alert again.
    if(old?.handledAt && ['event','deadline','focus'].includes(spec.type)) { rows.push({...old,pending:false,deferred:false}); continue; }
    if(old?.handledAt && spec.type==='habit') old={...old,handledAt:null,pending:false,at:spec.at,notificationId:null};
    const entry=old ? {...old,title:spec.title} : {...spec,notificationId:null,handledAt:null,pending:false};
    if(!entry.handledAt && Date.parse(entry.at)<=now) entry.pending=true;
    entry.deferred=Boolean(focus?.sessionId && !focus.completed && focus.mode==='focus' && ['habit','interval'].includes(entry.type));
    rows.push(entry);
  }
  return rows;
}
function acknowledgeReminder(rows,key,action,now=Date.now(),minutes=10) {
  return rows.map(row=>row.key!==key?row:{...row,pending:false,notificationId:null,
    handledAt:action==='snooze'?null:new Date(now).toISOString(),
    at:action==='snooze'?new Date(now+minutes*60000).toISOString():row.at});
}
function validateTaskDraft(value) {
  if(!String(value.title||'').trim()) throw Error('请填写任务名称');
  if(value.planDate && !domain.normalizeLocalDate(value.planDate)) throw Error('日期格式应为 YYYY-MM-DD');
  if(value.deadlineDate && !domain.normalizeLocalDate(value.deadlineDate)) throw Error('截止日期格式应为 YYYY-MM-DD');
  if(value.dueAt && !Number.isFinite(Date.parse(value.dueAt))) throw Error('执行时间无效');
  if(value.reminderMode==='event' && !value.dueAt) throw Error('提前提醒需要执行时间');
  return {...value,title:value.title.trim().slice(0,120)};
}
function focusRemaining(focus,now=Date.now()) {return Math.max(0,Math.ceil(focus.running?(Date.parse(focus.endsAt)-now)/1000:Number(focus.pausedRemainingSec||0)));}
module.exports={day,todayTasks,reminderSpecs,reconcileReminders,acknowledgeReminder,validateTaskDraft,focusRemaining};
