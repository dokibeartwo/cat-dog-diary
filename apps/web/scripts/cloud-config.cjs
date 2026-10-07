'use strict';
// Build-time validation only. Never print keys or turn on cloud operations.
function validateCloudConfig(env={}){
  const url=String(env.VITE_SUPABASE_URL||'').trim();
  const key=String(env.VITE_SUPABASE_PUBLISHABLE_KEY||'').trim();
  if(!url&&!key)return {configured:false};
  if(!url||!key)throw Error('请同时填写 Supabase 项目网址和公开客户端 key');
  let parsed;try{parsed=new URL(url);}catch{throw Error('Supabase 项目网址格式无效');}
  if(parsed.protocol!=='https:'||!/^https:\/\/[a-z0-9]{20}\.supabase\.co\/?$/.test(url)){
    throw Error('本轮只接受官方托管项目的 HTTPS 项目网址，不接受后台链接、自定义服务器或附带参数的网址');
  }
  let kind;
  if(/^sb_publishable_[A-Za-z0-9_-]{16,}$/.test(key))kind='publishable';
  else{
    let payload;
    try{
      if(!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(key))throw Error();
      payload=JSON.parse(Buffer.from(key.split('.')[1],'base64url').toString('utf8'));
    }catch{throw Error('这里只接受 publishable key 或旧版 anon key；不要填写 secret/service_role key');}
    if(payload.role!=='anon'||payload.iss!=='supabase')throw Error('不是公开 anon key，拒绝将高权限密钥放入网页');
    if(payload.ref&&payload.ref!==parsed.hostname.split('.')[0])throw Error('项目网址与 anon key 不属于同一项目');
    if(!Number.isFinite(payload.exp)||payload.exp<=Date.now()/1000)throw Error('anon key 已过期或缺少有效期限');
    kind='anon';
  }
  return {configured:true,url:parsed.origin,key,kind};
}
function assertFormalDataset(state){
  if(!state||state.preview!==false||state.datasetKind!=='personal'){
    throw Error('示例数据不能加入账号同步；必须创建独立的正式清单并确认合并');
  }
}
module.exports={validateCloudConfig,assertFormalDataset};
