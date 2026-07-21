const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  if (typeof callback !== 'function') throw new TypeError('监听器必须是函数。');
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('desktopAPI', {
  hideToBackground: () => ipcRenderer.invoke('hide-to-background'),
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  toggleMaximizeWindow: () => ipcRenderer.invoke('window:toggle-maximize'),
  restoreSceneMode: () => ipcRenderer.invoke('restore-scene-mode'),
  revealForInlineAlert: () => ipcRenderer.invoke('reveal-for-inline-alert'),
  finishInlineAlert: (payload) => ipcRenderer.invoke('finish-inline-alert', payload),
  getAnimationCanvas: () => ipcRenderer.invoke('get-animation-canvas'),
  getRuntimeWindowState: () => ipcRenderer.invoke('get-runtime-window-state'),
  getRuntimeCacheState: () => ipcRenderer.invoke('get-runtime-cache-state'),
  getSpeakerState: () => ipcRenderer.invoke('speaker:get-state'),
  beginSpeakerEnrollment: (payload) => ipcRenderer.invoke('speaker:begin-enrollment', payload),
  addSpeakerEnrollmentSample: (payload) => ipcRenderer.invoke('speaker:add-enrollment-sample', payload),
  finishSpeakerEnrollment: () => ipcRenderer.invoke('speaker:finish-enrollment'),
  cancelSpeakerEnrollment: () => ipcRenderer.invoke('speaker:cancel-enrollment'),
  verifySpeaker: (payload) => ipcRenderer.invoke('speaker:verify', payload),
  deleteSpeakerProfile: (profileId) => ipcRenderer.invoke('speaker:delete-profile', { profileId }),
  quitApp: () => ipcRenderer.invoke('quit-app'),
  onWindowModeChanged: (callback) => {
    return subscribe('window-mode-changed', callback);
  },
  onWindowMaximizedChanged: (callback) => {
    return subscribe('window-maximized-changed', callback);
  },
});

contextBridge.exposeInMainWorld('desktop', {
  showBreakPrompt: (payload) => ipcRenderer.invoke('break-prompt:show', payload),
  updateBreakPrompt: (payload) => ipcRenderer.invoke('break-prompt:update', payload),
  hideBreakPrompt: () => ipcRenderer.invoke('break-prompt:hide'),
  onBreakPromptAction: (callback) => subscribe('break-prompt:action', callback),
});
