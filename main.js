const {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  Tray,
  nativeImage,
  protocol,
  screen,
  session,
} = require('electron');
const path = require('node:path');
const fsSync = require('node:fs');
const fs = require('node:fs/promises');
const { spawn } = require('node:child_process');
const { SpeakerService } = require('./speaker-service');
const { AudioEventService } = require('./audio-event-service');
const { createProfileCrypto } = require('./profile-crypto');
const {
  clampFloatingBounds,
  floatingWindowBounds,
  readBackgroundPreference,
  resolveAlertReturnMode,
  validateBackgroundModePayload,
  validateFinishAlertPayload,
  validateWindowModeReadyPayload,
  writeBackgroundPreference,
} = require('./window-mode-policy');

const presentationCanvas = { width: 1920, height: 1080 };
const mainRendererUrl = 'rwt://renderer/index.html';
const breakPromptRendererUrl = 'rwt://renderer/break-prompt.html';

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-http-cache');
app.setName('背书自习监督');

// Keep deliberately saved speaker data separate from Chromium's per-run files.
const persistentDataRoot = process.env.SUPERVISION_DATA_DIR
  || path.join(app.getPath('appData'), '背书自习监督');
fsSync.mkdirSync(persistentDataRoot, { recursive: true });
const windowPreferencePath = path.join(persistentDataRoot, 'window-preferences.json');
const transientSessionParent = path.join(persistentDataRoot, 'TransientElectronData');
fsSync.mkdirSync(transientSessionParent, { recursive: true });

for (const entry of fsSync.readdirSync(transientSessionParent, { withFileTypes: true })) {
  if (!entry.isDirectory() || !/^run-(\d+)$/.test(entry.name)) continue;
  const stalePid = Number(entry.name.slice('run-'.length));
  let stillRunning = false;
  try {
    process.kill(stalePid, 0);
    stillRunning = true;
  } catch {}
  if (!stillRunning) {
    fsSync.rmSync(path.join(transientSessionParent, entry.name), { recursive: true, force: true });
  }
}

const transientSessionDataRoot = path.join(transientSessionParent, `run-${process.pid}`);
fsSync.mkdirSync(transientSessionDataRoot, { recursive: true });
// Keep Electron's default, stable userData path for Windows safeStorage. Only
// sessionData is per-run and cleaned on exit, so browser session caches do not
// become durable application data.
app.setPath('sessionData', transientSessionDataRoot);
const runtimeSessionPartition = 'rwt-runtime';

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'rwt',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

let mainWindow = null;
let tray = null;
let isQuitting = false;
let mainWindowMode = 'scene';
let speakerService = null;
let audioEventService = null;
let breakPromptWindow = null;
let breakPromptState = null;
let breakPromptSuppressedForAlert = false;
let isDestroyingBreakPrompt = false;
let runtimeSession = null;
let inlineAlertSequence = 0;
let inlineAlertState = null;
let floatingRestoreBounds = null;
let mainWindowSkipsTaskbar = false;
let windowModeTransitionSequence = 0;
let windowTransitionChain = Promise.resolve();
let backgroundPreferenceWriteChain = Promise.resolve();
const pendingWindowModeTransitions = new Map();
let backgroundPreference = readBackgroundPreference(windowPreferencePath);

const speakerModelFile = '3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx';
const audioEventModelDirectory = 'audio-tagging-ced-mini';
const breakPromptSize = Object.freeze({ width: 420, height: 220 });
const breakPromptMargin = 20;
const sceneMinimumSize = Object.freeze({ width: 960, height: 540 });
const floatingWindowSize = Object.freeze({ width: 320, height: 225 });
const floatingWindowMargin = 16;
const windowModeRenderTimeoutMs = 1000;

const contentTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.svg', 'image/svg+xml'],
  ['.ico', 'image/x-icon'],
]);

function registerLocalProtocol(targetSession) {
  targetSession.protocol.handle('rwt', async (request) => {
    const url = new URL(request.url);
    const roots = { renderer: path.join(__dirname, 'renderer') };
    const root = roots[url.hostname];
    if (!root) return new Response('Not found', { status: 404 });

    const relativePath = decodeURIComponent(url.pathname).replace(/^[/\\]+/, '');
    const resolved = path.resolve(root, relativePath);
    const relative = path.relative(root, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      return new Response('Forbidden', { status: 403 });
    }

    try {
      const data = await fs.readFile(resolved);
      const type = contentTypes.get(path.extname(resolved).toLowerCase()) || 'application/octet-stream';
      return new Response(data, {
        status: 200,
        headers: {
          'Content-Type': type,
          'Cache-Control': 'no-store',
          'Access-Control-Allow-Origin': '*',
        },
      });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

function currentDisplay() {
  if (!mainWindow || mainWindow.isDestroyed()) return screen.getPrimaryDisplay();
  return screen.getDisplayMatching(mainWindow.getBounds());
}

function fitPresentationBounds(display) {
  const area = display.workArea;
  const displayScale = Math.max(1, display.scaleFactor || 1);
  const targetWidth = presentationCanvas.width / displayScale;
  const targetHeight = presentationCanvas.height / displayScale;
  const scale = Math.min(1, area.width / targetWidth, area.height / targetHeight);
  const contentWidth = Math.floor(targetWidth * scale);
  const contentHeight = Math.floor(targetHeight * scale);
  return {
    x: Math.round(area.x + (area.width - contentWidth) / 2),
    y: Math.round(area.y + (area.height - contentHeight) / 2),
    width: contentWidth,
    height: contentHeight,
  };
}

function breakPromptBounds() {
  const display = mainWindow && !mainWindow.isDestroyed()
    ? screen.getDisplayMatching(mainWindow.getBounds())
    : screen.getPrimaryDisplay();
  const area = display.workArea;
  return {
    x: Math.max(area.x, area.x + area.width - breakPromptSize.width - breakPromptMargin),
    y: Math.max(area.y, area.y + area.height - breakPromptSize.height - breakPromptMargin),
    ...breakPromptSize,
  };
}

function setFloatingBounds(bounds) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.setBounds(bounds, false);
}

function positionFloatingWindow({ avoidBreakPrompt = false, useSavedPosition = true } = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const display = currentDisplay();
  const area = display.workArea;
  const defaultBounds = floatingWindowBounds(area, {
    size: floatingWindowSize,
    margin: floatingWindowMargin,
  });
  if (!floatingRestoreBounds) floatingRestoreBounds = { ...defaultBounds };
  let bounds;
  if (useSavedPosition && floatingRestoreBounds && !avoidBreakPrompt) {
    bounds = clampFloatingBounds(floatingRestoreBounds, area, floatingWindowSize);
  } else {
    bounds = floatingWindowBounds(area, {
      size: floatingWindowSize,
      margin: floatingWindowMargin,
      avoidBottomRight: avoidBreakPrompt ? breakPromptBounds() : null,
    });
  }
  setFloatingBounds(bounds);
}

function restoreFloatingPositionAfterPrompt() {
  if (mainWindowMode !== 'floating') return;
  positionFloatingWindow({ avoidBreakPrompt: false, useSavedPosition: true });
}

function validateBreakPromptPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('休息提示参数无效。');
  }
  const allowedKeys = new Set(['kind', 'credits', 'remainingSeconds']);
  const keys = Object.keys(payload);
  if (keys.length !== allowedKeys.size || keys.some((key) => !allowedKeys.has(key))) {
    throw new Error('休息提示参数字段无效。');
  }
  if (payload.kind !== 'earned' && payload.kind !== 'resting') {
    throw new Error('休息提示类型无效。');
  }
  if (!Number.isSafeInteger(payload.credits) || payload.credits < 0) {
    throw new Error('休息券数量无效。');
  }
  if (!Number.isSafeInteger(payload.remainingSeconds) || payload.remainingSeconds < 0) {
    throw new Error('休息倒计时无效。');
  }
  return {
    kind: payload.kind,
    credits: payload.credits,
    remainingSeconds: payload.remainingSeconds,
  };
}

function sendBreakPromptState() {
  if (!breakPromptState || !breakPromptWindow || breakPromptWindow.isDestroyed()) return;
  const contents = breakPromptWindow.webContents;
  if (contents.isDestroyed() || contents.isLoadingMainFrame()) return;
  contents.send('break-prompt:state', { ...breakPromptState });
}

function presentBreakPrompt() {
  if (!breakPromptWindow || breakPromptWindow.isDestroyed()) return;
  if (breakPromptWindow.webContents.isLoadingMainFrame()) return;
  if (mainWindowMode === 'alert' && inlineAlertState) {
    breakPromptSuppressedForAlert = true;
    breakPromptWindow.hide();
    return;
  }
  breakPromptSuppressedForAlert = false;
  breakPromptWindow.setBounds(breakPromptBounds(), false);
  breakPromptWindow.setAlwaysOnTop(true, 'floating');
  breakPromptWindow.showInactive();
  if (mainWindowMode === 'floating') {
    positionFloatingWindow({ avoidBreakPrompt: true, useSavedPosition: false });
  }
}

function createBreakPromptWindow() {
  if (breakPromptWindow && !breakPromptWindow.isDestroyed()) return breakPromptWindow;
  const prompt = new BrowserWindow({
    ...breakPromptBounds(),
    useContentSize: true,
    frame: false,
    show: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    title: '背书自习监督 · 休息券',
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    autoHideMenuBar: true,
    backgroundColor: '#160c0b',
    webPreferences: {
      preload: path.join(__dirname, 'break-prompt-preload.js'),
      session: runtimeSession,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      spellcheck: false,
      v8CacheOptions: 'none',
    },
  });
  breakPromptWindow = prompt;
  prompt.setMenuBarVisibility(false);
  lockWebContentsNavigation(prompt.webContents, breakPromptRendererUrl);
  prompt.webContents.on('did-finish-load', () => {
    if (prompt !== breakPromptWindow || prompt.isDestroyed()) return;
    if (!breakPromptState || prompt.webContents.isDestroyed()) return;
    prompt.webContents.send('break-prompt:state', { ...breakPromptState });
    presentBreakPrompt();
  });
  prompt.on('close', (event) => {
    if (isQuitting || isDestroyingBreakPrompt) return;
    event.preventDefault();
    prompt.hide();
  });
  prompt.on('closed', () => {
    if (breakPromptWindow === prompt) breakPromptWindow = null;
  });
  prompt.loadURL(breakPromptRendererUrl);
  return prompt;
}

function destroyBreakPromptWindow() {
  const prompt = breakPromptWindow;
  breakPromptState = null;
  breakPromptSuppressedForAlert = false;
  if (!prompt || prompt.isDestroyed()) {
    breakPromptWindow = null;
    return;
  }
  isDestroyingBreakPrompt = true;
  try {
    prompt.destroy();
  } finally {
    isDestroyingBreakPrompt = false;
    if (breakPromptWindow === prompt) breakPromptWindow = null;
  }
}

function sendWindowMode(mode, extra = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('window-mode-changed', { mode, ...extra });
}

function requestWindowModeRender(mode, extra = {}) {
  const window = mainWindow;
  if (
    !window
    || window.isDestroyed()
    || window.webContents.isDestroyed()
    || window.webContents.isLoadingMainFrame()
  ) return Promise.resolve(false);

  const transitionId = ++windowModeTransitionSequence;
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      pendingWindowModeTransitions.delete(transitionId);
      resolve(false);
    }, windowModeRenderTimeoutMs);
    pendingWindowModeTransitions.set(transitionId, { mode, resolve, timeout });
    window.webContents.send('window-mode-changed', { ...extra, mode, transitionId });
  });
}

function completeWindowModeTransition(payload) {
  const { transitionId, mode } = validateWindowModeReadyPayload(payload);
  const pending = pendingWindowModeTransitions.get(transitionId);
  if (!pending || pending.mode !== mode) return false;
  clearTimeout(pending.timeout);
  pendingWindowModeTransitions.delete(transitionId);
  pending.resolve(true);
  return true;
}

function clearPendingWindowModeTransitions() {
  for (const pending of pendingWindowModeTransitions.values()) {
    clearTimeout(pending.timeout);
    pending.resolve(false);
  }
  pendingWindowModeTransitions.clear();
}

function enqueueWindowTransition(task) {
  const result = windowTransitionChain.then(task, task);
  windowTransitionChain = result.catch(() => {});
  return result;
}

function setMainWindowSkipTaskbar(value) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.setSkipTaskbar(value);
  mainWindowSkipsTaskbar = Boolean(value);
}

function failClosedWindowTransition(expectedMode) {
  if (!mainWindow || mainWindow.isDestroyed()) return runtimeWindowState();
  inlineAlertState = null;
  mainWindowMode = 'hidden';
  mainWindow.setAlwaysOnTop(false);
  setMainWindowSkipTaskbar(true);
  sendWindowMode('hidden');
  mainWindow.hide();
  return { renderTimedOut: true, expectedMode, ...runtimeWindowState() };
}

function suppressBreakPromptForAlert() {
  if (!breakPromptState || !breakPromptWindow || breakPromptWindow.isDestroyed()) return;
  breakPromptSuppressedForAlert = true;
  breakPromptWindow.hide();
}

function restoreBreakPromptAfterAlert() {
  if (!breakPromptSuppressedForAlert) return;
  breakPromptSuppressedForAlert = false;
  if (breakPromptState && breakPromptWindow && !breakPromptWindow.isDestroyed()) {
    presentBreakPrompt();
  }
}

function sendWindowMaximized() {
  const window = mainWindow;
  if (!window || window.isDestroyed()) return;
  const contents = window.webContents;
  if (contents.isDestroyed()) return;
  contents.send('window-maximized-changed', {
    maximized: window.isMaximized(),
  });
}

function createMainWindow() {
  const bounds = fitPresentationBounds(screen.getPrimaryDisplay());
  mainWindow = new BrowserWindow({
    ...bounds,
    minWidth: sceneMinimumSize.width,
    minHeight: sceneMinimumSize.height,
    resizable: true,
    minimizable: true,
    maximizable: true,
    fullscreen: false,
    frame: false,
    show: false,
    title: '背书自习监督',
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    autoHideMenuBar: true,
    backgroundColor: '#120c0b',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      session: runtimeSession,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      spellcheck: false,
      v8CacheOptions: 'none',
    },
  });

  lockWebContentsNavigation(mainWindow.webContents, mainRendererUrl);
  mainWindow.loadURL(mainRendererUrl);
  mainWindow.once('ready-to-show', () => {
    mainWindowMode = 'scene';
    mainWindow.show();
  });
  mainWindow.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    const contents = mainWindow.webContents;
    if (!contents.isDestroyed() && !contents.isLoadingMainFrame()) {
      contents.send('window-close-requested');
    } else {
      hideToBackground('hidden').catch(() => {});
    }
  });
  mainWindow.on('maximize', sendWindowMaximized);
  mainWindow.on('unmaximize', sendWindowMaximized);
  mainWindow.on('minimize', () => sendWindowMode(mainWindowMode, { minimized: true }));
  mainWindow.on('will-move', (_event, nextBounds) => {
    if (mainWindowMode !== 'floating') return;
    const display = screen.getDisplayMatching(nextBounds);
    floatingRestoreBounds = clampFloatingBounds(nextBounds, display.workArea, floatingWindowSize);
  });
  mainWindow.on('closed', () => {
    clearPendingWindowModeTransitions();
    mainWindow = null;
    mainWindowSkipsTaskbar = false;
    destroyBreakPromptWindow();
  });
}

async function showSceneWindowNow({ force = false } = {}) {
  if (!mainWindow) createMainWindow();
  if (!mainWindow || mainWindow.isDestroyed()) return runtimeWindowState();
  if (!force && mainWindowMode === 'alert' && inlineAlertState) {
    return { blockedByAlert: true, ...runtimeWindowState() };
  }
  if (mainWindowMode === 'scene' && !inlineAlertState) {
    mainWindow.setAlwaysOnTop(false);
    setMainWindowSkipTaskbar(false);
    if (mainWindow.isMinimized()) mainWindow.restore();
    else if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
    return runtimeWindowState();
  }
  const targetDisplay = currentDisplay();
  mainWindow.hide();
  inlineAlertState = null;
  mainWindowMode = 'scene';
  mainWindow.setMinimumSize(sceneMinimumSize.width, sceneMinimumSize.height);
  mainWindow.setAlwaysOnTop(false);
  setMainWindowSkipTaskbar(false);
  mainWindow.setResizable(true);
  mainWindow.setMinimizable(true);
  mainWindow.setMaximizable(true);
  mainWindow.setFullScreen(false);
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  mainWindow.setBounds(fitPresentationBounds(targetDisplay), false);
  const rendered = await requestWindowModeRender('scene');
  if (!rendered) return failClosedWindowTransition('scene');
  if (mainWindow.isMinimized()) mainWindow.restore();
  else mainWindow.show();
  mainWindow.focus();
  return runtimeWindowState();
}

function showSceneWindow(options = {}) {
  return enqueueWindowTransition(() => showSceneWindowNow(options));
}

async function showFloatingWindowNow() {
  if (!mainWindow) createMainWindow();
  if (!mainWindow || mainWindow.isDestroyed()) return runtimeWindowState();
  if (mainWindowMode === 'alert' && inlineAlertState) {
    return { blockedByAlert: true, ...runtimeWindowState() };
  }
  if (mainWindowMode === 'floating') {
    mainWindow.setAlwaysOnTop(true, 'floating');
    setMainWindowSkipTaskbar(true);
    positionFloatingWindow({
      avoidBreakPrompt: Boolean(breakPromptState && breakPromptWindow?.isVisible()),
      useSavedPosition: true,
    });
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (!mainWindow.isVisible()) mainWindow.showInactive();
    mainWindow.blur();
    return runtimeWindowState();
  }
  inlineAlertState = null;
  mainWindow.hide();
  mainWindowMode = 'floating';
  mainWindow.setFullScreen(false);
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  mainWindow.setMinimumSize(floatingWindowSize.width, floatingWindowSize.height);
  mainWindow.setResizable(false);
  mainWindow.setMinimizable(false);
  mainWindow.setMaximizable(false);
  setMainWindowSkipTaskbar(true);
  mainWindow.setAlwaysOnTop(true, 'floating');
  positionFloatingWindow({
    avoidBreakPrompt: Boolean(breakPromptState && breakPromptWindow?.isVisible()),
    useSavedPosition: true,
  });
  const rendered = await requestWindowModeRender('floating');
  if (!rendered) return failClosedWindowTransition('floating');
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.showInactive();
  mainWindow.blur();
  return runtimeWindowState();
}

function showFloatingWindow() {
  return enqueueWindowTransition(() => showFloatingWindowNow());
}

async function hideToBackgroundNow(mode = 'hidden') {
  if (!mainWindow || mainWindow.isDestroyed()) return runtimeWindowState();
  if (mainWindowMode === 'alert' && inlineAlertState) {
    return { blockedByAlert: true, ...runtimeWindowState() };
  }
  if (mode === 'floating') return showFloatingWindowNow();
  if (mainWindowMode === 'hidden') {
    mainWindow.hide();
    return runtimeWindowState();
  }
  inlineAlertState = null;
  mainWindowMode = 'hidden';
  mainWindow.setAlwaysOnTop(false);
  setMainWindowSkipTaskbar(true);
  sendWindowMode('hidden');
  mainWindow.hide();
  return runtimeWindowState();
}

function hideToBackground(mode = 'hidden') {
  return enqueueWindowTransition(() => hideToBackgroundNow(mode));
}

async function revealForInlineAlertNow() {
  if (!mainWindow) createMainWindow();
  if (!mainWindow || mainWindow.isDestroyed()) return { alertId: 0, returnMode: 'scene' };
  if (mainWindowMode === 'alert' && inlineAlertState) return { ...inlineAlertState };
  const returnMode = resolveAlertReturnMode(mainWindowMode, mainWindow.isVisible());
  const targetDisplay = currentDisplay();
  if (returnMode === 'floating') floatingRestoreBounds = mainWindow.getBounds();
  suppressBreakPromptForAlert();
  inlineAlertState = { alertId: ++inlineAlertSequence, returnMode };
  mainWindow.hide();
  mainWindowMode = 'alert';
  mainWindow.setFullScreen(false);
  mainWindow.setMinimumSize(sceneMinimumSize.width, sceneMinimumSize.height);
  mainWindow.setResizable(true);
  mainWindow.setMinimizable(false);
  mainWindow.setMaximizable(false);
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  mainWindow.setBounds(fitPresentationBounds(targetDisplay), false);
  setMainWindowSkipTaskbar(false);
  mainWindow.setAlwaysOnTop(true, 'screen-saver');
  const rendered = await requestWindowModeRender('alert');
  if (!rendered) {
    const failed = failClosedWindowTransition('alert');
    restoreBreakPromptAfterAlert();
    throw Object.assign(new Error('提醒窗口布局未能及时就绪。'), { windowState: failed });
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  else mainWindow.show();
  mainWindow.focus();
  return { ...inlineAlertState };
}

function revealForInlineAlert() {
  return enqueueWindowTransition(() => revealForInlineAlertNow());
}

async function finishInlineAlertNow(payload) {
  const { alertId, disposition } = validateFinishAlertPayload(payload);
  if (!mainWindow || mainWindow.isDestroyed()) return { ignored: true };
  if (!inlineAlertState || inlineAlertState.alertId !== alertId || mainWindowMode !== 'alert') {
    return { ignored: true, ...runtimeWindowState() };
  }
  const returnMode = disposition === 'scene' ? 'scene' : inlineAlertState.returnMode;
  inlineAlertState = null;
  try {
    if (returnMode === 'floating') return await showFloatingWindowNow();
    if (returnMode === 'hidden') return await hideToBackgroundNow('hidden');
    return await showSceneWindowNow({ force: true });
  } finally {
    restoreBreakPromptAfterAlert();
  }
}

function finishInlineAlert(payload) {
  return enqueueWindowTransition(() => finishInlineAlertNow(payload));
}

function runtimeWindowState() {
  const window = mainWindow;
  if (!window || window.isDestroyed()) {
    return {
      mode: mainWindowMode,
      windowCount: BrowserWindow.getAllWindows().length,
      webContentsId: 0,
      visible: false,
      minimized: false,
      maximized: false,
      minimumSize: { width: 0, height: 0 },
      bounds: null,
      alwaysOnTop: false,
      skipTaskbar: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
    };
  }
  const contents = window.webContents;
  const [minimumWidth, minimumHeight] = window.getMinimumSize();
  return {
    mode: mainWindowMode,
    windowCount: BrowserWindow.getAllWindows().length,
    webContentsId: contents.isDestroyed() ? 0 : contents.id,
    visible: window.isVisible(),
    minimized: window.isMinimized(),
    maximized: window.isMaximized(),
    minimumSize: { width: minimumWidth, height: minimumHeight },
    bounds: window.getBounds(),
    alwaysOnTop: window.isAlwaysOnTop(),
    skipTaskbar: mainWindowSkipsTaskbar,
    resizable: window.isResizable(),
    minimizable: window.isMinimizable(),
    maximizable: window.isMaximizable(),
  };
}

function runtimeCacheState() {
  return {
    inMemory: Boolean(runtimeSession) && runtimeSession.getStoragePath() === null,
    httpCacheDisabled: true,
    v8CacheDisabled: true,
  };
}

function clearTransientSessionData() {
  try {
    fsSync.rmSync(transientSessionDataRoot, { recursive: true, force: true });
    fsSync.rmdirSync(transientSessionParent);
  } catch (error) {
    if (error?.code !== 'ENOTEMPTY' && error?.code !== 'ENOENT') {
      console.warn('[cache] unable to remove transient session data:', error?.message || error);
    }
  }
}

function scheduleTransientSessionDataCleanup() {
  try {
    const child = spawn(
      process.execPath,
      [path.join(__dirname, 'cache-cleanup.js'), transientSessionDataRoot, String(process.pid)],
      {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      },
    );
    child.unref();
  } catch (error) {
    console.warn('[cache] unable to schedule transient session cleanup:', error?.message || error);
  }
}

function minimizeMainWindowNow() {
  if (!mainWindow || mainWindow.isDestroyed()) return runtimeWindowState();
  if (mainWindowMode !== 'scene' || inlineAlertState) {
    return { blockedByMode: true, ...runtimeWindowState() };
  }
  mainWindow.minimize();
  return runtimeWindowState();
}

function minimizeMainWindow() {
  return enqueueWindowTransition(() => minimizeMainWindowNow());
}

function toggleMainWindowMaximizedNow() {
  if (!mainWindow || mainWindow.isDestroyed()) return runtimeWindowState();
  if (mainWindowMode !== 'scene' || inlineAlertState) {
    return { blockedByMode: true, ...runtimeWindowState() };
  }
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
  return runtimeWindowState();
}

function toggleMainWindowMaximized() {
  return enqueueWindowTransition(() => toggleMainWindowMaximizedNow());
}

function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'icon.ico');
  const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip('背书自习监督');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开督学场景', click: showSceneWindow },
    { label: '显示漂浮窗', click: () => hideToBackground('floating') },
    { label: '完全隐藏', click: () => hideToBackground('hidden') },
    { type: 'separator' },
    { label: '退出程序', click: quitApp },
  ]));
  tray.on('double-click', showSceneWindow);
}

function quitApp() {
  isQuitting = true;
  destroyBreakPromptWindow();
  app.quit();
}

function unpackedResourcePath(...segments) {
  if (!app.isPackaged) return path.join(__dirname, ...segments);
  return path.join(process.resourcesPath, 'app.asar.unpacked', ...segments);
}

function lockWebContentsNavigation(contents, expectedUrl) {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const rejectUnexpectedNavigation = (event) => {
    if (!event.isMainFrame || event.url !== expectedUrl) event.preventDefault();
  };
  contents.on('will-frame-navigate', rejectUnexpectedNavigation);
  contents.on('will-navigate', rejectUnexpectedNavigation);
  contents.on('will-redirect', rejectUnexpectedNavigation);
}

function isTrustedWindowRenderer(event, window, expectedUrl) {
  if (!event || !window || window.isDestroyed()) return false;
  const contents = window.webContents;
  if (contents.isDestroyed()) return false;
  const mainFrame = contents.mainFrame;
  return event.sender === contents
    && event.senderFrame === mainFrame
    && mainFrame.url === expectedUrl
    && contents.getURL() === expectedUrl;
}

function isTrustedRenderer(event) {
  return isTrustedWindowRenderer(event, mainWindow, mainRendererUrl);
}

function isTrustedBreakRenderer(event) {
  return isTrustedWindowRenderer(event, breakPromptWindow, breakPromptRendererUrl);
}

function trustedRendererHandler(handler) {
  return async (event, payload) => {
    if (!isTrustedRenderer(event)) throw new Error('拒绝非主页面访问桌面服务。');
    return handler(event, payload);
  };
}

function registerSpeakerIpc() {
  const trustedHandler = (handler) => async (event, payload) => {
    if (!isTrustedRenderer(event)) throw new Error('拒绝非本应用页面访问声纹服务。');
    try {
      return await handler(payload);
    } catch (error) {
      console.error('[speaker]', error);
      throw new Error(error?.publicMessage || error?.message || '声纹操作失败。');
    }
  };

  ipcMain.handle('speaker:get-state', trustedHandler(() => speakerService.getState()));
  ipcMain.handle('speaker:begin-enrollment', trustedHandler((payload) => speakerService.beginEnrollment(payload)));
  ipcMain.handle('speaker:add-enrollment-sample', trustedHandler((payload) => speakerService.addEnrollmentSample(payload)));
  ipcMain.handle('speaker:finish-enrollment', trustedHandler(() => speakerService.finishEnrollment()));
  ipcMain.handle('speaker:cancel-enrollment', trustedHandler(() => speakerService.cancelEnrollment()));
  ipcMain.handle('speaker:verify', trustedHandler((payload) => speakerService.verify(payload)));
  ipcMain.handle('speaker:delete-profile', trustedHandler((payload) => speakerService.deleteProfile(payload?.profileId)));
}

function registerAudioEventIpc() {
  const trustedHandler = (handler) => async (event, payload) => {
    if (!isTrustedRenderer(event)) throw new Error('拒绝非本应用页面访问声音分类服务。');
    try {
      return await handler(payload);
    } catch (error) {
      console.error('[audio-event]', error);
      throw new Error(error?.publicMessage || error?.message || '声音分类失败。');
    }
  };

  ipcMain.handle('audio-event:get-state', trustedHandler(() => audioEventService.getState()));
  ipcMain.handle('audio-event:classify', trustedHandler((payload) => audioEventService.classify(payload)));
}

function registerBreakPromptIpc() {
  ipcMain.handle('break-prompt:show', trustedRendererHandler((_event, payload) => {
    breakPromptState = validateBreakPromptPayload(payload);
    createBreakPromptWindow();
    sendBreakPromptState();
    presentBreakPrompt();
    return { ...breakPromptState };
  }));
  ipcMain.handle('break-prompt:update', trustedRendererHandler((_event, payload) => {
    breakPromptState = validateBreakPromptPayload(payload);
    createBreakPromptWindow();
    sendBreakPromptState();
    return { ...breakPromptState };
  }));
  ipcMain.handle('break-prompt:hide', trustedRendererHandler(() => {
    breakPromptState = null;
    breakPromptSuppressedForAlert = false;
    if (breakPromptWindow && !breakPromptWindow.isDestroyed()) breakPromptWindow.hide();
    restoreFloatingPositionAfterPrompt();
    return { hidden: true };
  }));
  ipcMain.on('break-prompt:action', (event, action) => {
    if (!isTrustedBreakRenderer(event)) {
      console.warn('[break-prompt] rejected action from untrusted renderer');
      return;
    }
    if (action !== 'start' && action !== 'bank') {
      console.warn('[break-prompt] rejected invalid action');
      return;
    }
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('break-prompt:action', action);
  });
}

app.whenReady().then(async () => {
  runtimeSession = session.fromPartition(runtimeSessionPartition, { cache: false });
  registerLocalProtocol(runtimeSession);
  runtimeSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => (
    permission === 'media'
    && details?.mediaType === 'audio'
      && webContents?.getURL() === mainRendererUrl
    && typeof requestingOrigin === 'string'
    && requestingOrigin.startsWith('rwt://renderer')
  ));
  runtimeSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const mediaTypes = Array.isArray(details?.mediaTypes) ? details.mediaTypes : [];
    callback(
      permission === 'media'
      && webContents.getURL() === mainRendererUrl
      && mediaTypes.length > 0
      && mediaTypes.every((type) => type === 'audio'),
    );
  });

  ipcMain.handle('background-preference:get', trustedRendererHandler(() => ({
    backgroundMode: backgroundPreference,
  })));
  ipcMain.handle('background-preference:set', trustedRendererHandler((_event, payload) => {
    const { mode } = validateBackgroundModePayload(payload);
    const write = backgroundPreferenceWriteChain
      .catch(() => {})
      .then(async () => {
        const saved = await writeBackgroundPreference(windowPreferencePath, mode);
        backgroundPreference = saved.backgroundMode;
        return { backgroundMode: backgroundPreference };
      });
    backgroundPreferenceWriteChain = write.catch(() => {});
    return write;
  }));
  ipcMain.handle('hide-to-background', trustedRendererHandler((_event, payload) => {
    const { mode } = validateBackgroundModePayload(payload);
    return hideToBackground(mode);
  }));
  ipcMain.handle('window:minimize', trustedRendererHandler(() => minimizeMainWindow()));
  ipcMain.handle('window:toggle-maximize', trustedRendererHandler(() => toggleMainWindowMaximized()));
  ipcMain.handle('restore-scene-mode', trustedRendererHandler(() => showSceneWindow()));
  ipcMain.handle('force-restore-scene-mode', trustedRendererHandler(() => showSceneWindow({ force: true })));
  ipcMain.handle('reveal-for-inline-alert', trustedRendererHandler(() => revealForInlineAlert()));
  ipcMain.handle('finish-inline-alert', trustedRendererHandler((_event, payload) => finishInlineAlert(payload)));
  ipcMain.handle('get-animation-canvas', trustedRendererHandler(() => ({ ...presentationCanvas, windowMode: mainWindowMode })));
  ipcMain.handle('get-runtime-window-state', trustedRendererHandler(() => runtimeWindowState()));
  ipcMain.handle('get-runtime-cache-state', trustedRendererHandler(() => runtimeCacheState()));
  ipcMain.handle('quit-app', trustedRendererHandler(() => quitApp()));
  ipcMain.on('window-mode-ready', (event, payload) => {
    if (!isTrustedRenderer(event)) {
      console.warn('[window] rejected mode acknowledgement from untrusted renderer');
      return;
    }
    try {
      completeWindowModeTransition(payload);
    } catch (error) {
      console.warn('[window] rejected invalid mode acknowledgement:', error?.message || error);
    }
  });
  registerBreakPromptIpc();

  speakerService = new SpeakerService({
    workerPath: unpackedResourcePath('speaker-worker.js'),
    modelPath: unpackedResourcePath('models', speakerModelFile),
    dataRoot: persistentDataRoot,
    profileCrypto: createProfileCrypto(),
  });
  registerSpeakerIpc();
  audioEventService = new AudioEventService({
    workerPath: unpackedResourcePath('audio-event-worker.js'),
    modelPath: unpackedResourcePath('models', audioEventModelDirectory, 'model.int8.onnx'),
    labelsPath: unpackedResourcePath('models', audioEventModelDirectory, 'class_labels_indices.csv'),
  });
  registerAudioEventIpc();
  const [speakerState, audioEventState] = await Promise.all([
    speakerService.initialize(),
    audioEventService.initialize(),
  ]);
  if (!speakerState.ready) console.error('[speaker] initialization failed:', speakerState.error);
  if (!audioEventState.ready) console.error('[audio-event] initialization failed:', audioEventState.error);

  createMainWindow();
  createTray();
});

app.on('before-quit', () => {
  isQuitting = true;
  destroyBreakPromptWindow();
  speakerService?.dispose().catch(() => {});
  audioEventService?.dispose().catch(() => {});
});
app.on('will-quit', clearTransientSessionData);
app.on('will-quit', scheduleTransientSessionDataCleanup);
app.on('window-all-closed', () => {});
app.on('activate', showSceneWindow);
