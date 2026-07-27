const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  if (typeof callback !== 'function') throw new TypeError('监听器必须是函数。');
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('desktopAPI', {
  getBackgroundPreference: () => ipcRenderer.invoke('background-preference:get'),
  setBackgroundPreference: (mode) => ipcRenderer.invoke('background-preference:set', { mode }),
  getStudySettings: () => ipcRenderer.invoke('study-settings:get'),
  setStudySettings: (payload) => ipcRenderer.invoke('study-settings:set', payload),
  hideToBackground: (mode) => ipcRenderer.invoke('hide-to-background', { mode }),
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  toggleMaximizeWindow: () => ipcRenderer.invoke('window:toggle-maximize'),
  restoreSceneMode: () => ipcRenderer.invoke('restore-scene-mode'),
  forceRestoreSceneMode: () => ipcRenderer.invoke('force-restore-scene-mode'),
  acknowledgeWindowMode: (payload) => ipcRenderer.send('window-mode-ready', payload),
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
  getAudioEventState: () => ipcRenderer.invoke('audio-event:get-state'),
  classifyAudioEvents: (payload) => ipcRenderer.invoke('audio-event:classify', payload),
  quitApp: () => ipcRenderer.invoke('quit-app'),
  onWindowModeChanged: (callback) => {
    return subscribe('window-mode-changed', callback);
  },
  onFloatingHoverChanged: (callback) => {
    return subscribe('floating-hover-changed', callback);
  },
  onWindowMaximizedChanged: (callback) => {
    return subscribe('window-maximized-changed', callback);
  },
  onWindowCloseRequested: (callback) => {
    return subscribe('window-close-requested', callback);
  },
});

contextBridge.exposeInMainWorld('desktop', {
  showBreakPrompt: (payload) => ipcRenderer.invoke('break-prompt:show', payload),
  updateBreakPrompt: (payload) => ipcRenderer.invoke('break-prompt:update', payload),
  hideBreakPrompt: () => ipcRenderer.invoke('break-prompt:hide'),
  onBreakPromptAction: (callback) => subscribe('break-prompt:action', callback),
});
