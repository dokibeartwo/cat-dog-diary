// A renderer acknowledgement means a usable business frame, not just HTML load.
window.WindowReady={install(render,assets) {
  let current=null,serial=0,preparedKey=null;
  const timeout=(promise,ms)=>Promise.race([promise,new Promise(resolve=>setTimeout(resolve,ms))]);
  const prepare=async context=>{
    if(!context)return;
    const key=`${context.generation}:${context.requestId}`;
    if(key===preparedKey)return;preparedKey=key;current=context;const turn=++serial;
    try {
      render(context.state);
      await timeout(document.fonts.ready,1500);
      const urls=assets(context.state).filter(Boolean);
      await Promise.all(urls.map(async url=>{
        const img=new Image();img.src=url;
        try{await timeout(img.decode(),2000);}catch{/* Solid themed background remains usable. */}
      }));
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      if(turn!==serial)return;
      await window.doneAPI.uiReady({generation:context.generation,requestId:context.requestId});
    } catch {
      if(turn===serial)await window.doneAPI.uiFailed({generation:context.generation,requestId:context.requestId});
    }
  };
  window.doneAPI.onUiPrepare(prepare);
  window.doneAPI.getUiContext().then(prepare);
  window.addEventListener('error',()=>{if(current)window.doneAPI.uiFailed({generation:current.generation,requestId:current.requestId});});
}};
