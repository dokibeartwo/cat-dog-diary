import {apply,seed,State,Command} from './model';
import {RecordData,FocusLease,newRecord,recordChange,guardFocusLease} from './sync-model';
const PREVIEW='cat-dog-diary-clickable-preview-v1',PERSONAL='cat-dog-diary-personal-v2';
let previewDB:IDBDatabase,personalDB:IDBDatabase,snapshot:State,record:RecordData|undefined;
let route='preview',appliedRoute='',epoch=0;const listeners=new Set<()=>void>();
const channels:BroadcastChannel[]=[];
export const getSnapshot=()=>snapshot;
export const getRecord=()=>record;
export const activeDataset=()=>route;
export const generation=()=>epoch;
export const subscribe=(cb:()=>void)=>{listeners.add(cb);return()=>{listeners.delete(cb);};};
const notify=()=>listeners.forEach(cb=>cb());
export function deviceId(){let value=localStorage.getItem('diary-web-device-v2');if(!value){value=crypto.randomUUID();localStorage.setItem('diary-web-device-v2',value);}return value;}
function open(name:string,store:string):Promise<IDBDatabase>{return new Promise((resolve,reject)=>{const req=indexedDB.open(name,1);req.onupgradeneeded=()=>req.result.createObjectStore(store);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(Error('浏览器无法保存数据，请使用普通浏览器窗口。'));});}
const deletedError=()=>Object.assign(Error('这个账号已删除，请重新登录'),{accountDeleted:true});
export function readRecord(key=route):Promise<RecordData>{return new Promise((resolve,reject)=>{const req=personalDB.transaction('datasets','readonly').objectStore('datasets').get(key);req.onsuccess=()=>req.result?.accountDeleted?reject(deletedError()):resolve(req.result||newRecord());req.onerror=()=>reject(req.error);});}
async function refresh(){const start=epoch,key=route;
 const data=key==='preview'?await new Promise<State>((resolve,reject)=>{const req=previewDB.transaction('preview').objectStore('preview').get('state');req.onsuccess=()=>resolve(req.result||seed());req.onerror=()=>reject(req.error);}):await readRecord(key);
 if(start!==epoch)return;
 if(key===appliedRoute){if(key==='preview'&&(data as State).revision<snapshot.revision)return;if(key!=='preview'&&((data as RecordData).sequence||0)<(record?.sequence||0))return;}
 if(key==='preview'){snapshot=data as State;record=undefined;}else{record=data as RecordData;snapshot=record.state;}appliedRoute=key;notify();
}
export async function switchDataset(key:string){
 if(!/^(preview|guest|user:[a-zA-Z0-9_-]{1,128})$/.test(key))throw Error('数据分区无效');
 if(route===key&&snapshot)return;
 route=key;epoch++;localStorage.setItem('diary-web-mode',key==='preview'?'preview':'personal');try{await refresh();}catch(e){if((e as any)?.accountDeleted){await switchDataset('guest');}throw e;}
}
export async function initialize(){
 [previewDB,personalDB]=await Promise.all([open(PREVIEW,'preview'),open(PERSONAL,'datasets')]);
 await new Promise<void>((resolve,reject)=>{const tx=previewDB.transaction('preview','readwrite'),table=tx.objectStore('preview'),req=table.get('state');req.onsuccess=()=>{if(!req.result)table.put(seed(),'state');};tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);});
 route=localStorage.getItem('diary-web-mode')==='personal'?'guest':'preview';await refresh();
 if('BroadcastChannel'in globalThis)for(const name of [PREVIEW,PERSONAL]){const channel=new BroadcastChannel(name);channel.onmessage=e=>{if(e.data?.deleted===route)void switchDataset('guest');else void refresh().catch(()=>{});};channels.push(channel);}
 window.addEventListener('focus',()=>void refresh().catch(()=>{}));return snapshot;
}
export function transact(change:(record:RecordData,guest?:RecordData)=>void,key=route,start=epoch,includeGuest=false):Promise<RecordData>{return new Promise((resolve,reject)=>{
 if(key==='preview'||key!==route||start!==epoch){reject(Error('账号或清单已变化，请重新操作'));return;}
 const tx=personalDB.transaction('datasets','readwrite'),table=tx.objectStore('datasets'),req=table.get(key),guestReq=includeGuest?table.get('guest'):undefined;let next:RecordData,error:unknown,changed=false;
 const commit=()=>{try{if(start!==epoch||key!==route)throw Error('账号已变化');if(req.result?.accountDeleted)throw deletedError();next=req.result||newRecord();const before=JSON.stringify(next);change(next,guestReq?(guestReq.result||newRecord()):undefined);changed=before!==JSON.stringify(next);if(changed){next.sequence=(next.sequence||0)+1;table.put(next,key);}}catch(e){error=e;tx.abort();}};
 // Both snapshots belong to the same read/write transaction, so another tab
 // cannot change the guest list between merge-consent validation and commit.
 if(guestReq)guestReq.onsuccess=commit;else req.onsuccess=commit;
 tx.oncomplete=()=>{if(changed){if(start===epoch&&key===route){record=next;snapshot=next.state;appliedRoute=key;notify();}channels[1]?.postMessage(key);}resolve(next);};tx.onabort=()=>reject(error||tx.error||Error('未能保存，请重试'));tx.onerror=()=>{};
});}
export async function dispatch(command:Command,lease?:FocusLease):Promise<State>{
 const key=route,start=epoch;
 if(key!=='preview')return (await transact(r=>{if(key.startsWith('user:'))guardFocusLease(r);const next=apply(r.state,command);if(next!==r.state)recordChange(r,next,deviceId());if(lease&&next.focusTimer.sessionId===lease.sessionId)r.focusLease=lease;if(next.focusTimer.status==='idle')delete r.focusLease;},key,start)).state;
 return new Promise((resolve,reject)=>{const tx=previewDB.transaction('preview','readwrite'),table=tx.objectStore('preview'),req=table.get('state');let next:State,error:unknown,changed=false;
 req.onsuccess=()=>{try{if(start!==epoch)throw Error('清单已变化');const current=req.result||seed();next=apply(current,command);changed=next!==current;if(changed)table.put(next,'state');}catch(e){error=e;tx.abort();}};
 tx.oncomplete=()=>{if(changed&&start===epoch){snapshot=next;notify();channels[0]?.postMessage('changed');}resolve(next);};tx.onabort=()=>reject(error||tx.error||Error('保存未完成，原数据未改变'));tx.onerror=()=>{};
 });
}
export async function eraseDeletedAccount(key:string){
 if(key!==route||!key.startsWith('user:'))throw Error('账号已变化');
 await new Promise<void>((resolve,reject)=>{const tx=personalDB.transaction('datasets','readwrite');tx.objectStore('datasets').put({accountDeleted:true},key);tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);});channels[1]?.postMessage({deleted:key});await switchDataset('guest');
}
