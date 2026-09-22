// Build-time check: a secret must be rejected BEFORE Metro embeds .env values.
const fs=require('node:fs');
const path=require('node:path');
let config={...process.env};
for(const name of ['.env','.env.local','.env.production','.env.production.local']){
  const file=path.join(__dirname,'..',name);
  if(fs.existsSync(file))for(const line of fs.readFileSync(file,'utf8').split(/\r?\n/)){
    const match=line.match(/^(EXPO_PUBLIC_SUPABASE_(?:URL|PUBLISHABLE_KEY))\s*=\s*["']?(.*?)["']?\s*$/);
    if(match)config[match[1]]=match[2];
  }
}
const key=config.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,url=config.EXPO_PUBLIC_SUPABASE_URL;
if(!key&&!url){console.log('Cloud is unconfigured: offline internal APK.');process.exit(0);}
if(!key||!url)throw Error('Both Supabase URL and publishable key are required');
let role='';try{role=JSON.parse(Buffer.from(key.split('.')[1]||'','base64url').toString()).role;}catch{}
if(!key.startsWith('sb_publishable_')&&role!=='anon')throw Error('Only a Supabase publishable or legacy anon key may enter a client build');
const parsed=new URL(url);if(parsed.protocol!=='https:')throw Error('Use an HTTPS project URL');
console.log('Public client configuration validated; no key printed.');
