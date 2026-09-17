(() => {
  let active=null;
  const dialog=document.createElement('dialog');dialog.className='theme-confirm';dialog.id='themeConfirm';
  dialog.setAttribute('aria-labelledby','themeConfirmTitle');dialog.setAttribute('aria-describedby','themeConfirmMessage');
  dialog.innerHTML='<div class="confirm-brand"><img src="assets/bear-authenticity.png" alt=""/><span>猫狗日记</span></div><h2 id="themeConfirmTitle"></h2><p id="themeConfirmMessage"></p><div class="confirm-actions"><button id="themeConfirmCancel" type="button">取消</button><button id="themeConfirmAccept" type="button">确定</button></div>';
  document.body.append(dialog);
  const cancel=dialog.querySelector('#themeConfirmCancel'), accept=dialog.querySelector('#themeConfirmAccept');
  function finish(value) {
    if(!active)return;const pending=active;active=null;
    if(dialog.open)dialog.close();pending.resolve(value);
    if(pending.previous?.isConnected)pending.previous.focus({preventScroll:true});
  }
  cancel.addEventListener('click',()=>finish(false));accept.addEventListener('click',()=>finish(true));
  dialog.addEventListener('cancel',event=>{event.preventDefault();finish(false);});
  dialog.addEventListener('close',()=>finish(false));
  dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)finish(false);}});
  dialog.addEventListener('keydown',event=>{
    if(event.key==='Tab'){event.preventDefault();(document.activeElement===cancel?accept:cancel).focus();}
  });
  window.addEventListener('pagehide',()=>finish(false));
  window.ThemeConfirm={
    isOpen:()=>Boolean(active),cancel:()=>finish(false),
    ask({title='请确认',message='',confirmLabel='确定',cancelLabel='取消',danger=false}={}) {
      if(active)return Promise.resolve(false);
      document.dispatchEvent(new CustomEvent('theme-popup-opening',{detail:dialog}));
      dialog.querySelector('#themeConfirmTitle').textContent=title;
      dialog.querySelector('#themeConfirmMessage').textContent=message;
      accept.textContent=confirmLabel;cancel.textContent=cancelLabel;dialog.classList.toggle('is-danger',danger);
      return new Promise(resolve=>{active={resolve,previous:document.activeElement};dialog.showModal();cancel.focus({preventScroll:true});});
    }
  };
})();
