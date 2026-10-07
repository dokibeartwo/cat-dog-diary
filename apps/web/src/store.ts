import {apply,seed,State,Command} from './model';
const DB='cat-dog-diary-clickable-preview-v1';
let db:IDBDatabase, snapshot:State, listeners=new Set<()=>void>();
let channel:BroadcastChannel|undefined;
export const getSnapshot=()=>snapshot;
export const subscribe=(cb:()=>void)=>{listeners.add(cb);return ()=>{listeners.delete(cb);};};
const publish=(s:State)=>{snapshot=s;listeners.forEach(cb=>cb());};
function read():Promise<State>{return new Promise((resolve,reject)=>{const req=db.transaction('preview','readonly').objectStore('preview').get('state');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
export async function initialize(){
  db=await new Promise<IDBDatabase>((resolve,reject)=>{const req=indexedDB.open(DB,1);req.onupgradeneeded=()=>req.result.createObjectStore('preview');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(Error('浏览器无法保存预览数据，请退出无痕模式后再试。'));});
  await new Promise<void>((resolve,reject)=>{const tx=db.transaction('preview','readwrite'),table=tx.objectStore('preview'),req=table.get('state');req.onsuccess=()=>{snapshot=req.result||seed();if(!req.result)table.put(snapshot,'state');};tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});
  if('BroadcastChannel' in globalThis){channel=new BroadcastChannel(DB);channel.onmessage=async()=>{try{publish(await read());}catch{/* keep current snapshot */}};}
  window.addEventListener('focus',()=>{void read().then(publish);});
  return snapshot;
}
// IndexedDB serializes read/write transactions across tabs. Commands always
// apply to the latest snapshot, not the React render that launched them.
export function dispatch(command:Command):Promise<State>{return new Promise((resolve,reject)=>{
  const tx=db.transaction('preview','readwrite'),table=tx.objectStore('preview'),req=table.get('state');let next:State,error:unknown,changed=false;
  req.onsuccess=()=>{try{const current=req.result||seed();next=apply(current,command);changed=next!==current;if(changed)table.put(next,'state');}catch(e){error=e;tx.abort();}};
  tx.oncomplete=()=>{if(changed){publish(next);channel?.postMessage('changed');}resolve(next);};
  tx.onabort=()=>reject(error||tx.error||Error('保存未完成，原数据未改变'));tx.onerror=()=>{};
});}
