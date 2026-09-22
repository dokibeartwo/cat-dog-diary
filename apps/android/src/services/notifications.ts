import * as Notifications from 'expo-notifications';
import { AppState, Platform, Linking } from 'react-native';
import * as IntentLauncher from 'expo-intent-launcher';
import { activeDataset,getMeta,setMeta,listTasks,listHabits } from './local-db';
const rules=require('../../../../packages/core/src/mobile-rules');
const diary=require('../../../../src/shared/diary-v1');
export type Reminder = {key:string;type:string;sourceId:string;title:string;at:string;rule:string;pending:boolean;deferred:boolean;handledAt?:string|null;notificationId?:string|null;scheduledAt?:string|null};
const metaKey=()=>`reminders.${activeDataset()}`;
const channel=()=>getMeta('notifications.vibrate',true)?'reminders-vibrate':'reminders-quiet';
let operations:Promise<unknown>=Promise.resolve();
// Scheduling, acknowledgement and account cleanup share one queue. A slower
// rebuild must never write its pre-click snapshot over an acknowledged alert.
function exclusive<T>(work:()=>Promise<T>):Promise<T>{
  const next=operations.then(work,work);operations=next.then(()=>undefined,()=>undefined);return next;
}
let running:{dataset:string;promise:Promise<Reminder[]>}|null=null;
Notifications.setNotificationHandler({handleNotification:async()=>({shouldShowBanner:AppState.currentState!=='active',shouldShowList:AppState.currentState!=='active',shouldPlaySound:AppState.currentState!=='active',shouldSetBadge:false,priority:Notifications.AndroidNotificationPriority.HIGH})});
export async function configureNotifications(request=false) {
  if(Platform.OS==='android') for(const vibrate of [true,false]) await Notifications.setNotificationChannelAsync(vibrate?'reminders-vibrate':'reminders-quiet',{
    name:vibrate?'醒目提醒（震动）':'提醒（不震动）',importance:Notifications.AndroidImportance.MAX,
    enableVibrate:vibrate,vibrationPattern:vibrate?[0,250,120,250]:undefined,lockscreenVisibility:Notifications.AndroidNotificationVisibility.PUBLIC,sound:'default'
  });
  const current=await Notifications.getPermissionsAsync();
  return request && !current.granted ? Notifications.requestPermissionsAsync() : current;
}
export function reminderRows():Reminder[] {return getMeta<Reminder[]>(metaKey(),[]);}
async function rebuildDataset(dataset:string):Promise<Reminder[]> {
    if(dataset!==activeDataset())return reminderRows();
    const key=`reminders.${dataset}`,now=Date.now();
    const [tasks,habits,permission]=await Promise.all([listTasks(dataset),listHabits(dataset),Notifications.getPermissionsAsync()]);
    if(dataset!==activeDataset()) return reminderRows();
    const focus=getMeta(`focus.state.${dataset}`,null);
    const old=getMeta<Reminder[]>(key,[]),specs=rules.reminderSpecs(tasks,habits,focus,now);
    const rows=rules.reconcileReminders(old,specs,now,focus) as Reminder[];
    for(const entry of old) if(!permission.granted || !rows.some(r=>r.key===entry.key&&r.rule===entry.rule) || rows.find(r=>r.key===entry.key)?.deferred) {
      if(entry.notificationId) {await Notifications.cancelScheduledNotificationAsync(entry.notificationId);await Notifications.dismissNotificationAsync(entry.notificationId);}
    }
    for(const row of rows) {
      if(dataset!==activeDataset())break;
      if(row.deferred||!permission.granted){row.notificationId=null;row.scheduledAt=null;}
      if(row.handledAt||row.deferred||!permission.granted) continue;
      const id=`catdog.${dataset}.${row.key}`;
      if(row.notificationId===id && row.scheduledAt===row.at) continue;
      await Notifications.scheduleNotificationAsync({identifier:id,
        content:{title:row.title,body:row.type==='deadline'?'快到最晚截止日期了，记得推进这件事。':'到提醒时间啦，点击查看或稍后提醒。',sound:'default',vibrate:getMeta('notifications.vibrate',true)?[0,250,120,250]:[],data:{reminderKey:row.key,dataset}},
        trigger:{type:Notifications.SchedulableTriggerInputTypes.DATE,date:new Date(Math.max(now+1000,Date.parse(row.at))),channelId:channel()}});
      row.notificationId=id;row.scheduledAt=row.at;
    }
    if(dataset!==activeDataset()){
      for(const row of rows)if(row.notificationId){await Notifications.cancelScheduledNotificationAsync(row.notificationId);await Notifications.dismissNotificationAsync(row.notificationId);}
      return reminderRows();
    }
    setMeta(key,rows);
    return rows;
}
export function rebuildReminders():Promise<Reminder[]> {
  const dataset=activeDataset();if(running?.dataset===dataset)return running.promise;
  const request={dataset,promise:exclusive(()=>rebuildDataset(dataset))};running=request;
  void request.promise.then(()=>{if(running===request)running=null;},()=>{if(running===request)running=null;});
  return request.promise;
}
export function handleReminder(key:string,action:'ack'|'snooze',minutes=10,occurrence?:Pick<Reminder,'at'|'rule'>):Promise<void> {
  const dataset=activeDataset(),expected=occurrence||reminderRows().find(r=>r.key===key);
  return exclusive(async()=>{
  if(dataset!==activeDataset()||!expected)return;
  const rows=reminderRows(),entry=rows.find(r=>r.key===key);
  if(!entry||entry.at!==expected.at||entry.rule!==expected.rule||entry.handledAt)return;
  if(entry.notificationId){await Notifications.cancelScheduledNotificationAsync(entry.notificationId);await Notifications.dismissNotificationAsync(entry.notificationId);}
  if(dataset!==activeDataset())return;
  const now=Date.now();
  let updated=rules.acknowledgeReminder(rows,key,action,now,minutes) as Reminder[];
  if(action==='ack'&&['interval','habit'].includes(entry.type)) {
    const spec=JSON.parse(entry.rule);let at:string|null=null;
    if(entry.type==='interval')at=new Date(now+Math.max(1,Number(spec.minutes)||30)*60000).toISOString();
    else {const habit=(await listHabits(dataset)).find(h=>h.id===entry.sourceId);if(habit)at=diary.nextHabit(habit,new Date(now));}
    updated=updated.map(r=>r.key===key?{...r,handledAt:null,at:at||r.at,scheduledAt:null,notificationId:null}:r);
  }else if(action==='ack'&&entry.type==='event'){
    const dueAt=JSON.parse(entry.rule).dueAt;
    // Match Windows: handling the advance warning still leaves the actual
    // appointment reminder. An unhandled warning never creates a second card.
    if(Date.parse(dueAt)>now)updated=updated.map(r=>r.key===key?{...r,handledAt:null,at:dueAt,scheduledAt:null,notificationId:null}:r);
  }
  if(dataset!==activeDataset())return;
  setMeta(`reminders.${dataset}`,updated);await rebuildDataset(dataset);
  });
}
export function clearDeviceNotifications():Promise<void>{
  const dataset=activeDataset();return exclusive(async()=>{
  if(dataset!==activeDataset())return;
  await Notifications.cancelAllScheduledNotificationsAsync();await Notifications.dismissAllNotificationsAsync();
  // OS notifications are gone; don't keep identifiers that would make the
  // next rebuild incorrectly assume they are still scheduled.
  const key=`reminders.${dataset}`;
  setMeta(key,getMeta<Reminder[]>(key,[]).map(r=>({...r,notificationId:null,scheduledAt:null})));
  });
}
export async function openExactAlarmSettings():Promise<void> {
  if(Platform.OS==='android') {
    try{await IntentLauncher.startActivityAsync('android.settings.REQUEST_SCHEDULE_EXACT_ALARM',{data:'package:com.dokibeartwo.catdogdiary'});}
    catch{await Linking.openSettings();}
  }
}
export async function openNotificationSettings():Promise<void>{await Linking.openSettings();}
export { Notifications };
