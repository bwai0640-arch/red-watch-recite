const {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  Tray,
  nativeImage,
  protocol,
  safeStorage,
  screen,
  session,
} = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { SpeakerService } = require('./speaker-service');

const presentationCanvas = { width: 1920, height: 1080 };
const mainRendererUrl = 'rwt://renderer/index.html';
const breakPromptRendererUrl = 'rwt://renderer/break-prompt.html';

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.setName('凛冬督学局');

const portableRoot = process.env.PORTABLE_EXECUTABLE_DIR
  || (app.isPackaged ? path.dirname(app.getPath('exe')) : __dirname);
const userDataRoot = path.join(portableRoot, 'RedWatchReciteData');
app.setPath('userData', userDataRoot);
app.setPath('sessionData', path.join(userDataRoot, 'SessionData'));

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
let breakPromptWindow = null;
let breakPromptState = null;
let isDestroyingBreakPrompt = false;

const speakerModelFile = '3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx';
const breakPromptSize = Object.freeze({ width: 420, height: 220 });
const breakPromptMargin = 20;

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

function registerLocalProtocol() {
  protocol.handle('rwt', async (request) => {
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
  breakPromptWindow.setBounds(breakPromptBounds(), false);
  breakPromptWindow.setAlwaysOnTop(true, 'floating');
  breakPromptWindow.showInactive();
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
    title: '凛冬督学局 · 休息券',
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    autoHideMenuBar: true,
    backgroundColor: '#160c0b',
    webPreferences: {
      preload: path.join(__dirname, 'break-prompt-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  breakPromptWindow = prompt;
  prompt.setMenuBarVisibility(false);
  lockWebContentsNavigation(prompt.webContents, breakPromptRendererUrl);
  prompt.webContents.on('did-finish-load', () => {
    if (prompt !== breakPromptWindow || prompt.isDestroyed()) return;
    if (!breakPromptState || prompt.webContents.isDestroyed()) return;
    prompt.webContents.send('break-prompt:state', { ...breakPromptState });
    prompt.setBounds(breakPromptBounds(), false);
    prompt.setAlwaysOnTop(true, 'floating');
    prompt.showInactive();
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
    minWidth: 960,
    minHeight: 540,
    resizable: true,
    minimizable: true,
    maximizable: true,
    fullscreen: false,
    frame: false,
    show: false,
    title: '凛冬督学局',
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    autoHideMenuBar: true,
    backgroundColor: '#120c0b',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
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
    hideToBackground();
  });
  mainWindow.on('maximize', sendWindowMaximized);
  mainWindow.on('unmaximize', sendWindowMaximized);
  mainWindow.on('minimize', () => sendWindowMode(mainWindowMode, { minimized: true }));
  mainWindow.on('closed', () => {
    mainWindow = null;
    destroyBreakPromptWindow();
  });
}

function showSceneWindow() {
  if (!mainWindow) createMainWindow();
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindowMode = 'scene';
  mainWindow.setAlwaysOnTop(false);
  mainWindow.setSkipTaskbar(false);
  mainWindow.setResizable(true);
  mainWindow.setFullScreen(false);
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  mainWindow.setBounds(fitPresentationBounds(currentDisplay()), true);
  mainWindow.show();
  mainWindow.restore();
  mainWindow.focus();
  sendWindowMode('scene');
}

function hideToBackground() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindowMode = 'hidden';
  sendWindowMode('hidden');
  mainWindow.hide();
}

function revealForInlineAlert() {
  if (!mainWindow) createMainWindow();
  if (!mainWindow || mainWindow.isDestroyed()) return { returnToHidden: false };
  const returnToHidden = mainWindowMode === 'hidden' || !mainWindow.isVisible();
  mainWindowMode = 'alert';
  mainWindow.setFullScreen(false);
  mainWindow.setResizable(true);
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  mainWindow.setBounds(fitPresentationBounds(currentDisplay()), false);
  mainWindow.setSkipTaskbar(false);
  mainWindow.setAlwaysOnTop(true, 'screen-saver');
  mainWindow.show();
  mainWindow.restore();
  mainWindow.focus();
  sendWindowMode('alert');
  return { returnToHidden };
}

function validateFinishInlineAlertPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('提醒结束参数无效。');
  }
  const keys = Reflect.ownKeys(payload);
  if (keys.length !== 1 || keys[0] !== 'returnToHidden'
    || typeof payload.returnToHidden !== 'boolean') {
    throw new Error('提醒结束参数字段无效。');
  }
  return { returnToHidden: payload.returnToHidden };
}

function finishInlineAlert(payload) {
  const { returnToHidden } = validateFinishInlineAlertPayload(payload);
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (returnToHidden) {
    mainWindow.setAlwaysOnTop(false);
    hideToBackground();
    return;
  }
  showSceneWindow();
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
  };
}

function minimizeMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return runtimeWindowState();
  mainWindow.minimize();
  return runtimeWindowState();
}

function toggleMainWindowMaximized() {
  if (!mainWindow || mainWindow.isDestroyed()) return runtimeWindowState();
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
  return runtimeWindowState();
}

function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'icon.ico');
  const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip('凛冬督学局');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开督学场景', click: showSceneWindow },
    { label: '隐藏到后台', click: hideToBackground },
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
  ipcMain.handle('speaker:begin-enrollment', trustedHandler(() => speakerService.beginEnrollment()));
  ipcMain.handle('speaker:add-enrollment-sample', trustedHandler((payload) => speakerService.addEnrollmentSample(payload)));
  ipcMain.handle('speaker:finish-enrollment', trustedHandler(() => speakerService.finishEnrollment()));
  ipcMain.handle('speaker:cancel-enrollment', trustedHandler(() => speakerService.cancelEnrollment()));
  ipcMain.handle('speaker:verify', trustedHandler((payload) => speakerService.verify(payload)));
  ipcMain.handle('speaker:delete-profile', trustedHandler(() => speakerService.deleteProfile()));
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
    if (breakPromptWindow && !breakPromptWindow.isDestroyed()) breakPromptWindow.hide();
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
  registerLocalProtocol();
  session.defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => (
    permission === 'media'
    && details?.mediaType === 'audio'
      && webContents?.getURL() === mainRendererUrl
    && typeof requestingOrigin === 'string'
    && requestingOrigin.startsWith('rwt://renderer')
  ));
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const mediaTypes = Array.isArray(details?.mediaTypes) ? details.mediaTypes : [];
    callback(
      permission === 'media'
      && webContents.getURL() === mainRendererUrl
      && mediaTypes.length > 0
      && mediaTypes.every((type) => type === 'audio'),
    );
  });

  ipcMain.handle('hide-to-background', trustedRendererHandler(() => hideToBackground()));
  ipcMain.handle('window:minimize', trustedRendererHandler(() => minimizeMainWindow()));
  ipcMain.handle('window:toggle-maximize', trustedRendererHandler(() => toggleMainWindowMaximized()));
  ipcMain.handle('restore-scene-mode', trustedRendererHandler(() => showSceneWindow()));
  ipcMain.handle('reveal-for-inline-alert', trustedRendererHandler(() => revealForInlineAlert()));
  ipcMain.handle('finish-inline-alert', trustedRendererHandler((_event, payload) => finishInlineAlert(payload)));
  ipcMain.handle('get-animation-canvas', trustedRendererHandler(() => ({ ...presentationCanvas, windowMode: mainWindowMode })));
  ipcMain.handle('get-runtime-window-state', trustedRendererHandler(() => runtimeWindowState()));
  ipcMain.handle('quit-app', trustedRendererHandler(() => quitApp()));
  registerBreakPromptIpc();

  speakerService = new SpeakerService({
    workerPath: unpackedResourcePath('speaker-worker.js'),
    modelPath: unpackedResourcePath('models', speakerModelFile),
    dataRoot: userDataRoot,
    safeStorage,
  });
  registerSpeakerIpc();
  const speakerState = await speakerService.initialize();
  if (!speakerState.ready) console.error('[speaker] initialization failed:', speakerState.error);

  createMainWindow();
  createTray();
});

app.on('before-quit', () => {
  isQuitting = true;
  destroyBreakPromptWindow();
  speakerService?.dispose().catch(() => {});
});
app.on('window-all-closed', () => {});
app.on('activate', showSceneWindow);
