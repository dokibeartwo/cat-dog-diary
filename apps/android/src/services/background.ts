import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import {getAuthState} from './auth';
import {activeDataset,getMeta,localStore,readReplica,setMeta} from './local-db';
import {createSupabaseAdapter,SyncService} from './sync';
import {rebuildReminders} from './notifications';
import {finishFocus,readFocus,remaining} from './focus';
const TASK='cat-dog-background-sync-v1';
TaskManager.defineTask(TASK,async()=>{
  let ok=true;
  try{
    const auth=await getAuthState(),owner=getMeta<string>(`dataset.owner.${activeDataset()}`,'');
    const adapter=createSupabaseAdapter();
    // Never switch accounts or confirm first merge in a background worker.
    if(adapter&&auth.userId===owner&&readReplica().migrated&&!getMeta('sync.paused',false))await new SyncService(localStore,adapter).run();
    const focus=readFocus();if(focus.running&&remaining(focus)===0)await finishFocus();
  }catch{ok=false;setMeta('background.lastErrorAt',new Date().toISOString());}
  try{await rebuildReminders();}catch{ok=false;}
  setMeta('background.lastRunAt',new Date().toISOString());
  return ok?BackgroundTask.BackgroundTaskResult.Success:BackgroundTask.BackgroundTaskResult.Failed;
});
export async function registerBackgroundSync():Promise<void>{
  if(!await TaskManager.isTaskRegisteredAsync(TASK))await BackgroundTask.registerTaskAsync(TASK,{minimumInterval:15});
}
