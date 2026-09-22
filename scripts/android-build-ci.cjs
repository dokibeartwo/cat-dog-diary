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
  if(process.argv[2]==='dispatch'){await api('actions/workflows/android-native.yml/dispatches','POST',{ref:'main'});console.log('Android workflow dispatched.');}
  else if(process.argv[2]==='status'){
    const id=process.argv[3];
    if(id){const run=await api(`actions/runs/${id}`),jobs=await api(`actions/runs/${id}/jobs`);console.log(JSON.stringify({id:run.id,status:run.status,conclusion:run.conclusion,url:run.html_url,jobs:jobs.jobs.map(j=>({name:j.name,status:j.status,conclusion:j.conclusion,steps:j.steps.map(s=>({name:s.name,status:s.status,conclusion:s.conclusion}))}))},null,2));}
    else{const runs=await api('actions/workflows/android-native.yml/runs?per_page=3');console.log(JSON.stringify(runs.workflow_runs.map(r=>({id:r.id,status:r.status,conclusion:r.conclusion,url:r.html_url,sha:r.head_sha})),null,2));}
  }else if(process.argv[2]==='logs'){
    const jobs=await api(`actions/runs/${process.argv[3]}/jobs`),job=jobs.jobs.find(j=>j.conclusion==='failure')||jobs.jobs[0];
    if(!job)throw Error('No job yet');
    const response=await fetch(`https://api.github.com/repos/${repository}/actions/jobs/${job.id}/logs`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(30000)});
    if(!response.ok)throw Error(`Logs unavailable: ${response.status}`);
    console.log((await response.text()).split('\n').slice(-130).join('\n'));
  }else if(process.argv[2]==='download'){
    const id=process.argv[3];if(!/^\d+$/.test(id||''))throw Error('A numeric workflow run ID is required');
    const artifacts=await api(`actions/runs/${id}/artifacts`);
    const folder=path.resolve(__dirname,'../release',`android-ci-${id}`);fs.mkdirSync(folder,{recursive:true});
    const names=process.argv[4]==='smoke'?['cat-dog-diary-android-smoke']:['cat-dog-diary-android-smoke','cat-dog-diary-android-internal'];
    for(const artifact of artifacts.artifacts.filter(a=>names.includes(a.name)&&!a.expired).sort((a,b)=>names.indexOf(a.name)-names.indexOf(b.name))){
      const file=path.join(folder,artifact.name+'.zip');
      if(fs.existsSync(file)){console.log(JSON.stringify({artifact:artifact.name,file,existing:true}));continue;}
      const response=await fetch(`https://api.github.com/repos/${repository}/actions/artifacts/${artifact.id}/zip`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(120000)});
      if(!response.ok)throw Error(`Artifact download failed: ${response.status}`);
      const bytes=Buffer.from(await response.arrayBuffer()),hash=crypto.createHash('sha256').update(bytes).digest('hex');
      if(artifact.digest&&artifact.digest!==`sha256:${hash}`)throw Error('Artifact SHA-256 mismatch');
      fs.writeFileSync(file,bytes,{flag:'wx'});console.log(JSON.stringify({artifact:artifact.name,file,bytes:bytes.length,sha256:hash}));
    }
  }else throw Error('Expected dispatch, status, logs or download');
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
