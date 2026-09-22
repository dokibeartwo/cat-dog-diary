// Uses the already configured Git credential helper. Never logs credentials.
// node scripts/android-build-ci.cjs dispatch|status|logs|download [runId]
const {execFileSync}=require('node:child_process');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const repository='dokibeartwo/cat-dog-diary';
async function main(){
  let credentials;
  try{credentials=execFileSync('git',['credential','fill'],{input:'protocol=https\nhost=github.com\n\n',encoding:'utf8',env:{...process.env,GIT_TERMINAL_PROMPT:'0',GCM_INTERACTIVE:'never'},stdio:['pipe','pipe','pipe']});}
  catch{throw Error('GitHub credential helper unavailable; dispatch this workflow from the repository Actions page.');}
  const token=credentials.split(/\r?\n/).find(l=>l.startsWith('password='))?.slice(9);if(!token)throw Error('No GitHub credential available');
  const api=async(route,method='GET',body)=>{
    const response=await fetch(`https://api.github.com/repos/${repository}/${route}`,{method,headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});
    if(!response.ok)throw Error(`GitHub API ${response.status}: ${response.statusText}`);
    return response.status===204?null:response.json();
  };
  if(process.argv[2]==='releases'){const releases=await api('releases?per_page=8');console.log(JSON.stringify(releases.map(r=>({tag:r.tag_name,prerelease:r.prerelease,url:r.html_url,assets:r.assets.map(a=>({name:a.name,bytes:a.size}))})),null,2));}
  else if(process.argv[2]==='dispatch-smoke'){const id=process.argv[3];if(!/^\d+$/.test(id||''))throw Error('A source APK run ID is required');await api('actions/workflows/android-native.yml/dispatches','POST',{ref:'main',inputs:{apk_run_id:id}});console.log(`Retesting the existing APK from run ${id}; no rebuild.`);}
  else if(process.argv[2]==='dispatch'){await api('actions/workflows/android-native.yml/dispatches','POST',{ref:'main'});console.log('Android workflow dispatched.');}
  else if(process.argv[2]==='status'){
    const id=process.argv[3];
    if(id){const run=await api(`actions/runs/${id}`),jobs=await api(`actions/runs/${id}/jobs`);console.log(JSON.stringify({id:run.id,status:run.status,conclusion:run.conclusion,startedAt:run.run_started_at,url:run.html_url,jobs:jobs.jobs.map(j=>({name:j.name,status:j.status,conclusion:j.conclusion,steps:j.steps.map(s=>({name:s.name,status:s.status,conclusion:s.conclusion,startedAt:s.started_at,completedAt:s.completed_at}))}))},null,2));}
    else{const runs=await api('actions/workflows/android-native.yml/runs?per_page=3');console.log(JSON.stringify(runs.workflow_runs.map(r=>({id:r.id,status:r.status,conclusion:r.conclusion,url:r.html_url,sha:r.head_sha})),null,2));}
  }else if(process.argv[2]==='logs'){
    const jobs=await api(`actions/runs/${process.argv[3]}/jobs`),job=jobs.jobs.find(j=>j.conclusion==='failure')||jobs.jobs[0];
    if(!job)throw Error('No job yet');
    const response=await fetch(`https://api.github.com/repos/${repository}/actions/jobs/${job.id}/logs`,{headers:{Authorization:`Bearer ${token}`},redirect:'manual',signal:AbortSignal.timeout(30000)});
    if(response.status!==302)throw Error(`Logs unavailable: ${response.status}`);
    const location=new URL(response.headers.get('location'));
    if(location.protocol!=='https:'||!location.hostname.endsWith('.blob.core.windows.net'))throw Error('Unexpected log storage');
    const head=await fetch(location,{method:'HEAD',signal:AbortSignal.timeout(30000)});
    const bytes=Number(head.headers.get('content-length'));
    if(!head.ok||!Number.isSafeInteger(bytes)||bytes<1)throw Error('Log size unavailable');
    const tail=await fetch(location,{headers:{Range:`bytes=${Math.max(0,bytes-65536)}-${bytes-1}`},signal:AbortSignal.timeout(30000)});
    if(tail.status!==206)throw Error(`Log range unavailable: ${tail.status}`);
    console.log((await tail.text()).split('\n').slice(-130).join('\n'));
  }else if(process.argv[2]==='inspect'){
    // Fetch only the requested diagnostic entries from a large screenshot ZIP.
    // Full artifact download still independently verifies its SHA-256 for release.
    const id=process.argv[3];if(!/^\d+$/.test(id||''))throw Error('Numeric run ID required');
    const artifacts=await api(`actions/runs/${id}/artifacts`);
    const artifact=artifacts.artifacts.find(a=>a.name==='cat-dog-diary-android-smoke'&&!a.expired);
    if(!artifact)throw Error('Diagnostic artifact unavailable');
    const redirect=await fetch(`https://api.github.com/repos/${repository}/actions/artifacts/${artifact.id}/zip`,{headers:{Authorization:`Bearer ${token}`},redirect:'manual',signal:AbortSignal.timeout(30000)});
    const location=new URL(redirect.headers.get('location'));
    if(location.protocol!=='https:'||!location.hostname.endsWith('.blob.core.windows.net'))throw Error('Unexpected artifact storage');
    const range=async(spec)=>{const response=await fetch(location,{headers:{Range:`bytes=${spec}`},signal:AbortSignal.timeout(60000)});if(response.status!==206)throw Error(`Range download failed: ${response.status}`);return Buffer.from(await response.arrayBuffer());};
    const tail=await range(`${Math.max(0,artifact.size_in_bytes-65557)}-${artifact.size_in_bytes-1}`);let end=-1;
    for(let i=tail.length-22;i>=0;i--)if(tail.readUInt32LE(i)===0x06054b50){end=i;break;}
    if(end<0)throw Error('ZIP directory missing');
    const size=tail.readUInt32LE(end+12),offset=tail.readUInt32LE(end+16);
    if(size>1024*1024||offset===0xffffffff)throw Error('Unsupported diagnostic ZIP');
    const directory=await range(`${offset}-${offset+size-1}`),entries=[];
    for(let i=0;i+46<=directory.length;){
      if(directory.readUInt32LE(i)!==0x02014b50)throw Error('Invalid ZIP directory');
      const n=directory.readUInt16LE(i+28),extra=directory.readUInt16LE(i+30),comment=directory.readUInt16LE(i+32);
      entries.push({name:directory.subarray(i+46,i+46+n).toString('utf8'),method:directory.readUInt16LE(i+10),size:directory.readUInt32LE(i+20),offset:directory.readUInt32LE(i+42)});i+=46+n+extra+comment;
    }
    const folder=path.resolve(__dirname,'../release',`android-ci-${id}`,'triage');fs.mkdirSync(folder,{recursive:true});
    const wanted=['result.json','failure-ui.xml','failure.png','input-method.txt'];
    for(const entry of entries.filter(e=>wanted.includes(e.name))){
      if(entry.size>4*1024*1024)throw Error('Diagnostic entry exceeds limit');
      const header=await range(`${entry.offset}-${entry.offset+29}`);
      if(header.readUInt32LE(0)!==0x04034b50)throw Error('Invalid ZIP local header');
      const start=entry.offset+30+header.readUInt16LE(26)+header.readUInt16LE(28);
      const compressed=await range(`${start}-${start+entry.size-1}`);
      const content=entry.method===8?require('node:zlib').inflateRawSync(compressed,{maxOutputLength:8*1024*1024}):entry.method===0?compressed:null;
      if(!content)throw Error('Unsupported ZIP compression');
      fs.writeFileSync(path.join(folder,entry.name),content);
      console.log(entry.name==='result.json'?content.toString('utf8'):JSON.stringify({diagnostic:entry.name,file:path.join(folder,entry.name),bytes:content.length}));
    }
  }else if(process.argv[2]==='download'){
    const id=process.argv[3];if(!/^\d+$/.test(id||''))throw Error('A numeric workflow run ID is required');
    const artifacts=await api(`actions/runs/${id}/artifacts`);
    const folder=path.resolve(__dirname,'../release',`android-ci-${id}`);fs.mkdirSync(folder,{recursive:true});
    const names=process.argv[4]==='smoke'?['cat-dog-diary-android-smoke']:['cat-dog-diary-android-smoke','cat-dog-diary-android-internal'];
    for(const artifact of artifacts.artifacts.filter(a=>names.includes(a.name)&&!a.expired).sort((a,b)=>names.indexOf(a.name)-names.indexOf(b.name))){
      const file=path.join(folder,artifact.name+'.zip');
      if(fs.existsSync(file)){console.log(JSON.stringify({artifact:artifact.name,file,existing:true}));continue;}
      console.log(JSON.stringify({artifact:artifact.name,downloading:true,expectedBytes:artifact.size_in_bytes}));
      if(!Number.isSafeInteger(artifact.size_in_bytes)||artifact.size_in_bytes<1||artifact.size_in_bytes>512*1024*1024)throw Error('Artifact exceeds download limit');
      const redirect=await fetch(`https://api.github.com/repos/${repository}/actions/artifacts/${artifact.id}/zip`,{headers:{Authorization:`Bearer ${token}`},redirect:'manual',signal:AbortSignal.timeout(30000)});
      const location=new URL(redirect.headers.get('location'));
      if(location.protocol!=='https:'||!location.hostname.endsWith('.blob.core.windows.net'))throw Error('Unexpected artifact storage');
      // Bounded ranges avoid one slow blob connection blocking the entire APK.
      // Only rename after every byte and the server's full SHA-256 agree.
      const partial=file+`.${Date.now()}.partial`,fd=fs.openSync(partial,'wx'),stop=new AbortController();
      const block=1024*1024;let next=0,bytes=0,lastReport=Date.now();
      const worker=async()=>{while(next<artifact.size_in_bytes){
        const start=next,end=Math.min(start+block,artifact.size_in_bytes)-1;next=end+1;
        const response=await fetch(location,{headers:{Range:`bytes=${start}-${end}`},signal:AbortSignal.any([stop.signal,AbortSignal.timeout(180000)])});
        if(response.status!==206){await response.body?.cancel();throw Error(`Artifact range failed: ${response.status}`);}
        if(response.headers.get('content-range')!==`bytes ${start}-${end}/${artifact.size_in_bytes}`)throw Error('Artifact range boundaries differ');
        const content=Buffer.from(await response.arrayBuffer());if(content.length!==end-start+1)throw Error('Truncated artifact block');
        let written=0;while(written<content.length)written+=fs.writeSync(fd,content,written,content.length-written,start+written);
        bytes+=content.length;if(Date.now()-lastReport>15000){console.log(JSON.stringify({artifact:artifact.name,downloadedBytes:bytes}));lastReport=Date.now();}
      }};
      const workers=Array.from({length:4},()=>worker().catch(error=>{stop.abort();throw error;}));
      try{const results=await Promise.allSettled(workers);const failed=results.find(r=>r.status==='rejected');if(failed)throw failed.reason;fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
      const digest=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(partial))digest.update(chunk);
      const hash=digest.digest('hex');
      if(bytes!==artifact.size_in_bytes)throw Error('Artifact size differs');
      if(artifact.digest&&artifact.digest!==`sha256:${hash}`)throw Error('Artifact SHA-256 mismatch');
      fs.renameSync(partial,file);console.log(JSON.stringify({artifact:artifact.name,file,bytes,sha256:hash}));
    }
  }else throw Error('Expected dispatch, status, logs or download');
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
