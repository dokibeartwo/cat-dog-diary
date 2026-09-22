// Explicit maintainer command only. Never changes the stable release.
// refresh-draft may replace only two known unpublished candidates, kept locally.
// node scripts/publish-offline-beta.cjs verify|stage|refresh-draft|publish <successful-smoke-run>
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {Readable} = require('node:stream');
const {execFileSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const repo = 'dokibeartwo/cat-dog-diary', tag = 'v1.1.0-beta.3';
const sourceRun = '35703508129', sourceSha = 'd0d2a64d5a41503e47ee91ed22ded9853740d95b';
const apkHash = 'af144f9f6ea4052a8668cbfa8f39f8497aef90f96e3f772fb76c169ccd6d05f6';
const winHash = '668f0cf72cb3dbf4b2eebf03acfe4a930d9f9a0273fba7d6ef330c5de3f218e2';
async function hash(file) {
  const digest = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) digest.update(chunk);
  return digest.digest('hex');
}
async function main() {
  const [command, smokeRun] = process.argv.slice(2);
  if (!['verify', 'stage', 'refresh-draft', 'publish'].includes(command) || !/^\d+$/.test(smokeRun || '')) throw Error('Expected verify|stage|refresh-draft|publish <successful-smoke-run>');
  const folder = path.join(root, 'release', `android-ci-${smokeRun}`, 'diagnostics');
  const report = JSON.parse(fs.readFileSync(path.join(folder, 'result.json'), 'utf8'));
  const provenance = JSON.parse(fs.readFileSync(path.join(folder, 'apk-provenance.json'), 'utf8'));
  const required = ['offline-task-created', 'offline-task-survives-process-restart', 'focus-start', 'focus-pause', 'paused-focus-survives-restart', ...[1,2,3,4,5,6].map(n => `theme-${n}-usable`)];
  if (['publish','refresh-draft'].includes(command)) required.push('numeric-input-visible-above-keyboard','notification-permission-granted','foreground-reminder-delivered','unhandled-interval-keeps-same-occurrence','acknowledgement-restarts-interval','background-system-notification-delivered','habit-paused');
  if (report.passed !== true || required.some(check => !report.checks.includes(check))) throw Error('Installed APK acceptance is incomplete');
  if (String(provenance.apkSourceRun) !== sourceRun || provenance.apkSourceSha !== sourceSha) throw Error('Tested APK provenance differs');
  if (fs.readFileSync(path.join(folder, 'APK-SHA256.txt'), 'utf8').split(/\s/)[0] !== apkHash) throw Error('Tested APK checksum differs');
  const files = [
    {name:'cat-dog-diary-android-0.1.1-internal.apk', file:path.join(root,'release',`android-ci-${sourceRun}`,'apk','app-release.apk'), expected:apkHash, type:'application/vnd.android.package-archive'},
    {name:'cat-dog-diary-1.1.0-beta.3-windows-x64.zip', file:path.join(root,'release','猫狗日记-1.1.0-beta.3-windows-x64.zip'), expected:winHash, type:'application/zip'},
    {name:'OFFLINE-BETA.md', file:path.join(root,'OFFLINE-BETA.md'), type:'text/markdown'},
    {name:'SHA256SUMS.txt', file:path.join(root,'release','offline-beta-SHA256SUMS.txt'), type:'text/plain'}
  ];
  for (const item of files) {
    item.sha256 = await hash(item.file); item.bytes = fs.statSync(item.file).size;
    if (item.expected && item.sha256 !== item.expected) throw Error(`Local checksum differs: ${item.name}`);
  }
  const sums = fs.readFileSync(files[3].file, 'utf8');
  for (const item of files.slice(0,3)) if (!sums.includes(`${item.sha256}  ${item.name}`)) throw Error(`Missing release checksum: ${item.name}`);
  const body = fs.readFileSync(path.join(root,'RELEASE-1.1.0-BETA.3.md'),'utf8');
  if (!body.includes(`actions/runs/${smokeRun}`)) throw Error('Release notes must identify the successful acceptance run');
  const credentials = execFileSync('git',['credential','fill'],{input:'protocol=https\nhost=github.com\n\n',encoding:'utf8',env:{...process.env,GIT_TERMINAL_PROMPT:'0',GCM_INTERACTIVE:'never'},stdio:['pipe','pipe','pipe']});
  const token = credentials.split(/\r?\n/).find(line => line.startsWith('password='))?.slice(9);
  if (!token) throw Error('GitHub credential unavailable');
  const headers = {Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'};
  const api = async (route, method='GET', data) => {
    const response = await fetch(`https://api.github.com/repos/${repo}/${route}`,{method,headers:{...headers,'Content-Type':'application/json'},body:data ? JSON.stringify(data) : undefined,signal:AbortSignal.timeout(30000)});
    if (!response.ok) throw Error(`GitHub API ${method} ${route}: ${response.status}`);
    return response.status===204?null:response.json();
  };
  const run = await api(`actions/runs/${smokeRun}`);
  if (run.conclusion !== 'success' || run.head_repository?.full_name !== repo || run.path !== '.github/workflows/android-native.yml' || run.head_sha !== provenance.smokeSha) throw Error('GitHub acceptance run is not successful or has changed provenance');
  console.log(JSON.stringify({verified:true,smokeRun,sourceRun,files:files.map(({name,sha256,bytes})=>({name,sha256,bytes}))},null,2));
  if (command === 'verify') return;
  const commit = execFileSync('git',['-c',`safe.directory=${root.replaceAll('\\','/')}`,'rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
  const remote = await api('commits/main');
  if (remote.sha !== commit) throw Error('Push the exact reviewed source before publishing');
  let release = (await api('releases?per_page=100')).find(item=>item.tag_name===tag);
  if (release && !release.prerelease) throw Error('Refusing to modify a stable release');
  if (!release) release = await api('releases','POST',{tag_name:tag,target_commitish:commit,name:'猫狗日记 · Android 0.1.1 / Windows 1.1.0-beta.3 离线内测',body,draft:true,prerelease:true,make_latest:'false'});
  const validateAsset = (asset,item) => {
    if (asset.state !== 'uploaded' || asset.size !== item.bytes || asset.digest !== `sha256:${item.sha256}`) throw Error(`Remote checksum/state differs; no asset will be overwritten: ${item.name}`);
  };
  for (const item of files) {
    const existing = release.assets.find(asset=>asset.name===item.name);
    if (existing) {
      const superseded={
        'cat-dog-diary-android-0.1.1-internal.apk':'af144f9f6ea4052a8668cbfa8f39f8497aef90f96e3f772fb76c169ccd6d05f6',
        'SHA256SUMS.txt':'9c89eba620276b692bb497f19b6489a63b8055696d611f0f5e8b161aeb00570e'
      };
      if(command==='refresh-draft'&&release.draft&&existing.digest===`sha256:${superseded[item.name]}`&&existing.digest!==`sha256:${item.sha256}`){
        await api(`releases/assets/${existing.id}`,'DELETE');
        console.log(`Replaced unpublished candidate asset only: ${item.name}; previous local artifact retained.`);
      }else{validateAsset(existing,item);console.log(`Verified existing asset: ${item.name}`);continue;}
    }
    if (!release.draft) throw Error('Published release is missing an asset; refusing to mutate it');
    const url = new URL(release.upload_url.split('{')[0]);
    if (url.hostname !== 'uploads.github.com' || !url.pathname.startsWith(`/repos/${repo}/releases/`)) throw Error('Unexpected upload destination');
    url.searchParams.set('name',item.name);
    console.log(`Uploading ${item.name} (${item.bytes} bytes)`);
    const stream = Readable.from((async function*(){
      let bytes=0,last=Date.now();
      for await(const chunk of fs.createReadStream(item.file)) {bytes+=chunk.length;if(Date.now()-last>15000){console.log(`${item.name}: ${bytes}/${item.bytes}`);last=Date.now();}yield chunk;}
    })());
    const response = await fetch(url,{method:'POST',headers:{...headers,'Content-Type':item.type,'Content-Length':String(item.bytes)},body:stream,duplex:'half',signal:AbortSignal.timeout(1800000)});
    if(!response.ok) throw Error(`Upload failed (${response.status}); the release stays a draft`);
    validateAsset(await response.json(),item);
  }
  release=await api(`releases/${release.id}`);
  for(const item of files) {const asset=release.assets.find(a=>a.name===item.name);if(!asset)throw Error('Release asset missing');validateAsset(asset,item);}
  if (release.draft && command === 'publish') release=await api(`releases/${release.id}`,'PATCH',{body,target_commitish:commit,draft:false,prerelease:true,make_latest:'false'});
  console.log(JSON.stringify({published:!release.draft,prerelease:release.prerelease,url:release.html_url,assets:release.assets.map(a=>({name:a.name,url:a.browser_download_url,digest:a.digest}))},null,2));
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
