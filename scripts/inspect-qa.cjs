// Local development diagnostic only. The QA process exposes no real user data.
const timeout=setTimeout(()=>{console.error('inspector timeout');process.exit(1);},8000);
(async()=>{
  const targets=await (await fetch('http://127.0.0.1:9333/json/list')).json();
  const socket=new WebSocket(targets[0].webSocketDebuggerUrl);
  socket.addEventListener('open',()=>socket.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression:process.argv[2] || "({visible:qaV1.main().isVisible(),url:qaV1.main().webContents.getURL(),tasks:qaV1.state().tasks.length,theme:qaV1.state().preferences.themeId})",awaitPromise:true,returnByValue:true}})));
  socket.addEventListener('message',message=>{const data=JSON.parse(message.data);if(data.id===1){console.log(JSON.stringify(data));socket.close();clearTimeout(timeout);}});
})().catch(error=>{console.error(error);clearTimeout(timeout);process.exit(1);});
