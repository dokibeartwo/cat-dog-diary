'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {assertTrustedSender,secureContents}=require('../src/security');
test('IPC accepts exact owned main frame, rejects subframe, remote, unrelated and destroyed windows',()=>{
  const file=path.join(__dirname,'../src/renderer/index.html');
  const sender={mainFrame:{url:pathToFileURL(file).href}};
  const window={webContents:sender,isDestroyed:()=>false};
  const pages=[{window,file}];
  assert.doesNotThrow(()=>assertTrustedSender({sender,senderFrame:sender.mainFrame},pages));
  assert.throws(()=>assertTrustedSender({sender,senderFrame:{url:sender.mainFrame.url}},pages));
  assert.throws(()=>assertTrustedSender({sender:{}},pages));
  sender.mainFrame.url='https://example.com/';
  assert.throws(()=>assertTrustedSender({sender,senderFrame:sender.mainFrame},pages));
  sender.mainFrame.url=pathToFileURL(file).href;window.isDestroyed=()=>true;
  assert.throws(()=>assertTrustedSender({sender,senderFrame:sender.mainFrame},pages));
});
test('new windows, navigation and permission requests are denied',()=>{
  const handlers={};const contents={on:(key,fn)=>handlers[key]=fn,setWindowOpenHandler:fn=>handlers.open=fn,
    session:{setPermissionRequestHandler:fn=>handlers.request=fn,setPermissionCheckHandler:fn=>handlers.check=fn}};
  secureContents(contents);assert.equal(handlers.open().action,'deny');
  for(const name of ['will-navigate','will-frame-navigate','will-redirect','will-attach-webview']){
    let denied=false;handlers[name]({preventDefault(){denied=true;}});assert.equal(denied,true);
  }
  handlers.request(null,'media',result=>assert.equal(result,false));assert.equal(handlers.check(),false);
});
