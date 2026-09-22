// Only reuses an immutable APK artifact from this repository's own workflow.
const fs=require('node:fs'),path=require('node:path');
(async()=>{
  const id=process.env.APK_SOURCE_RUN||process.env.GITHUB_RUN_ID,repo=process.env.GITHUB_REPOSITORY;
  if(!/^\d+$/.test(id||'')||repo!=='dokibeartwo/cat-dog-diary')throw Error('Invalid APK source');
  const response=await fetch(`https://api.github.com/repos/${repo}/actions/runs/${id}`,{headers:{Authorization:`Bearer ${process.env.GH_TOKEN}`,Accept:'application/vnd.github+json'},signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw Error(`Cannot verify APK source: ${response.status}`);
  const run=await response.json();
  const fresh=!process.env.APK_SOURCE_RUN&&String(run.id)===process.env.GITHUB_RUN_ID&&run.head_sha===process.env.GITHUB_SHA;
  if(run.path!=='.github/workflows/android-native.yml'||run.head_repository?.full_name!==repo||(!fresh&&run.status!=='completed'))throw Error('APK must be this native build or a completed native build in this repository');
  const folder=path.join(__dirname,'../smoke-output');fs.mkdirSync(folder,{recursive:true});
  const provenance={apkSourceRun:run.id,apkSourceSha:run.head_sha,smokeSha:process.env.GITHUB_SHA,url:run.html_url};
  fs.writeFileSync(path.join(folder,'apk-provenance.json'),JSON.stringify(provenance,null,2));console.log(JSON.stringify(provenance));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
