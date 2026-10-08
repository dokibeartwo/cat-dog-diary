// Fail closed before uploading: only the static UI, reviewed art and pure rules.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../dist');
const exact=new Set(['index.html','.nojekyll','manifest.webmanifest','assets/bear.png','assets/icon.png',
 ...Array.from({length:6},(_,i)=>'assets/themes/bg'+(i+1)+'.jpg'),
 ...Array.from({length:4},(_,i)=>'assets/screens/screen'+(i+1)+'.jpg'),
 ...['domain','diary-v1','productivity','runtime','sync-core'].map(n=>'shared/'+n+'.js')]);
const files=[];
function walk(dir){
 for(const name of fs.readdirSync(dir)){
  const full=path.join(dir,name),stat=fs.lstatSync(full);
  assert(!stat.isSymbolicLink(),'A publication asset must not be a link');
  if(stat.isDirectory()){walk(full);continue;}
  const rel=path.relative(root,full).split(path.sep).join('/');
  assert(exact.has(rel)||/^assets\/index-[a-zA-Z0-9_-]+\.(js|css)$/.test(rel),'Unexpected public file: '+rel);
  assert(stat.size<8*1024*1024,'Unexpectedly large asset: '+rel);
  if(/\.(html|js|css|webmanifest)$/.test(name)){
   const content=fs.readFileSync(full,'utf8');
   assert(!/(?:gh[pousr]_[A-Za-z0-9]{25,}|github_pat_[A-Za-z0-9_]{25,}|sb_secret_[A-Za-z0-9_-]{15,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/.test(content),'Potential credential in '+rel);
   assert(!/(?:["'`(])\/(?:assets|shared)\//.test(content),'Root-absolute public URL in '+rel);
  }
  files.push(rel);
 }
}
walk(root);
for(const rel of exact)assert(files.includes(rel),'Missing public file: '+rel);
assert(files.some(f=>/^assets\/index-.*\.js$/.test(f)),'Missing application bundle');
assert(files.some(f=>/^assets\/index-.*\.css$/.test(f)),'Missing application styles');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
assert(html.includes('Content-Security-Policy')&&html.includes("connect-src 'self'"),'Missing public-site security policy');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.webmanifest'),'utf8'));
assert.equal(manifest.start_url,'./');assert.equal(manifest.scope,'./');
console.log('Public asset allowlist passed: '+files.length+' static files; no source, runtime, logs, backups or task databases.');
