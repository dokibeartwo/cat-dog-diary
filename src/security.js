'use strict';
const {pathToFileURL} = require('node:url');

function assertTrustedSender(event, pages) {
  const page = pages.find(({window}) => window && !window.isDestroyed() && window.webContents === event?.sender);
  if (!page || !event.senderFrame || event.senderFrame !== event.sender.mainFrame
      || event.senderFrame.url !== pathToFileURL(page.file).href) {
    throw Error('此页面无权操作猫狗日记数据');
  }
}

function secureContents(contents) {
  contents.setWindowOpenHandler(() => ({action:'deny'}));
  for (const name of ['will-navigate','will-frame-navigate','will-redirect','will-attach-webview']) {
    contents.on(name, event => event.preventDefault());
  }
  contents.session.setPermissionRequestHandler((_webContents,_permission,callback) => callback(false));
  contents.session.setPermissionCheckHandler(() => false);
}

module.exports = {assertTrustedSender, secureContents};
