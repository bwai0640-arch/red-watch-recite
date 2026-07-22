const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const mainSource = read('main.js');
const preloadSource = read('preload.js');
const appSource = read('renderer/app.js');
const htmlSource = read('renderer/index.html');
const cssSource = read('renderer/styles.css');
const packageSource = read('package.json');

function section(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0 && endIndex > startIndex, `missing source section: ${start}`);
  return source.slice(startIndex, endIndex);
}

function assertOrdered(source, markers, message) {
  let previous = -1;
  for (const marker of markers) {
    const next = source.indexOf(marker);
    assert.ok(next > previous, `${message}: ${marker}`);
    previous = next;
  }
}

const browserWindowCreations = mainSource.match(/new BrowserWindow\s*\(/g) || [];
assert.equal(
  browserWindowCreations.length,
  2,
  'only the main window and the existing break prompt may create BrowserWindows',
);

const floatingFunction = section(
  mainSource,
  'async function showFloatingWindowNow()',
  'function showFloatingWindow()',
);
assert.match(floatingFunction, /mainWindowMode = 'floating'/);
assert.match(floatingFunction, /setAlwaysOnTop\(true, 'floating'\)/);
assert.match(floatingFunction, /setMainWindowSkipTaskbar\(true\)/);
assert.match(floatingFunction, /setResizable\(false\)/);
assert.doesNotMatch(floatingFunction, /new BrowserWindow/);
const floatingTransition = floatingFunction.slice(floatingFunction.indexOf('mainWindow.hide()'));
assertOrdered(
  floatingTransition,
  [
    'mainWindow.hide()',
    "mainWindowMode = 'floating'",
    'setMainWindowSkipTaskbar(true)',
    "await requestWindowModeRender('floating')",
    'mainWindow.showInactive()',
  ],
  'floating transition must remain hidden until its compact layout is painted',
);
assert.match(floatingTransition, /const rendered = await requestWindowModeRender\('floating'\)/);
assert.match(floatingTransition, /if \(!rendered\) return failClosedWindowTransition\('floating'\)/);

const sceneFunction = section(
  mainSource,
  'async function showSceneWindowNow',
  'function showSceneWindow(',
);
const sceneTransition = sceneFunction.slice(sceneFunction.indexOf('const targetDisplay = currentDisplay()'));
assert.match(sceneFunction, /mainWindowMode === 'alert' && inlineAlertState/);
assertOrdered(
  sceneTransition,
  [
    'mainWindow.hide()',
    "mainWindowMode = 'scene'",
    "await requestWindowModeRender('scene')",
    'mainWindow.show()',
  ],
  'scene restore must preserve alerts and paint before showing',
);
assert.match(sceneTransition, /const rendered = await requestWindowModeRender\('scene'\)/);
assert.match(sceneTransition, /if \(!rendered\) return failClosedWindowTransition\('scene'\)/);

const alertFunction = section(
  mainSource,
  'async function revealForInlineAlertNow()',
  'function revealForInlineAlert()',
);
assertOrdered(
  alertFunction,
  [
    'mainWindow.hide()',
    "mainWindowMode = 'alert'",
    "await requestWindowModeRender('alert')",
    'mainWindow.show()',
  ],
  'alert reveal must paint before showing',
);
assert.match(alertFunction, /if \(!rendered\)[\s\S]*failClosedWindowTransition\('alert'\)/);
assert.match(alertFunction, /throw Object\.assign\(new Error/);

assert.match(mainSource, /resolveAlertReturnMode/);
assert.match(mainSource, /inlineAlertState = \{ alertId: \+\+inlineAlertSequence, returnMode \}/);
assert.match(mainSource, /returnMode === 'floating'/);
assert.match(mainSource, /mainWindowMode === 'alert' && inlineAlertState/);
assert.match(mainSource, /positionFloatingWindow\(\{ avoidBreakPrompt: true/);
assert.match(
  mainSource,
  /prompt\.webContents\.on\('did-finish-load',[\s\S]*?presentBreakPrompt\(\)/,
  'a newly loaded break prompt must use the same positioning path as an existing prompt',
);
assert.match(mainSource, /window-preferences\.json/);
assert.match(mainSource, /windowTransitionChain/);
assert.match(mainSource, /backgroundPreferenceWriteChain/);
assert.match(mainSource, /failClosedWindowTransition/);
assert.match(mainSource, /suppressBreakPromptForAlert/);
assert.match(mainSource, /restoreBreakPromptAfterAlert/);
assert.match(mainSource, /mainWindowMode !== 'scene' \|\| inlineAlertState/);
assert.match(mainSource, /function minimizeMainWindow\(\)[\s\S]*enqueueWindowTransition/);
assert.match(mainSource, /function toggleMainWindowMaximized\(\)[\s\S]*enqueueWindowTransition/);
assert.match(mainSource, /ipcMain\.on\('window-mode-ready'/);
assert.match(mainSource, /ipcMain\.handle\('force-restore-scene-mode'/);
assert.match(mainSource, /contents\.send\('window-close-requested'\)/);
assert.match(mainSource, /mainWindow\.on\('will-move'/);
assert.doesNotMatch(mainSource, /suppressFloatingBoundsCapture|setImmediate\(.*Floating/);

assert.match(preloadSource, /hideToBackground: \(mode\).*\{ mode \}/);
assert.match(preloadSource, /setBackgroundPreference: \(mode\).*\{ mode \}/);
assert.match(preloadSource, /acknowledgeWindowMode: \(payload\).*window-mode-ready/);
assert.match(preloadSource, /forceRestoreSceneMode/);
assert.match(preloadSource, /onWindowCloseRequested/);
assert.doesNotMatch(preloadSource, /ipcRenderer\.send\([^)]*floating/);

const floatingMarkup = htmlSource.match(/<section id="floating-statusbar"[\s\S]*?<\/section>/)?.[0] || '';
assert.match(floatingMarkup, /id="floating-voice-state"/);
assert.match(floatingMarkup, /id="floating-timer"/);
assert.match(floatingMarkup, /id="floating-hide-button"/);
assert.match(floatingMarkup, /id="floating-expand-button"/);
assert.doesNotMatch(floatingMarkup, /meter|volume|threshold/i);

assert.match(cssSource, /body\[data-window-mode="floating"\] \.shell/);
assert.match(cssSource, /body\[data-window-mode="floating"\]:hover \.floating-hover-tools/);
assert.match(cssSource, /body\[data-window-mode="floating"\] \.study-scene canvas/);
assert.match(cssSource, /aspect-ratio: 16 \/ 9/);
assert.match(cssSource, /\.floating-timer[^}]*white-space: nowrap/);

assert.match(appSource, /UI\.floatingVoiceState\.textContent = text/);
assert.match(appSource, /UI\.floatingTimer\.textContent = `已学习 \$\{elapsed\}`/);
assert.match(appSource, /hideWindowFromChrome\('hidden'\)/);
assert.match(appSource, /restoreSceneMode\(\)/);
assert.match(appSource, /requestAnimationFrame\(\(\) => \{[\s\S]*requestAnimationFrame/);
assert.match(appSource, /acknowledgeWindowMode\(\{ transitionId, mode \}\)/);
assert.match(appSource, /forceRestoreSceneMode\(\)/);
assert.match(appSource, /onWindowCloseRequested/);
assert.match(appSource, /backgroundPreferenceMutation/);
assert.doesNotMatch(appSource, /returnToHidden/);

assert.match(packageSource, /"window-mode-policy\.js"/);
console.log('floating-window-source-test: ok');
