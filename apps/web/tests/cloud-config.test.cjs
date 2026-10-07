const test=require('node:test'),assert=require('node:assert/strict');
const {validateCloudConfig,assertFormalDataset}=require('../scripts/cloud-config.cjs');
const ref='abcdefghijklmnopqrst';
const env={VITE_SUPABASE_URL:'https://'+ref+'.supabase.co',VITE_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_'+'a'.repeat(32)};
const jwt=payload=>Buffer.from('{"alg":"HS256"}').toString('base64url')+'.'+Buffer.from(JSON.stringify(payload)).toString('base64url')+'.'+'a'.repeat(43);
test('unconfigured preview cannot masquerade as a configured service',()=>{
  assert.deepEqual(validateCloudConfig({}),{configured:false});
  assert.throws(()=>validateCloudConfig({VITE_SUPABASE_URL:env.VITE_SUPABASE_URL}),/同时填写/);
});
test('public project configuration is normalized without arbitrary network targets',()=>{
  assert.equal(validateCloudConfig({...env,VITE_SUPABASE_URL:env.VITE_SUPABASE_URL+'/'}).url,env.VITE_SUPABASE_URL);
  for(const url of ['http://'+ref+'.supabase.co','https://supabase.com/dashboard','https://'+ref+'.supabase.co.evil.test','https://user:pass@'+ref+'.supabase.co',env.VITE_SUPABASE_URL+'?key=secret','https://127.0.0.1',env.VITE_SUPABASE_URL+'/rest/v1']){
    assert.throws(()=>validateCloudConfig({...env,VITE_SUPABASE_URL:url}),/项目网址/);
  }
});
test('secret, service-role and user tokens are rejected without echoing the key',()=>{
  for(const key of ['sb_secret_'+'x'.repeat(32),jwt({role:'service_role',iss:'supabase'}),jwt({role:'authenticated',iss:'supabase'}),'private-test-key']){
    assert.throws(()=>validateCloudConfig({...env,VITE_SUPABASE_PUBLISHABLE_KEY:key}),error=>!error.message.includes(key));
  }
});
test('legacy anon key must match the project and remain unexpired',()=>{
  const payload={role:'anon',iss:'supabase',ref,exp:Math.floor(Date.now()/1000)+3600};
  assert.equal(validateCloudConfig({...env,VITE_SUPABASE_PUBLISHABLE_KEY:jwt(payload)}).kind,'anon');
  assert.throws(()=>validateCloudConfig({...env,VITE_SUPABASE_PUBLISHABLE_KEY:jwt({...payload,ref:'zyxwvutsrqponmlkjihgf'})}),/同一项目/);
  assert.throws(()=>validateCloudConfig({...env,VITE_SUPABASE_PUBLISHABLE_KEY:jwt({...payload,exp:1})}),/过期/);
});
test('preview and unknown datasets never qualify for formal synchronization',()=>{
  for(const state of [null,{}, {preview:true}, {preview:true,datasetKind:'personal'}, {preview:false}]){
    assert.throws(()=>assertFormalDataset(state),/示例数据/);
  }
  assert.doesNotThrow(()=>assertFormalDataset({preview:false,datasetKind:'personal'}));
});
