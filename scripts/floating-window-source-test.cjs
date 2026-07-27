const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const mainSource = read('main.js');
const preloadSource = read('preload.js');
const appSource = read('renderer/app.js');
const htmlSource = read('renderer/index.html');
const breakPromptHtmlSource = read('renderer/break-prompt.html');
const cssSource = read('renderer/styles.css');
const modeRestUiSource = read('scripts/mode-rest-ui-test.mjs');
const packageSource = read('package.json');
const packageConfig = JSON.parse(packageSource);

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

assertOrdered(
  mainSource,
  [
    "app.setName('凛冬督学局')",
    'const persistentDataRoot = process.env.SUPERVISION_DATA_DIR',
    "path.join(app.getPath('appData'), '背书自习监督')",
    "app.setPath('userData', persistentDataRoot)",
    "app.setPath('sessionData', transientSessionDataRoot)",
  ],
  'visible rename must preserve the legacy userData directory before creating the runtime session',
);
assert.match(mainSource, /title: '凛冬督学局'/);
assert.match(mainSource, /title: '凛冬督学局 · 休息券'/);
assert.match(mainSource, /tray\.setToolTip\('凛冬督学局'\)/);
assert.match(htmlSource, /<title>凛冬督学局<\/title>/);
assert.match(htmlSource, /<div class="window-title">凛冬督学局<\/div>/);
assert.match(htmlSource, /<h1>凛冬督学局 <span id="mode-title">/);
assert.match(breakPromptHtmlSource, /<title>凛冬督学局 · 休息券<\/title>/);
assert.match(breakPromptHtmlSource, /<span class="eyebrow">凛冬督学局<\/span>/);
assert.equal(packageConfig.build.appId, 'top.redwatch.study-supervisor');
assert.equal(packageConfig.build.productName, '凛冬督学局');
assert.equal(packageConfig.build.win.artifactName, '凛冬督学局-安装版-${version}.exe');
assert.equal(packageConfig.build.nsis.shortcutName, '凛冬督学局');

const floatingFunction = section(
  mainSource,
  'async function showFloatingWindowNow()',
  'function showFloatingWindow()',
);
assert.match(floatingFunction, /mainWindowMode = 'floating'/);
assert.match(floatingFunction, /setAlwaysOnTop\(true, 'floating'\)/);
assert.match(floatingFunction, /setMainWindowSkipTaskbar\(true\)/);
assert.match(floatingFunction, /applyFloatingSizeConstraints\(\)/);
assert.match(floatingFunction, /setResizable\(true\)/);
assert.match(floatingFunction, /startFloatingHoverTracking\(\)/);
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
assert.match(sceneFunction, /stopFloatingHoverTracking\(\)/);
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
assert.ok(
  sceneTransition.indexOf('applySceneSizeConstraints()') >= 0
    && sceneTransition.indexOf('applySceneSizeConstraints()') < sceneTransition.indexOf('mainWindow.setBounds('),
  'scene restore must remove the floating maximum before applying full-size bounds',
);

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
assert.match(alertFunction, /stopFloatingHoverTracking\(\)/);
assert.ok(
  alertFunction.indexOf('applySceneSizeConstraints()') >= 0
    && alertFunction.indexOf('applySceneSizeConstraints()') < alertFunction.indexOf('mainWindow.setBounds('),
  'alert reveal must remove the floating maximum before applying full-size bounds',
);

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
assert.match(mainSource, /mainWindow\.on\('moved',[\s\S]*?floatingRestoreBounds = \{ \.\.\.mainWindow\.getBounds\(\) \}/);
assert.match(mainSource, /mainWindow\.on\('will-move', \(\) => \{\s*if \(mainWindowMode === 'floating'\)/);
assert.doesNotMatch(mainSource, /mainWindow\.on\('will-move', \(event/);
assert.doesNotMatch(mainSource, /mainWindow\.on\('will-resize'/);
assert.match(mainSource, /mainWindow\.on\('resize'/);
assert.match(mainSource, /mainWindow\.on\('resized'/);
const floatingResizeHandler = section(
  mainSource,
  "mainWindow.on('resize'",
  "mainWindow.on('resized'",
);
assert.match(floatingResizeHandler, /mainWindow\.getBounds\(\)/);
assert.doesNotMatch(floatingResizeHandler, /clampFloatingBounds|setBounds|setPosition|preventDefault/);
assert.match(mainSource, /function applyFloatingSizeConstraints\(\)[\s\S]*?setMinimumSize\(floatingWindowMinimumSize\.width, floatingWindowMinimumSize\.height\)[\s\S]*?setMaximumSize\(floatingWindowSize\.width, floatingWindowSize\.height\)/);
assert.match(mainSource, /function applySceneSizeConstraints\(\)[\s\S]*?unrestrictedWindowMaximumSize[\s\S]*?setMaximumSize\(maximumWidth, maximumHeight\)/);
assert.match(mainSource, /persistFloatingWindowSize/);
assert.match(mainSource, /readFloatingWindowSize/);
assert.match(mainSource, /writeFloatingWindowSize/);
assert.match(mainSource, /floatingWindowMinimumSize = Object\.freeze\(\{ width: 224, height: 170 \}\)/);
assert.match(mainSource, /const floatingHoverPollIntervalMs = 80/);
assert.match(mainSource, /screen\.getCursorScreenPoint\(\)/);
assert.match(mainSource, /pointInsideBounds\(screen\.getCursorScreenPoint\(\), window\.getBounds\(\)\)/);
assert.match(mainSource, /contents\.send\('floating-hover-changed', \{ hovered: next \}\)/);
assert.match(mainSource, /function stopFloatingHoverTracking\(\)[\s\S]*?clearInterval\(floatingHoverTimer\)/);
assert.match(mainSource, /app\.on\('before-quit',[\s\S]*?stopFloatingHoverTracking\(\)/);
assert.doesNotMatch(mainSource, /suppressFloatingBoundsCapture|setImmediate\(.*Floating/);

assert.match(preloadSource, /hideToBackground: \(mode\).*\{ mode \}/);
assert.match(preloadSource, /setBackgroundPreference: \(mode\).*\{ mode \}/);
assert.match(preloadSource, /acknowledgeWindowMode: \(payload\).*window-mode-ready/);
assert.match(preloadSource, /forceRestoreSceneMode/);
assert.match(preloadSource, /onWindowCloseRequested/);
assert.match(preloadSource, /onFloatingHoverChanged:[\s\S]*?subscribe\('floating-hover-changed'/);
assert.doesNotMatch(preloadSource, /ipcRenderer\.send\([^)]*floating/);
assert.match(mainSource, /const hasSingleInstanceLock = app\.requestSingleInstanceLock\(\)/);
assert.match(mainSource, /app\.on\('second-instance',[\s\S]*?showSceneWindow\(\)\.catch/);
assert.match(mainSource, /if \(hasSingleInstanceLock\) app\.whenReady\(\)\.then/);

const floatingStatusMarkup = htmlSource.match(/<section id="floating-statusbar"[\s\S]*?<\/section>/)?.[0] || '';
const floatingToolsMarkup = htmlSource.match(/<div class="floating-hover-tools"[\s\S]*?<\/div>/)?.[0] || '';
assert.match(floatingStatusMarkup, /id="floating-voice-state"/);
assert.doesNotMatch(floatingStatusMarkup, /id="floating-anomaly-time"/);
assert.match(floatingToolsMarkup, /id="floating-timer"/);
assert.match(floatingToolsMarkup, /id="floating-hide-button"[^>]*>隐藏<\/button>/);
assert.match(floatingToolsMarkup, /id="floating-expand-button"[^>]*>放大<\/button>/);
assert.doesNotMatch(`${floatingStatusMarkup}${floatingToolsMarkup}`, /meter|volume|threshold/i);
assert.match(
  htmlSource,
  /<section id="floating-statusbar"[\s\S]*?<\/section>\s*<div class="floating-hover-tools"[\s\S]*?<\/div>\s*<section id="study-scene"/,
);
assert.doesNotMatch(htmlSource, /floating-threshold|voice-threshold|volume-threshold/);
assert.doesNotMatch(appSource, /floatingVoiceThreshold|voiceThreshold|thresholdMarker/);
assert.doesNotMatch(cssSource, /\.floating-threshold-control|\.threshold-marker/);

assert.match(htmlSource, /id="background-action" class="background-action"/);
assert.match(htmlSource, /id="background-button"[\s\S]*?aria-controls="background-action-menu"[\s\S]*?aria-expanded="false"/);
assert.match(htmlSource, /id="background-action-menu"[\s\S]*?role="group"[\s\S]*?aria-hidden="true"/);
assert.match(htmlSource, /id="background-choice-hidden"[\s\S]*?>完全隐藏<\/button>/);
assert.match(htmlSource, /id="background-choice-floating"[\s\S]*?>使用漂浮窗<\/button>/);

assert.match(cssSource, /body\[data-window-mode="floating"\] \.shell/);
assert.match(cssSource, /body\[data-window-mode="floating"\]\.floating-hovered \.floating-hover-tools/);
assert.doesNotMatch(cssSource, /body\[data-window-mode="floating"\]:hover \.floating-hover-tools/);
assert.match(cssSource, /floating-hovered \.study-scene,[\s\S]*?top: 78px/);
assert.match(cssSource, /body\[data-window-mode="floating"\] \.study-scene canvas/);
assert.match(cssSource, /aspect-ratio: 16 \/ 9/);
assert.match(cssSource, /\.floating-timer[^}]*white-space: nowrap/);
assert.match(cssSource, /\.floating-timer[^}]*min-width: 96px[^}]*text-overflow: ellipsis/);
assert.match(cssSource, /\.floating-hover-tools\s*\{[^}]*gap: 4px[^}]*padding: 0 6px/);
assert.match(cssSource, /\.floating-action\s*\{[^}]*min-width: 40px/);
assert.ok(
  96 + (40 * 2) + (4 * 2) + (6 * 2) <= 224,
  'the hover timer and both actions must fit the minimum floating width',
);
assert.match(cssSource, /body\[data-window-mode="floating"\] \.floating-hover-tools\s*\{[^}]*position: fixed[^}]*z-index: 13[^}]*-webkit-app-region: no-drag/);
assert.match(cssSource, /\.floating-timer\s*\{[^}]*-webkit-app-region: drag/);
assert.match(cssSource, /\.floating-action\s*\{[^}]*-webkit-app-region: no-drag/);
assert.match(cssSource, /body\[data-window-mode="floating"\] \.study-scene\s*\{[^}]*-webkit-app-region: drag/);
assert.match(cssSource, /body\[data-window-mode="floating"\] \.study-scene canvas\s*\{[^}]*-webkit-app-region: drag/);
assert.match(modeRestUiSource, /function clickProcessWindowAtFraction\(/);
assert.match(modeRestUiSource, /clickProcessWindowAtFraction\(appProcess\.pid, report\.floatingHover\.hitPoints\.hide\)/);
assert.match(modeRestUiSource, /clickProcessWindowAtFraction\(appProcess\.pid, report\.floatingExpandPoint\)/);
assert.doesNotMatch(modeRestUiSource, /querySelector\('#floating-(?:hide|expand)-button'\)\.click\(\)/);
assert.match(
  appSource,
  /runtime\?\.mode === 'floating' && runtime\?\.floatingHovered === true/,
);
assert.match(cssSource, /\.background-action-menu\s*\{[^}]*top: calc\(100% - 1px\)[^}]*bottom: auto[^}]*grid-template-columns: minmax\(0, 1fr\)/);
assert.match(cssSource, /\.actions\s*\{[^}]*align-items: start/);
assert.match(cssSource, /body\.scene-mode:not\(\.controls-open\) \.background-action\.menu-open \.background-action-menu\s*\{[^}]*position: static[^}]*margin-top: 4px[^}]*transform: none/);
assert.doesNotMatch(cssSource, /body\.scene-mode:not\(\.controls-open\) \.background-action-menu\s*\{[^}]*bottom: calc\(100% - 1px\)/);
assert.doesNotMatch(cssSource, /\.background-action:hover \.background-action-menu/);
assert.doesNotMatch(cssSource, /\.background-action:focus-within \.background-action-menu/);
assert.match(cssSource, /\.background-action\.menu-open \.background-action-menu/);
assert.match(cssSource, /#background-button:disabled \+ \.background-action-menu\s*\{ display: none; \}/);

assert.match(appSource, /UI\.floatingVoiceState\.textContent = text/);
assert.match(appSource, /function rejectedSpeakerStatus\(now = monotonicNow\(\)\)[\s\S]*?暂未确认本人声音 \$\{seconds\} 秒/);
assert.match(appSource, /state\.lastSpeakerRejected \? rejectedSpeakerStatus\(now\) : '正在复核本人声音'/);
assert.match(
  appSource,
  /const silenceViolated = silentForMs >= violationLimitMs\(\);[\s\S]*?const message = silenceViolated\s*\? `本人未出声 \$\{silentFor\} 秒`\s*: '暂未检测到本人声音';[\s\S]*?setChip\(UI\.voiceState, message, silenceViolated \? 'alert' : ''\)/,
);
assert.doesNotMatch(appSource, /floatingAnomaly|renderFloatingAnomaly|setFloatingAnomalyDuration/);
assert.doesNotMatch(cssSource, /\.floating-anomaly-time\s*\{/);
assert.doesNotMatch(cssSource, /:(?:hover|focus-within) \.floating-voice-state[^{]*\{[^}]*opacity:\s*0/);
assert.match(appSource, /UI\.floatingTimer\.textContent = `已学习 \$\{elapsed\}`/);
assert.match(
  appSource,
  /onFloatingHoverChanged\([\s\S]*?classList\.toggle\([\s\S]*?'floating-hovered'[\s\S]*?state\.windowMode === 'floating'[\s\S]*?payload\?\.hovered === true/,
);
assert.match(
  appSource,
  /function applyWindowMode\(mode\)[\s\S]*?if \(mode !== 'floating'\) document\.body\.classList\.remove\('floating-hovered'\)/,
);
assert.match(appSource, /hideWindowFromChrome\('hidden'\)/);
assert.match(appSource, /restoreSceneMode\(\)/);
assert.match(appSource, /function bindFloatingAction\(button, action\)[\s\S]*?button\.addEventListener\('pointerdown'/);
assert.match(appSource, /requestAnimationFrame\(\(\) => \{[\s\S]*requestAnimationFrame/);
assert.match(appSource, /acknowledgeWindowMode\(\{ transitionId, mode \}\)/);
assert.match(appSource, /forceRestoreSceneMode\(\)/);
assert.match(appSource, /onWindowCloseRequested/);
assert.match(appSource, /backgroundPreferenceMutation/);
assert.match(appSource, /function chooseBackgroundModeAndHide\(mode\)[\s\S]*setBackgroundMode\(mode\)[\s\S]*hideWindowFromChrome\(mode\)/);
assert.match(appSource, /backgroundChoiceHidden\.addEventListener\('click'[\s\S]*chooseBackgroundModeAndHide\('hidden'\)/);
assert.match(appSource, /backgroundChoiceFloating\.addEventListener\('click'[\s\S]*chooseBackgroundModeAndHide\('floating'\)/);
assert.match(appSource, /backgroundAction\.addEventListener\('pointerenter'/);
assert.match(appSource, /backgroundAction\.addEventListener\('focusin'/);
assert.match(appSource, /state\.sessionPhase === 'resting' \? 'hidden'/);
assert.match(appSource, /const STUDY_RECOVERY_CONFIRM_SECONDS = 5/);
assert.match(appSource, /rearmQuietSeconds: STUDY_RECOVERY_CONFIRM_SECONDS/);
assert.match(appSource, /evidenceGapSeconds: STUDY_RECOVERY_CONFIRM_SECONDS/);
assert.match(appSource, /function showAnimationWatchState\(\)[\s\S]*好好学！盯着你呢！[\s\S]*setChip\(UI\.voiceState, label, 'watch'\)/);
assert.doesNotMatch(appSource, /检测暂停|正在恢复检测|动画预览期间暂停测试/);
assert.doesNotMatch(appSource, /floatingVoiceState\.parentElement\.addEventListener\('dblclick'/);
assert.match(cssSource, /\.chip\.watch\s*\{[^}]*color: #f0bd5d/);
assert.match(cssSource, /\.floating-voice-state\.watch\s*\{ color: #f0bd5d; \}/);
assert.match(cssSource, /\.watch-copy\s*\{ color: #f0bd5d !important; \}/);
assert.match(appSource, /liveVoiceDuration\.classList\.toggle\('watch-copy', watchPresentation\)/);
assert.match(appSource, /voiceStatus\.classList\.toggle\('watch-copy', watchPresentation\)/);
assert.match(appSource, /preflightTestStatus\.classList\.toggle\('watch-copy', text === '好好学！盯着你呢！'\)/);
assert.doesNotMatch(appSource, /returnToHidden/);

assert.match(packageSource, /"window-mode-policy\.js"/);
console.log('floating-window-source-test: ok');
