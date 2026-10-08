// Starts only the built static website; never registers startup or changes the firewall.
const http=require('node:http'),path=require('node:path'),fs=require('node:fs'),{spawn}=require('node:child_process'),os=require('node:os');
const root=path.resolve(__dirname,'..');
function probe(){return new Promise(resolve=>{const request=http.get('http://127.0.0.1:4173/',response=>{let body='';response.setEncoding('utf8');response.on('data',part=>{body+=part;if(body.length>8192)request.destroy();});response.on('end',()=>resolve(response.statusCode===200&&body.includes('猫狗日记 · 手机')));});request.setTimeout(1500,()=>request.destroy());request.on('error',()=>resolve(false));});}
(async()=>{
 if(!fs.existsSync(path.join(root,'dist/index.html')))throw Error('Preview has not been built.');
 if(!await probe()){
  const log=fs.openSync(path.join(root,'preview-server.log'),'a'),err=fs.openSync(path.join(root,'preview-server-error.log'),'a');
  const child=spawn(process.execPath,[path.join(__dirname,'serve.cjs')],{cwd:root,detached:true,windowsHide:true,stdio:['ignore',log,err],env:{...process.env,HOST:'0.0.0.0',PORT:'4173'}});child.on('error',e=>{console.error(e.message);process.exitCode=1;});child.unref();fs.closeSync(log);fs.closeSync(err);
  let ready=false;for(let n=0;n<20;n++){if(await probe()){ready=true;break;}await new Promise(r=>setTimeout(r,250));}if(!ready)throw Error('Preview could not start. Check preview-server-error.log; port 4173 may be in use.');
 }
 console.log('\nPreview is running. Open this address on this computer:\nhttp://localhost:4173/\n');
 for(const entries of Object.values(os.networkInterfaces()))for(const n of entries||[])if(n.family==='IPv4'&&!n.internal&&!n.address.startsWith('169.254.'))console.log(`Phone on the same router: http://${n.address}:4173/`);
 console.log('\nKeep this computer powered on for local access. Demo data stays separate. Personal sync requires configured service, login and merge confirmation.');
 console.log('Use localhost on this computer for account testing. Phones should use the HTTPS public site after publication, not an HTTP LAN address.');
})().catch(e=>{console.error(e.message);process.exitCode=1;});
