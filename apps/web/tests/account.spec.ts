import {test,expect,Page,BrowserContext} from '@playwright/test';
const UIDA='11111111-1111-4111-8111-111111111111',UIDB='22222222-2222-4222-8222-222222222222';
function backend(){
 const state={rows:new Map<string,Map<string,any>>(),seen:new Map<string,any>(),requests:[] as string[],conflicts:[] as any[],resolutions:[] as any[],pushes:0,failPush:false,losePushReply:false,conflictOnPush:false,failConflictList:false,denyLease:false,failCode:false,staleConflict:false,holdPull:null as null|Promise<void>,pullHeld:false};
 async function attach(context:BrowserContext){await context.route('https://*.supabase.co/**',async route=>{
  const req=route.request(),url=new URL(req.url());state.requests.push(url.pathname);
  const answer=(data:any,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
  if(url.pathname==='/auth/v1/otp')return state.failCode?answer({code:'over_email_send_rate_limit',msg:'Too many requests'},429):answer({});
  if(url.pathname==='/auth/v1/verify'){
   const {email,token}=req.postDataJSON();if(token!=='123456')return answer({code:'otp_expired',msg:'expired'},403);
   const uid=email.startsWith('b@')?UIDB:UIDA,user={id:uid,aud:'authenticated',role:'authenticated',email,app_metadata:{provider:'email'},user_metadata:{},created_at:new Date().toISOString()};
   const jwt=[{alg:'HS256',typ:'JWT'},{sub:uid,aud:'authenticated',exp:Math.floor(Date.now()/1000)+3600,role:'authenticated'},'test'].map(x=>Buffer.from(typeof x==='string'?x:JSON.stringify(x)).toString('base64url')).join('.');
   return answer({access_token:jwt,refresh_token:'test-refresh-'+uid,expires_in:3600,token_type:'bearer',user});
  }
  if(url.pathname==='/auth/v1/logout')return answer({});
  const auth=req.headers().authorization||'';let uid='';try{uid=JSON.parse(Buffer.from(auth.split('.')[1],'base64url').toString()).sub;}catch{}
  if(!uid)return answer({message:'not authenticated'},401);
  const rows=state.rows.get(uid)||new Map();state.rows.set(uid,rows);
  if(url.pathname.endsWith('/push_mutations')){
   state.pushes++;if(state.failPush)return route.abort('internetdisconnected');
   const results=req.postDataJSON().p_mutations.map((m:any)=>{
    const mk=uid+'|'+m.mutationId;if(state.seen.has(mk))return {...state.seen.get(mk),status:'duplicate'};
    if(state.conflictOnPush){const remote={...m.patch,title:'云端已有标题'};rows.set(m.entityType+'|'+m.entityId,{entityType:m.entityType,entityId:m.entityId,payload:remote,revision:2,updatedAt:new Date().toISOString(),deletedAt:null});state.conflicts.push({conflict_id:'conflict-'+m.mutationId,conflict_fields:['title'],local_patch:m.patch,local_operation:m.operation,remote_payload:remote,remote_revision:2});const result={mutationId:m.mutationId,status:'conflict',conflictId:'conflict-'+m.mutationId};state.seen.set(mk,result);return result;}
    const k=m.entityType+'|'+m.entityId,old=rows.get(k);rows.set(k,{entityType:m.entityType,entityId:m.entityId,payload:m.operation==='delete'?old?.payload||{}:{...old?.payload,...m.patch},revision:(old?.revision||0)+1,updatedAt:new Date().toISOString(),deletedAt:m.operation==='delete'?new Date().toISOString():null});const result={mutationId:m.mutationId,status:'applied'};state.seen.set(mk,result);return result;
   });return state.losePushReply?route.abort('connectionreset'):answer(results);
  }
  if(url.pathname.endsWith('/pull_changes')){if(state.holdPull){const held=state.holdPull;state.holdPull=null;state.pullHeld=true;await held;}const items=[...rows.values()],last=items.at(-1);return answer({items,hasMore:false,nextCursor:last?{updatedAt:last.updatedAt,entity:last.entityType+'|'+last.entityId}:null});}
  if(url.pathname.endsWith('/ack_sync_cursor'))return route.fulfill({status:204});
  if(url.pathname.endsWith('/sync_conflicts'))return state.failConflictList?route.abort('internetdisconnected'):answer(state.conflicts);
  if(url.pathname.endsWith('/resolve_conflict')){const body=req.postDataJSON();state.resolutions.push(body);if(state.staleConflict)return answer({resolved:false});state.conflicts=state.conflicts.filter(c=>c.conflict_id!==body.p_conflict_id);return answer({resolved:true});}
  if(url.pathname.endsWith('/acquire_focus_lease'))return answer({ok:!state.denyLease,expiresAt:new Date(Date.now()+req.postDataJSON().p_lease_seconds*1000).toISOString()});
  if(url.pathname.endsWith('/release_focus_lease'))return answer({ok:true});
  if(url.pathname.endsWith('/delete_account')){state.rows.delete(uid);return answer({deleted:true});}
  return answer({message:'Unexpected endpoint'},400);
 });}
 return {state,attach};
}
async function personal(page:Page){await page.goto('./');await page.getByRole('button',{name:'开始使用',exact:true}).click();await page.getByRole('button',{name:'创建自己的清单',exact:true}).click();await expect(page.getByText('本机个人清单 · 未登录',{exact:true})).toBeVisible();}
async function login(page:Page,email='a@example.test'){await page.getByRole('textbox',{name:'登录邮箱'}).fill(email);await page.getByRole('button',{name:'发送验证码',exact:true}).click();await page.getByRole('textbox',{name:'邮件验证码'}).fill('123456');await page.getByRole('button',{name:'验证并登录',exact:true}).click();await expect(page.getByText(email,{exact:true})).toBeVisible();}
async function merge(page:Page){await page.getByRole('button',{name:'预览首次合并'}).click();await page.getByRole('button',{name:'备份并确认合并'}).click();await expect(page.getByText('本次同步完成',{exact:true})).toBeVisible();}
async function add(page:Page,title:string){await page.getByRole('button',{name:/记下一件要做的事/}).click();await page.getByRole('textbox',{name:'快速添加标题'}).fill(title);await page.getByRole('button',{name:'加入清单',exact:true}).click();await page.getByRole('button',{name:'确认加入',exact:true}).click();await expect(page.getByText(title,{exact:true})).toBeVisible();}
test('real account UI keeps demo isolated; first merge, logout and a second account stay separate',async({page,context})=>{
 const mock=backend();await mock.attach(context);await page.goto('./');await expect(page.getByRole('navigation')).toBeVisible();expect(mock.state.requests).toEqual([]);
 await personal(page);await page.getByRole('button',{name:'关闭账号与同步'}).click();await add(page,'我的个人事项');await page.getByRole('button',{name:'账号与同步',exact:true}).click();await login(page);
 expect(mock.state.pushes).toBe(0);await page.getByRole('switch',{name:/带上未登录/}).click();await merge(page);
 const rows=[...mock.state.rows.get(UIDA)!.values()];expect(rows.some(r=>r.payload.title==='我的个人事项')).toBeTruthy();expect(rows.some(r=>r.entityId.startsWith('sample-'))).toBeFalsy();
 await page.getByRole('button',{name:'退出当前账号'}).click();await login(page,'b@example.test');await merge(page);expect(mock.state.rows.get(UIDB)!.size).toBe(0);
 await page.getByRole('button',{name:'关闭账号与同步'}).click();await expect(page.getByText('我的个人事项',{exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'账号与同步',exact:true}).click();await page.getByRole('button',{name:'退出当前账号'}).click();await login(page);await expect(page.getByRole('button',{name:'立即同步'})).toBeVisible();
 await page.getByRole('button',{name:'关闭账号与同步'}).click();await expect(page.getByText('我的个人事项',{exact:true})).toBeVisible();await page.reload();await expect(page.getByText('我的个人事项',{exact:true})).toBeVisible();
});
test('failed uploads stay pending and retry transfers to a second independent browser',async({page,context,browser,baseURL})=>{
 const mock=backend();await mock.attach(context);await personal(page);await login(page);await merge(page);await page.getByRole('button',{name:'关闭账号与同步'}).click();mock.state.failPush=true;await add(page,'断网时也不会丢');
 await page.getByRole('button',{name:'账号与同步',exact:true}).click();await expect.poll(()=>mock.state.pushes).toBeGreaterThan(0);await expect(page.getByRole('alert')).toBeVisible();await expect(page.getByText(/待上传：[1-9]/)).toBeVisible();
 await page.reload();await page.getByRole('button',{name:'账号与同步',exact:true}).click();await expect(page.getByText(/待上传：[1-9]/)).toBeVisible();mock.state.failPush=false;
 await expect(page.getByRole('button',{name:'立即同步'})).toBeEnabled();await page.getByRole('button',{name:'立即同步'}).click();await expect(page.getByText('待上传：0 条')).toBeVisible();
 const second=await browser.newContext({baseURL,viewport:{width:390,height:844}});try{await mock.attach(second);const p=await second.newPage();await personal(p);await login(p);await merge(p);await p.getByRole('button',{name:'关闭账号与同步'}).click();await expect(p.getByText('断网时也不会丢',{exact:true})).toBeVisible();}finally{await second.close();}
});
test('mail errors are honest and account focus honors lease denial',async({page,context})=>{
 const mock=backend();await mock.attach(context);await personal(page);mock.state.failCode=true;await page.getByRole('textbox',{name:'登录邮箱'}).fill('a@example.test');await page.getByRole('button',{name:'发送验证码',exact:true}).click();await expect(page.getByRole('alert')).toContainText('发送太频繁');await expect(page.getByRole('textbox',{name:'邮件验证码'})).toHaveCount(0);
 mock.state.failCode=false;await login(page);await merge(page);await page.getByRole('button',{name:'关闭账号与同步'}).click();await page.getByRole('navigation').getByRole('button',{name:'专注',exact:true}).click();mock.state.denyLease=true;await page.getByRole('button',{name:'开始专注',exact:true}).click();await expect(page.getByRole('status')).toContainText('另一台设备');await expect(page.getByRole('dialog',{name:'专注时刻'})).toHaveCount(0);
 mock.state.denyLease=false;await page.getByRole('button',{name:'开始专注',exact:true}).click();await expect(page.getByRole('dialog',{name:'专注时刻'})).toBeVisible();await page.getByRole('button',{name:'返回清单',exact:true}).click();await page.reload();await expect(page.locator('.mini-timer')).toBeVisible();
 mock.state.denyLease=true;await page.reload();await expect(page.locator('.mini-timer')).toContainText('已暂停');await page.getByRole('button',{name:'继续计时',exact:true}).click();await expect(page.getByRole('status')).toContainText('另一台设备');await expect(page.locator('.mini-timer')).toContainText('已暂停');
});
test('account panel stays within mobile widths and six themes',async({page,context})=>{
 const mock=backend();await mock.attach(context);await personal(page);await page.getByRole('button',{name:'关闭账号与同步'}).click();
 for(const name of ['星糖梦境','晴空蜜桃','莓果心动','奶杏布丁','青柠糖球','蜜桃心语']){
  await page.getByRole('navigation').getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('button',{name:/今日心情配色/}).click();await page.locator('.theme-card').filter({hasText:name}).click();await page.keyboard.press('Escape');await page.getByRole('button',{name:'账号与同步',exact:true}).click();
  for(const width of [360,390,430]){await page.setViewportSize({width,height:844});await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();}
  await page.screenshot({path:`artifacts/account-login-${name}.png`});await page.getByRole('button',{name:'关闭账号与同步'}).click();
 }
});

test('conflict choices require current revision; deletion needs exact text and leaves guest/demo intact',async({page,context})=>{
 const mock=backend();await mock.attach(context);await personal(page);await page.getByRole('button',{name:'关闭账号与同步'}).click();await add(page,'留在本机的清单');await page.getByRole('button',{name:'账号与同步',exact:true}).click();await login(page);await merge(page);
 mock.state.conflicts=[{conflict_id:'conflict-a',conflict_fields:['title'],local_operation:'update',local_patch:{title:'本次标题'},remote_payload:{title:'另一设备的标题'},remote_revision:3}];
 await page.getByRole('button',{name:'立即同步',exact:true}).click();await expect(page.getByText('本次修改：本次标题',{exact:true})).toBeVisible();mock.state.staleConflict=true;
 await page.getByRole('button',{name:'采用本次修改',exact:true}).click();await expect(page.getByRole('alert')).toContainText('云端内容又有变化');expect(mock.state.resolutions[0].p_resolution).toEqual({action:'merge',fields:{title:'本次标题'},expectedRevision:3});
 mock.state.staleConflict=false;await page.getByRole('button',{name:'保留云端',exact:true}).click();await expect(page.locator('.conflict-card')).toHaveCount(0);
 await page.getByRole('button',{name:'删除云端账号…',exact:true}).click();await expect(page.getByRole('button',{name:'永久删除账号',exact:true})).toBeDisabled();await page.getByRole('button',{name:'取消',exact:true}).click();expect(mock.state.requests.some(p=>p.endsWith('/delete_account'))).toBeFalsy();
 await page.getByRole('button',{name:'删除云端账号…',exact:true}).click();await page.getByRole('textbox',{name:'删除账号确认文字'}).fill('删除我的云端账号');await page.getByRole('button',{name:'永久删除账号',exact:true}).click();await expect(page.getByText('本机个人清单 · 未登录',{exact:true})).toBeVisible();expect(mock.state.rows.has(UIDA)).toBeFalsy();
 await page.getByRole('button',{name:'关闭账号与同步'}).click();await expect(page.getByText('留在本机的清单',{exact:true})).toBeVisible();await page.getByRole('button',{name:'账号与同步',exact:true}).click();await page.getByRole('button',{name:'返回示例预览',exact:true}).click();await page.getByRole('button',{name:'关闭账号与同步'}).click();await expect(page.getByText('给重要的事，留一点专注时间',{exact:true})).toBeVisible();
});

test('an old in-flight response cannot expose account A after sign-out in another tab',async({page,context})=>{
 const mock=backend();await mock.attach(context);await personal(page);await login(page);await merge(page);await page.getByRole('button',{name:'关闭账号与同步'}).click();await add(page,'只属于账号A');await page.getByRole('button',{name:'账号与同步',exact:true}).click();await expect(page.getByText('待上传：0 条')).toBeVisible();
 const second=await context.newPage();await second.goto('./');await second.getByRole('button',{name:'账号与同步',exact:true}).click();await expect(second.getByText('a@example.test',{exact:true})).toBeVisible();await expect(second.getByRole('button',{name:'退出当前账号'})).toBeEnabled();
 let release!:()=>void;mock.state.holdPull=new Promise<void>(resolve=>{release=resolve;});await page.getByRole('button',{name:'立即同步'}).click();await expect.poll(()=>mock.state.pullHeld).toBeTruthy();
 await second.getByRole('button',{name:'退出当前账号'}).click();await expect(page.getByText('本机个人清单 · 未登录',{exact:true})).toBeVisible();release();await login(second,'b@example.test');await merge(second);
 await expect(page.getByText('b@example.test',{exact:true})).toBeVisible();await page.getByRole('button',{name:'关闭账号与同步'}).click();await second.getByRole('button',{name:'关闭账号与同步'}).click();await expect(page.getByText('只属于账号A',{exact:true})).toHaveCount(0);await expect(second.getByText('只属于账号A',{exact:true})).toHaveCount(0);expect(mock.state.rows.get(UIDB)?.size).toBe(0);await second.close();
});

test('two tabs share local writes and account deletion cannot recreate deleted records',async({page,context})=>{
 const mock=backend();await mock.attach(context);await personal(page);await login(page);await merge(page);await page.getByRole('button',{name:'关闭账号与同步'}).click();const second=await context.newPage();await second.goto('./');
 await add(page,'多标签页同一份清单');await expect(second.getByText('多标签页同一份清单',{exact:true})).toBeVisible();await page.getByRole('button',{name:'账号与同步',exact:true}).click();await expect(page.getByText('待上传：0 条')).toBeVisible();await expect(page.getByRole('button',{name:'删除云端账号…'})).toBeEnabled();
 await page.getByRole('button',{name:'删除云端账号…'}).click();await page.getByRole('textbox',{name:'删除账号确认文字'}).fill('删除我的云端账号');await page.getByRole('button',{name:'永久删除账号',exact:true}).click();await expect(second.getByText('多标签页同一份清单',{exact:true})).toHaveCount(0);await second.reload();await expect(second.getByText('多标签页同一份清单',{exact:true})).toHaveCount(0);
 const tombstone=await second.evaluate(async uid=>new Promise(resolve=>{const req=indexedDB.open('cat-dog-diary-personal-v2');req.onsuccess=()=>{const r=req.result.transaction('datasets').objectStore('datasets').get('user:'+uid);r.onsuccess=()=>{resolve(r.result);req.result.close();};};}),UIDA);expect(tombstone).toEqual({accountDeleted:true});await second.close();
});

test('a committed upload with a lost reply retries the same mutation only once',async({page,context})=>{
 const mock=backend();await mock.attach(context);await personal(page);await login(page);await merge(page);await page.getByRole('button',{name:'关闭账号与同步'}).click();mock.state.losePushReply=true;await add(page,'服务器已收到但回信丢失');await page.getByRole('button',{name:'账号与同步',exact:true}).click();await expect(page.getByRole('alert')).toBeVisible();expect(mock.state.rows.get(UIDA)?.size).toBe(1);await expect(page.getByText(/待上传：[1-9]/)).toBeVisible();
 mock.state.losePushReply=false;await page.getByRole('button',{name:'立即同步'}).click();await expect(page.getByText('待上传：0 条')).toBeVisible();expect(mock.state.rows.get(UIDA)?.size).toBe(1);expect(mock.state.seen.size).toBe(1);expect(mock.state.requests.some(p=>p.endsWith('/ack_sync_cursor'))).toBeTruthy();
});

test('a new conflict receipt survives unavailable conflict details without crashing the sheet',async({page,context})=>{
 const mock=backend();await mock.attach(context);await personal(page);await login(page);await merge(page);await page.getByRole('button',{name:'关闭账号与同步'}).click();mock.state.conflictOnPush=true;mock.state.failConflictList=true;await add(page,'我的新标题');await page.getByRole('button',{name:'账号与同步',exact:true}).click();await expect(page.getByText(/有修改等待核对/)).toBeVisible();await expect(page.getByRole('alert')).toBeVisible();
 mock.state.failConflictList=false;await page.getByRole('button',{name:'立即同步'}).click();await expect(page.getByText('本次修改：我的新标题',{exact:true})).toBeVisible();await page.getByRole('button',{name:'保留云端'}).click();await expect(page.locator('.conflict-card')).toHaveCount(0);
});

test('automatic two-way synchronization works without either sync button',async({page,context,browser,baseURL})=>{
 const mock=backend();await mock.attach(context);await personal(page);await login(page);await merge(page);await expect(page.getByRole('switch',{name:/自动同步/})).toBeChecked();await page.getByRole('button',{name:'关闭账号与同步'}).click();
 const second=await browser.newContext({baseURL,viewport:{width:390,height:844}});
 try{await mock.attach(second);const p=await second.newPage();await personal(p);await login(p);await merge(p);await p.getByRole('button',{name:'关闭账号与同步'}).click();
  await add(page,'不用手动点同步');await expect(p.getByText('不用手动点同步',{exact:true})).toBeVisible({timeout:10000});
  await p.getByRole('button',{name:'完成 不用手动点同步',exact:true}).click();await expect(page.locator('.task-card.done').filter({hasText:'不用手动点同步'})).toBeVisible({timeout:10000});
 }finally{await second.close();}
});

test('a second edit during a slow request uploads automatically after the first request',async({page,context})=>{
 const mock=backend();await mock.attach(context);await personal(page);await login(page);await merge(page);await page.getByRole('button',{name:'关闭账号与同步'}).click();
 let release!:()=>void;mock.state.holdPull=new Promise<void>(r=>{release=r;});await add(page,'第一次自动上传');await expect.poll(()=>mock.state.pullHeld).toBeTruthy();await add(page,'上传中新增第二件');release();
 await expect.poll(()=>[...mock.state.rows.get(UIDA)!.values()].some(r=>r.payload.title==='上传中新增第二件'),{timeout:4000}).toBeTruthy();
 await page.getByRole('button',{name:'账号与同步',exact:true}).click();await expect(page.getByText('待上传：0 条')).toBeVisible();
});

test('network recovery automatically sends offline edits and pause remains an explicit user choice',async({page,context})=>{
 const mock=backend();await mock.attach(context);await personal(page);await login(page);await merge(page);await page.getByRole('switch',{name:/自动同步/}).click();await expect(page.getByRole('switch',{name:/自动同步/})).not.toBeChecked();await page.getByRole('button',{name:'关闭账号与同步'}).click();await add(page,'暂停时只留本机');await page.waitForTimeout(900);expect(mock.state.pushes).toBe(0);
 await page.reload();await page.getByRole('button',{name:'账号与同步',exact:true}).click();await expect(page.getByRole('switch',{name:/自动同步/})).not.toBeChecked();await page.getByRole('switch',{name:/自动同步/}).click();await expect(page.getByText('待上传：0 条')).toBeVisible();await page.getByRole('button',{name:'关闭账号与同步'}).click();
 await context.setOffline(true);await add(page,'断网后的自动恢复');const before=mock.state.pushes;await page.waitForTimeout(1000);expect(mock.state.pushes).toBe(before);await context.setOffline(false);
 await expect.poll(()=>[...mock.state.rows.get(UIDA)!.values()].some(r=>r.payload.title==='断网后的自动恢复'),{timeout:6000}).toBeTruthy();
});

test('temporary request failure retries without a click even while the browser reports online',async({page,context})=>{
 const mock=backend();await mock.attach(context);await personal(page);await login(page);await merge(page);await page.getByRole('button',{name:'关闭账号与同步'}).click();mock.state.failPush=true;await add(page,'自动重试的事项');await expect.poll(()=>mock.state.pushes).toBeGreaterThan(0);mock.state.failPush=false;
 await expect.poll(()=>[...mock.state.rows.get(UIDA)!.values()].some(r=>r.payload.title==='自动重试的事项'),{timeout:7000}).toBeTruthy();
});
