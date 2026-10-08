const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const root=path.resolve(__dirname,'../dist'),port=Number(process.env.PORT||4173),host=process.env.HOST||'0.0.0.0';
const mount=process.env.MOUNT_PATH||'/';
if(!/^\/(?:[a-zA-Z0-9_-]+\/)*$/.test(mount))throw Error('MOUNT_PATH must start and end with /');
if(!fs.existsSync(path.join(root,'index.html')))throw Error('Run npm run build first');
const connections=fs.readFileSync(path.join(root,'index.html'),'utf8').match(/connect-src 'self'(?: https:\/\/[a-z0-9]{20}\.supabase\.co)?;/)?.[0];
if(!connections)throw Error('Invalid connection policy in the built site');
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.json':'application/json','.webmanifest':'application/manifest+json'};
http.createServer((req,res)=>{
  const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; "+connections+" object-src 'none'; base-uri 'none'; frame-ancestors 'self'; form-action 'self';"};
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,headers);res.end();return;}
  let requested;try{requested=decodeURIComponent(new URL(req.url,'http://localhost').pathname);}catch{res.writeHead(400,headers);res.end();return;}
  if(requested.includes('\\')||requested.includes('\0')||requested.split('/').some(x=>x.startsWith('.'))){res.writeHead(403,headers);res.end();return;}
  if(mount!=='/'&&requested===mount.slice(0,-1)){res.writeHead(308,{...headers,Location:mount});res.end();return;}
  if(!requested.startsWith(mount)){res.writeHead(404,headers);res.end('Not found');return;}
  requested='/'+requested.slice(mount.length);
  const file=path.resolve(root,'.'+(requested==='/'?'/index.html':requested));
  if(!file.startsWith(root+path.sep)||!types[path.extname(file)]||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404,headers);res.end('Not found');return;}
  res.writeHead(200,{...headers,'Content-Type':types[path.extname(file)]});if(req.method==='HEAD')res.end();else fs.createReadStream(file).pipe(res);
}).listen(port,host,()=>{
  console.log(`Computer: http://localhost:${port}${mount}`);
  if(host==='0.0.0.0')for(const entries of Object.values(os.networkInterfaces()))for(const n of entries||[])if(n.family==='IPv4'&&!n.internal)console.log(`Same-Wi-Fi candidate: http://${n.address}:${port}${mount}`);
  console.log('Serving only the built site. No Windows task data or filesystem API. Account connections use only the configured project.');
});
