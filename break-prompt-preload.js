const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  if (typeof callback !== 'function') throw new TypeError('监听器必须是函数。');
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('breakPrompt', {
  sendAction: (action) => ipcRenderer.send('break-prompt:action', action),
  onStateChanged: (callback) => subscribe('break-prompt:state', callback),
});
