import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const electronExecutable = path.join(projectRoot, 'node_modules', 'electron', 'dist', 'electron.exe');
const workRoot = path.join(projectRoot, 'work');

if (!fs.existsSync(electronExecutable)) {
  throw new Error(`Source Electron runtime not found: ${electronExecutable}`);
}
if (!fs.existsSync(workRoot)) {
  throw new Error(`Workspace test root not found: ${workRoot}`);
}

const fixtureNames = [
  'fangjun-sr-1.wav',
  'fangjun-sr-2.wav',
  'fangjun-sr-3.wav',
];
const fixtureRoot = path.join(workRoot, 'speaker-fixtures');
const speakerFixtures = Object.fromEntries(fixtureNames.map((name) => [
  name,
  fs.readFileSync(path.join(fixtureRoot, name)).toString('base64'),
]));

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertArray(actual, expected, message) {
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${message}: ${JSON.stringify(actual)}`);
}

async function reserveDebugPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  if (!port) throw new Error('Unable to reserve a local DevTools port');
  return port;
}

async function targetList(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json`);
  if (!response.ok) throw new Error(`DevTools target request failed: HTTP ${response.status}`);
  return response.json();
}

async function waitForTarget(port, predicate, appProcess, timeout = 60_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (appProcess.exitCode !== null) {
      throw new Error(`Source test instance exited early with code ${appProcess.exitCode}`);
    }
    try {
      const target = (await targetList(port)).find(predicate);
      if (target) return target;
    } catch {}
    await wait(100);
  }
  throw new Error('Timed out waiting for DevTools target');
}

function connect(endpoint) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(endpoint);
    const pending = new Map();
    let nextId = 1;
    let opened = false;

    const rejectPending = (error) => {
      for (const request of pending.values()) request.reject(error);
      pending.clear();
    };

    socket.addEventListener('open', () => {
      opened = true;
      const send = (method, params = {}) => new Promise((resolveRequest, rejectRequest) => {
        const id = nextId++;
        pending.set(id, { resolve: resolveRequest, reject: rejectRequest });
        socket.send(JSON.stringify({ id, method, params }));
      });
      resolve({
        async evaluate(expression) {
          const response = await send('Runtime.evaluate', {
            expression,
            awaitPromise: true,
            returnByValue: true,
          });
          if (response.exceptionDetails) {
            throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
          }
          return response.result?.value;
        },
        send,
        close() {
          socket.close();
        },
      });
    }, { once: true });
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error.message || 'DevTools command failed'));
      else request.resolve(message.result || {});
    });
    socket.addEventListener('error', () => {
      const error = new Error('DevTools WebSocket failed');
      if (!opened) reject(error);
      rejectPending(error);
    });
    socket.addEventListener('close', () => rejectPending(new Error('DevTools WebSocket closed')));
  });
}

async function waitForEvaluation(client, expression, predicate, timeout = 90_000, interval = 50) {
  const deadline = Date.now() + timeout;
  let lastValue;
  while (Date.now() < deadline) {
    lastValue = await client.evaluate(expression);
    if (predicate(lastValue)) return lastValue;
    await wait(interval);
  }
  throw new Error(`Timed out waiting for expression: ${expression}\nLast value: ${JSON.stringify(lastValue)}`);
}

function ids(trace) {
  return trace.map((item) => item.clipId);
}

const layoutExpression = `(() => {
  const visible = (element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none'
      && style.visibility !== 'hidden'
      && Number(style.opacity) !== 0
      && rect.width > 0
      && rect.height > 0;
  };
  const intersects = (first, second) => first.left < second.right && first.right > second.left
    && first.top < second.bottom && first.bottom > second.top;
  const inViewport = (rect) => rect.left >= 0
    && rect.top >= 0
    && rect.right <= innerWidth
    && rect.bottom <= innerHeight;
  const buttons = [...document.querySelectorAll('button')]
    .filter(visible)
    .map((button) => {
      const rect = button.getBoundingClientRect();
      return {
        id: button.id,
        text: button.textContent.trim(),
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
      };
    });
  const overlaps = [];
  buttons.forEach((first, index) => {
    buttons.slice(index + 1).forEach((second) => {
      if (first.left < second.right && first.right > second.left
        && first.top < second.bottom && first.bottom > second.top) {
        overlaps.push([first.id || first.text, second.id || second.text]);
      }
    });
  });
  const strip = document.querySelector('.live-voice-strip');
  const panel = document.querySelector('.control-panel');
  const masthead = document.querySelector('.masthead');
  const heading = document.querySelector('.masthead h1');
  const creatorCredit = document.querySelector('.creator-credit');
  const modeSwitch = document.querySelector('.mode-switch');
  const preflightRow = document.querySelector('.preflight-test-row');
  const preflightButton = document.querySelector('#preflight-test-button');
  const preflightStatus = document.querySelector('#preflight-test-status');
  const shell = document.querySelector('.shell');
  const stripRect = strip.getBoundingClientRect();
  const panelRect = panel.getBoundingClientRect();
  const mastheadRect = masthead.getBoundingClientRect();
  const headingRect = heading.getBoundingClientRect();
  const creatorCreditRect = creatorCredit.getBoundingClientRect();
  const modeSwitchRect = modeSwitch.getBoundingClientRect();
  const preflightRowRect = preflightRow.getBoundingClientRect();
  const preflightButtonRect = preflightButton.getBoundingClientRect();
  const preflightStatusRect = preflightStatus.getBoundingClientRect();
  const canvasRect = document.querySelector('#study-scene-canvas').getBoundingClientRect();
  const titlebarRect = document.querySelector('#window-titlebar').getBoundingClientRect();
  const windowControls = [...document.querySelectorAll('.window-control')].map((button) => {
    const rect = button.getBoundingClientRect();
    return rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight;
  });
  return {
    viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
    controlsOpen: document.body.classList.contains('controls-open'),
    buttons: buttons.map(({ id, text }) => ({ id, text })),
    overlaps,
    stripVisible: visible(strip)
      && stripRect.right > 0 && stripRect.bottom > 0
      && stripRect.left < innerWidth && stripRect.top < innerHeight,
    stripInControlPanel: panel.contains(strip),
    stripRect: {
      left: stripRect.left,
      right: stripRect.right,
      top: stripRect.top,
      bottom: stripRect.bottom,
    },
    mastheadPanelOverlap: mastheadRect.left < panelRect.right
      && mastheadRect.right > panelRect.left
      && mastheadRect.top < panelRect.bottom
      && mastheadRect.bottom > panelRect.top,
    creatorCredit: {
      text: creatorCredit.textContent.trim(),
      visible: visible(creatorCredit),
      inViewport: inViewport(creatorCreditRect),
      belowHeading: creatorCreditRect.top >= headingRect.bottom - 0.5,
      overlapsHeading: intersects(creatorCreditRect, headingRect),
      overlapsModeSwitch: intersects(creatorCreditRect, modeSwitchRect),
    },
    preflightRow: {
      visible: visible(preflightRow),
      inViewport: inViewport(preflightRowRect),
      horizontallyContained: preflightRowRect.left >= 0 && preflightRowRect.right <= innerWidth,
      buttonStatusOverlap: visible(preflightButton)
        && visible(preflightStatus)
        && intersects(preflightButtonRect, preflightStatusRect),
      shellScrollable: shell.scrollHeight > shell.clientHeight + 1,
      shellScrollTop: shell.scrollTop,
    },
    canvasAspectRatio: canvasRect.width / canvasRect.height,
    titlebarVisible: titlebarRect.top === 0
      && titlebarRect.left === 0
      && titlebarRect.right <= innerWidth
      && titlebarRect.bottom <= innerHeight,
    windowControlsInViewport: windowControls.every(Boolean),
  };
})()`;

function assertLayout(snapshot, label) {
  assert(snapshot.overlaps.length === 0, `${label}: visible buttons overlap: ${JSON.stringify(snapshot.overlaps)}`);
  assert(snapshot.stripVisible, `${label}: live voice strip is not visible`);
  assert(snapshot.stripInControlPanel, `${label}: live voice strip left the main control region`);
  assert(!snapshot.mastheadPanelOverlap, `${label}: fixed control panel overlaps the mode header`);
  assert(Math.abs(snapshot.canvasAspectRatio - (16 / 9)) < 0.001,
    `${label}: scene canvas is not 16:9: ${snapshot.canvasAspectRatio}`);
  assert(snapshot.titlebarVisible && snapshot.windowControlsInViewport,
    `${label}: window titlebar or controls left the viewport`);
  assert(snapshot.creatorCredit.text === '原作：叛逆蓝牙 · 二创：眼泪斷了线'
    && snapshot.creatorCredit.visible
    && snapshot.creatorCredit.belowHeading
    && !snapshot.creatorCredit.overlapsHeading
    && !snapshot.creatorCredit.overlapsModeSwitch,
  `${label}: creator attribution is missing, misplaced, or overlapping: ${JSON.stringify(snapshot.creatorCredit)}`);
}

function assertPreflightLayout(snapshot, label) {
  assert(snapshot.preflightRow.visible, `${label}: preflight test row is not visible`);
  assert(snapshot.preflightRow.inViewport && snapshot.preflightRow.horizontallyContained,
    `${label}: preflight test row is outside the viewport: ${JSON.stringify(snapshot.preflightRow)}`);
  assert(!snapshot.preflightRow.buttonStatusOverlap,
    `${label}: preflight button overlaps its status: ${JSON.stringify(snapshot.preflightRow)}`);
}

function rangeBoundaryExpression(selector, candidates, snapshotField) {
  return `(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    const results = [];
    for (const candidate of ${JSON.stringify(candidates)}) {
      input.value = String(candidate);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      results.push({
        candidate,
        inputValue: Number(input.value),
        storedValue: window.__beishuTest.getSnapshot()[${JSON.stringify(snapshotField)}],
      });
    }
    return {
      minimum: Number(input.min),
      maximum: Number(input.max),
      step: Number(input.step),
      results,
    };
  })()`;
}

const forcedVadResult = `({
  calibrated: true,
  calibrationProgress: 1,
  isSpeech: false,
  levelDb: -70,
  levelPercent: 37,
  noiseFloorDb: -50,
  thresholdDb: -42,
  steadyNoise: true,
  speechScore: 0,
  voiceRatio: 0.5,
  flatness: 0.4,
  flux: 0.005
})`;

async function completeCalibration(client) {
  await waitForEvaluation(
    client,
    `({ active: state.active, introComplete: state.introComplete, calibrating: state.calibrating, vad: Boolean(state.vad) })`,
    (value) => value.active && value.introComplete && value.calibrating && value.vad,
  );
  await client.evaluate(`(() => {
    state.vad.process = () => ${forcedVadResult};
    pollMicrophone();
    return true;
  })()`);
  return waitForEvaluation(
    client,
    `({ snapshot: window.__beishuTest.getSnapshot(), vadState: document.body.dataset.vadState })`,
    (value) => value.snapshot.sessionPhase === 'studying' && value.vadState === 'ready',
  );
}

async function completePreflightCalibration(client) {
  await waitForEvaluation(
    client,
    `({ snapshot: window.__beishuTest.getSnapshot(), vad: Boolean(state.vad) })`,
    (value) => value.snapshot.preflightTesting
      && !value.snapshot.active
      && value.snapshot.sessionPhase === 'idle'
      && value.snapshot.calibrating
      && value.vad,
  );
  await client.evaluate(`(() => {
    state.vad.process = () => ${forcedVadResult};
    pollMicrophone();
    return true;
  })()`);
  return waitForEvaluation(
    client,
    `({ snapshot: window.__beishuTest.getSnapshot(), vadState: document.body.dataset.vadState })`,
    (value) => value.snapshot.preflightTesting
      && !value.snapshot.active
      && value.snapshot.sessionPhase === 'idle'
      && !value.snapshot.calibrating
      && value.vadState === 'ready',
  );
}

function waitForProcessExit(child, timeout = 10_000) {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode);
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => reject(new Error('Source test instance did not exit')), timeout);
    child.once('exit', (code) => {
      clearTimeout(timeoutId);
      resolve(code);
    });
  });
}

async function removeIsolatedRoot(testRoot) {
  const relative = path.relative(workRoot, testRoot);
  const safe = relative
    && !relative.startsWith('..')
    && !path.isAbsolute(relative)
    && path.basename(testRoot).startsWith('mode-rest-ui-');
  if (!safe) throw new Error(`Refusing to remove unexpected test root: ${testRoot}`);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      fs.rmSync(testRoot, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt === 7) throw error;
      await wait(250);
    }
  }
}

const isolatedRoot = fs.mkdtempSync(path.join(workRoot, 'mode-rest-ui-'));
const debugPort = await reserveDebugPort();
const childEnvironment = {
  ...process.env,
  SUPERVISION_DATA_DIR: isolatedRoot,
};
delete childEnvironment.ELECTRON_RUN_AS_NODE;

const appProcess = spawn(
  electronExecutable,
  [projectRoot, `--remote-debugging-port=${debugPort}`, '--beishu-mode-rest-ui-test'],
  {
    cwd: projectRoot,
    env: childEnvironment,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  },
);

let childOutput = '';
const captureChildOutput = (chunk) => {
  childOutput = `${childOutput}${chunk.toString()}`.slice(-16_000);
};
appProcess.stdout.on('data', captureChildOutput);
appProcess.stderr.on('data', captureChildOutput);

let main = null;
let prompt = null;
const report = {
  source: {
    executable: electronExecutable,
    projectRoot,
    isolatedRoot,
    debugPort,
  },
  coverageGaps: [],
  failures: [],
};

try {
  const mainTarget = await waitForTarget(
    debugPort,
    (target) => target.url === 'rwt://renderer/index.html',
    appProcess,
  );
  main = await connect(mainTarget.webSocketDebuggerUrl);
  await waitForEvaluation(
    main,
    `({
      testApi: Boolean(window.__beishuTest),
      desktopApi: Boolean(window.desktopAPI),
      restApi: Boolean(window.desktop),
      sceneReady: document.querySelector('#study-scene-canvas')?.dataset.animationReady === 'true'
    })`,
    (value) => value.testApi && value.desktopApi && value.restApi && value.sceneReady,
  );
  await main.evaluate(`window.desktopAPI.restoreSceneMode()`);
  await main.evaluate(`window.__beishuTest.setPlaybackRate(16)`);

  report.initial = await main.evaluate(`(async () => ({
    documentTitle: document.title,
    heading: document.querySelector('.masthead h1').childNodes[0].textContent.trim(),
    creatorCredit: document.querySelector('.creator-credit')?.textContent.trim(),
    mode: window.__beishuTest.getSnapshot().mode,
    hasBreakPromptBridge: Boolean(window.breakPrompt),
    runtime: await window.desktopAPI.getRuntimeWindowState(),
    cache: await window.desktopAPI.getRuntimeCacheState()
  }))()`);
  assert(report.initial.documentTitle === '背书自习监督', `Unexpected product title: ${report.initial.documentTitle}`);
  assert(report.initial.heading === '背书自习监督', `Unexpected product heading: ${report.initial.heading}`);
  assert(report.initial.creatorCredit === '原作：叛逆蓝牙 · 二创：眼泪斷了线',
    `Creator attribution is missing or wrong: ${report.initial.creatorCredit}`);
  assert(report.initial.runtime.windowCount === 1, 'Fresh source instance did not start with one window');
  assert(report.initial.cache.inMemory && report.initial.cache.httpCacheDisabled && report.initial.cache.v8CacheDisabled,
    `Runtime cache policy is not memory-only: ${JSON.stringify(report.initial.cache)}`);
  assert(report.initial.runtime.minimumSize?.width === 960
    && report.initial.runtime.minimumSize?.height === 540,
    `Unexpected native minimum window size: ${JSON.stringify(report.initial.runtime.minimumSize)}`);
  assert(!report.initial.hasBreakPromptBridge, 'Main renderer received the break prompt bridge');
  const mainWebContentsId = report.initial.runtime.webContentsId;

  report.ipcBoundary = await main.evaluate(`(async () => {
    let invalidPayloadRejected = false;
    let extraFieldRejected = false;
    try {
      await window.desktopAPI.finishInlineAlert({ returnToHidden: 'false' });
    } catch {
      invalidPayloadRejected = true;
    }
    try {
      await window.desktopAPI.finishInlineAlert({ returnToHidden: false, extra: true });
    } catch {
      extraFieldRejected = true;
    }
    return {
      invalidPayloadRejected,
      extraFieldRejected,
      popupBlocked: window.open('about:blank') === null,
    };
  })()`);
  assert(report.ipcBoundary.invalidPayloadRejected && report.ipcBoundary.extraFieldRejected,
    `Invalid finish-inline-alert payload was accepted: ${JSON.stringify(report.ipcBoundary)}`);
  assert(report.ipcBoundary.popupBlocked, 'Main renderer was allowed to create a new window');

  report.windowChrome = await main.evaluate(`(() => {
    const titlebar = document.querySelector('#window-titlebar');
    const minimize = document.querySelector('#window-minimize-button');
    const maximize = document.querySelector('#window-maximize-button');
    const close = document.querySelector('#window-close-button');
    const rect = titlebar.getBoundingClientRect();
    return {
      titlebarExists: Boolean(titlebar),
      dragRegion: getComputedStyle(titlebar).getPropertyValue('-webkit-app-region')
        || getComputedStyle(titlebar).webkitAppRegion
        || '',
      controls: [minimize, maximize, close].map((button) => ({
        id: button?.id,
        label: button?.getAttribute('aria-label'),
        title: button?.title,
        visible: Boolean(button && button.getBoundingClientRect().width > 0 && button.getBoundingClientRect().height > 0),
      })),
      top: rect.top,
      height: rect.height,
    };
  })()`);
  assert(report.windowChrome.titlebarExists && report.windowChrome.dragRegion.includes('drag'),
    `Window titlebar is not draggable: ${JSON.stringify(report.windowChrome)}`);
  assertArray(
    report.windowChrome.controls.map((item) => item.id),
    ['window-minimize-button', 'window-maximize-button', 'window-close-button'],
    'Window controls are missing or out of order',
  );
  assert(report.windowChrome.controls.every((item) => item.visible),
    `Window controls are not visible: ${JSON.stringify(report.windowChrome.controls)}`);

  await main.evaluate(`document.querySelector('#window-maximize-button').click()`);
  report.maximized = await waitForEvaluation(
    main,
    `(async () => await window.desktopAPI.getRuntimeWindowState())()`,
    (value) => value.maximized === true,
  );
  const maximizeLabel = await main.evaluate(`document.querySelector('#window-maximize-button').getAttribute('aria-label')`);
  assert(maximizeLabel === '还原窗口', `Maximize control did not switch to restore: ${maximizeLabel}`);
  await main.evaluate(`document.querySelector('#window-maximize-button').click()`);
  report.restored = await waitForEvaluation(
    main,
    `(async () => await window.desktopAPI.getRuntimeWindowState())()`,
    (value) => value.maximized === false && value.visible === true,
  );

  const titlebarPoint = await main.evaluate(`(() => {
    const rect = document.querySelector('#window-titlebar').getBoundingClientRect();
    return { x: Math.max(20, Math.min(rect.width - 160, 180)), y: rect.top + rect.height / 2 };
  })()`);
  const doubleClickTitlebar = async () => {
    await main.send('Input.dispatchMouseEvent', {
      type: 'mousePressed', x: titlebarPoint.x, y: titlebarPoint.y,
      button: 'left', buttons: 1, clickCount: 1,
    });
    await main.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x: titlebarPoint.x, y: titlebarPoint.y,
      button: 'left', buttons: 0, clickCount: 1,
    });
    await main.send('Input.dispatchMouseEvent', {
      type: 'mousePressed', x: titlebarPoint.x, y: titlebarPoint.y,
      button: 'left', buttons: 1, clickCount: 2,
    });
    await main.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x: titlebarPoint.x, y: titlebarPoint.y,
      button: 'left', buttons: 0, clickCount: 2,
    });
  };
  await doubleClickTitlebar();
  report.doubleClickMaximized = await waitForEvaluation(
    main,
    `(async () => await window.desktopAPI.getRuntimeWindowState())()`,
    (value) => value.maximized === true,
  );
  await doubleClickTitlebar();
  report.doubleClickRestored = await waitForEvaluation(
    main,
    `(async () => await window.desktopAPI.getRuntimeWindowState())()`,
    (value) => value.maximized === false && value.visible === true,
  );

  await main.evaluate(`document.querySelector('#window-minimize-button').click()`);
  report.minimized = await waitForEvaluation(
    main,
    `(async () => await window.desktopAPI.getRuntimeWindowState())()`,
    (value) => value.minimized === true,
  );
  await main.evaluate(`window.desktopAPI.restoreSceneMode()`);
  await waitForEvaluation(
    main,
    `(async () => await window.desktopAPI.getRuntimeWindowState())()`,
    (value) => value.visible === true && value.minimized === false,
  );
  await main.evaluate(`document.querySelector('#window-close-button').click()`);
  report.chromeHidden = await waitForEvaluation(
    main,
    `(async () => await window.desktopAPI.getRuntimeWindowState())()`,
    (value) => value.mode === 'hidden' && value.visible === false,
  );
  await main.evaluate(`window.desktopAPI.restoreSceneMode()`);
  await waitForEvaluation(
    main,
    `(async () => await window.desktopAPI.getRuntimeWindowState())()`,
    (value) => value.mode === 'scene' && value.visible === true,
  );

  await main.send('Emulation.setDeviceMetricsOverride', {
    width: 1920,
    height: 1080,
    deviceScaleFactor: 1,
    mobile: false,
  });
  report.layouts = {};
  report.layouts.wideCollapsed = await main.evaluate(layoutExpression);
  assertLayout(report.layouts.wideCollapsed, '1920 collapsed layout');

  report.modeSwitch = await main.evaluate(`(() => {
    document.querySelector('#study-mode-button').click();
    const study = {
      mode: window.__beishuTest.getSnapshot().mode,
      title: document.querySelector('#mode-title').textContent,
      recitePressed: document.querySelector('#recite-mode-button').getAttribute('aria-pressed'),
      studyPressed: document.querySelector('#study-mode-button').getAttribute('aria-pressed'),
      liveTitle: document.querySelector('#live-voice-title').textContent,
    };
    document.querySelector('#recite-mode-button').click();
    const recite = {
      mode: window.__beishuTest.getSnapshot().mode,
      title: document.querySelector('#mode-title').textContent,
      recitePressed: document.querySelector('#recite-mode-button').getAttribute('aria-pressed'),
      studyPressed: document.querySelector('#study-mode-button').getAttribute('aria-pressed'),
      liveTitle: document.querySelector('#live-voice-title').textContent,
    };
    return { study, recite };
  })()`);
  assert(report.modeSwitch.study.mode === 'study'
    && report.modeSwitch.study.title.includes('自习')
    && report.modeSwitch.study.recitePressed === 'false'
    && report.modeSwitch.study.studyPressed === 'true', 'Switching to study mode failed');
  assert(report.modeSwitch.recite.mode === 'recite'
    && report.modeSwitch.recite.title.includes('背书')
    && report.modeSwitch.recite.recitePressed === 'true'
    && report.modeSwitch.recite.studyPressed === 'false', 'Switching back to recite mode failed');

  report.collapsedThresholdDrag = await main.evaluate(`(() => {
    const marker = document.querySelector('#live-volume-threshold');
    const detailMarker = document.querySelector('#volume-threshold');
    const meter = document.querySelector('#live-meter');
    const range = document.querySelector('#voice-threshold-input');
    const rect = meter.getBoundingClientRect();
    const markerRect = marker.getBoundingClientRect();
    const pointerId = 41;
    marker.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
      pointerId,
      pointerType: 'mouse',
      button: 0,
      buttons: 1,
      clientX: markerRect.left + markerRect.width / 2,
    }));
    window.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true,
      pointerId,
      pointerType: 'mouse',
      buttons: 1,
      clientX: rect.left + rect.width * 0.64,
    }));
    window.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true,
      pointerId,
      pointerType: 'mouse',
      button: 0,
      clientX: rect.left + rect.width * 0.64,
    }));
    const keyboardValues = [];
    for (const key of ['ArrowRight', 'Home', 'End', 'ArrowLeft']) {
      marker.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key }));
      keyboardValues.push(Number(range.value));
    }
    return {
      controlsOpen: document.body.classList.contains('controls-open'),
      keyboardValues,
      stored: window.__beishuTest.getSnapshot().reciteSensitivityDb,
      persisted: JSON.parse(localStorage.getItem('red-watch-study-settings-v1')).reciteSensitivityDb,
      range: Number(range.value),
      liveLeft: marker.style.left,
      detailLeft: detailMarker.style.left,
      liveAria: {
        min: marker.getAttribute('aria-valuemin'),
        max: marker.getAttribute('aria-valuemax'),
        now: marker.getAttribute('aria-valuenow'),
        text: marker.getAttribute('aria-valuetext'),
        role: marker.getAttribute('role'),
        tabIndex: marker.tabIndex,
      },
      detailAriaNow: detailMarker.getAttribute('aria-valuenow'),
    };
  })()`);
  assert(!report.collapsedThresholdDrag.controlsOpen
    && JSON.stringify(report.collapsedThresholdDrag.keyboardValues) === JSON.stringify([15, 4, 18, 17])
    && report.collapsedThresholdDrag.stored === 17
    && report.collapsedThresholdDrag.persisted === 17
    && report.collapsedThresholdDrag.range === 17
    && report.collapsedThresholdDrag.liveLeft === '67%'
    && report.collapsedThresholdDrag.detailLeft === '67%'
    && report.collapsedThresholdDrag.liveAria.min === '4'
    && report.collapsedThresholdDrag.liveAria.max === '18'
    && report.collapsedThresholdDrag.liveAria.now === '17'
    && report.collapsedThresholdDrag.liveAria.text === '底噪 + 17 dB'
    && report.collapsedThresholdDrag.liveAria.role === 'slider'
    && report.collapsedThresholdDrag.liveAria.tabIndex === 0
    && report.collapsedThresholdDrag.detailAriaNow === '17',
  `Collapsed live threshold marker did not drag, clamp, persist, or synchronize: ${JSON.stringify(report.collapsedThresholdDrag)}`);

  await main.evaluate(`document.querySelector('#controls-button').click()`);
  report.layouts.wideExpanded = await main.evaluate(layoutExpression);
  assertLayout(report.layouts.wideExpanded, '1920 expanded layout');

  report.detailThresholdDrag = await main.evaluate(`(() => {
    const marker = document.querySelector('#volume-threshold');
    const liveMarker = document.querySelector('#live-volume-threshold');
    const meter = document.querySelector('.meter-wrap .meter');
    const range = document.querySelector('#voice-threshold-input');
    const rect = meter.getBoundingClientRect();
    const markerRect = marker.getBoundingClientRect();
    const pointerId = 42;
    marker.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, pointerId, pointerType: 'touch', button: 0, buttons: 1,
      clientX: markerRect.left + markerRect.width / 2,
    }));
    window.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true, pointerId, pointerType: 'touch', buttons: 1,
      clientX: rect.left + rect.width * 0.61,
    }));
    window.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true, pointerId, pointerType: 'touch', button: 0,
      clientX: rect.left + rect.width * 0.61,
    }));
    return {
      stored: window.__beishuTest.getSnapshot().reciteSensitivityDb,
      range: Number(range.value),
      detailLeft: marker.style.left,
      liveLeft: liveMarker.style.left,
      detailAriaNow: marker.getAttribute('aria-valuenow'),
      liveAriaNow: liveMarker.getAttribute('aria-valuenow'),
    };
  })()`);
  assert(report.detailThresholdDrag.stored === 11
    && report.detailThresholdDrag.range === 11
    && report.detailThresholdDrag.detailLeft === '61%'
    && report.detailThresholdDrag.liveLeft === '61%'
    && report.detailThresholdDrag.detailAriaNow === '11'
    && report.detailThresholdDrag.liveAriaNow === '11',
  `Detailed threshold marker did not update the hidden range and live marker: ${JSON.stringify(report.detailThresholdDrag)}`);

  report.reciteBoundary = await main.evaluate(rangeBoundaryExpression(
    '#silence-limit-input',
    [19, 20, 60, 61],
    'reciteSilenceSeconds',
  ));
  assert(report.reciteBoundary.minimum === 20 && report.reciteBoundary.maximum === 60,
    `Recite range attributes are wrong: ${JSON.stringify(report.reciteBoundary)}`);
  assertArray(
    report.reciteBoundary.results.map((item) => [item.inputValue, item.storedValue]),
    [[20, 20], [20, 20], [60, 60], [60, 60]],
    'Recite 20-60 boundary clamping failed',
  );

  await main.evaluate(`document.querySelector('#study-mode-button').click()`);
  report.studyBoundary = await main.evaluate(rangeBoundaryExpression(
    '#study-voice-limit-input',
    [2, 3, 15, 16],
    'studyVoiceSeconds',
  ));
  assert(report.studyBoundary.minimum === 3 && report.studyBoundary.maximum === 15,
    `Study range attributes are wrong: ${JSON.stringify(report.studyBoundary)}`);
  assertArray(
    report.studyBoundary.results.map((item) => [item.inputValue, item.storedValue]),
    [[3, 3], [3, 3], [15, 15], [15, 15]],
    'Study 3-15 boundary clamping failed',
  );

  await main.send('Emulation.setDeviceMetricsOverride', {
    width: 480,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  report.layouts.narrowExpanded = await main.evaluate(layoutExpression);
  assertLayout(report.layouts.narrowExpanded, 'Narrow expanded layout');
  await main.evaluate(`document.querySelector('#controls-button').click()`);
  report.layouts.narrowCollapsed = await main.evaluate(layoutExpression);
  assertLayout(report.layouts.narrowCollapsed, 'Narrow collapsed layout');
  await main.send('Emulation.setDeviceMetricsOverride', {
    width: 960,
    height: 540,
    deviceScaleFactor: 1,
    mobile: false,
  });
  report.layouts.nativeMinimum = await main.evaluate(layoutExpression);
  assertLayout(report.layouts.nativeMinimum, '960x540 native minimum layout');
  assert(report.layouts.nativeMinimum.creatorCredit.inViewport,
    `960x540 attribution is outside the initial viewport: ${JSON.stringify(report.layouts.nativeMinimum.creatorCredit)}`);
  await main.evaluate(`(() => {
    document.querySelector('#controls-button').click();
    document.querySelector('.shell').scrollTop = 0;
    return true;
  })()`);
  report.layouts.nativeExpandedTop = await main.evaluate(layoutExpression);
  assertLayout(report.layouts.nativeExpandedTop, '960x540 expanded top layout');
  assert(report.layouts.nativeExpandedTop.creatorCredit.inViewport,
    `960x540 expanded attribution is outside the viewport: ${JSON.stringify(report.layouts.nativeExpandedTop.creatorCredit)}`);
  assert(report.layouts.nativeExpandedTop.preflightRow.inViewport
    || report.layouts.nativeExpandedTop.preflightRow.shellScrollable,
  `960x540 preflight row is neither visible nor reachable by scrolling: ${JSON.stringify(report.layouts.nativeExpandedTop.preflightRow)}`);
  await main.evaluate(`document.querySelector('.preflight-test-row').scrollIntoView({ block: 'center' })`);
  report.layouts.nativeExpandedPreflight = await main.evaluate(layoutExpression);
  assertPreflightLayout(report.layouts.nativeExpandedPreflight, '960x540 scrolled preflight layout');
  assert(report.layouts.nativeExpandedPreflight.overlaps.length === 0,
    `960x540 scrolled layout has overlapping buttons: ${JSON.stringify(report.layouts.nativeExpandedPreflight.overlaps)}`);
  await main.evaluate(`document.querySelector('.shell').scrollTop = 0`);
  await main.send('Emulation.clearDeviceMetricsOverride');

  report.preflightWithoutVoiceprint = await main.evaluate(`(async () => {
    await window.desktopAPI.deleteSpeakerProfile().catch(() => {});
    await refreshSpeakerState();
    window.__gumCalls = [];
    window.__gumStreams = [];
    window.__gumRequests = [];
    window.__testAudioContexts = [];
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      configurable: true,
      value: async (constraints) => {
        const serialized = JSON.parse(JSON.stringify(constraints));
        const liveBeforeRequest = window.__gumStreams
          .flatMap((stream) => stream.getTracks())
          .filter((track) => track.readyState === 'live').length;
        window.__gumCalls.push(serialized);
        const context = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
        const destination = context.createMediaStreamDestination();
        window.__testAudioContexts.push(context);
        window.__gumStreams.push(destination.stream);
        window.__gumRequests.push({ constraints: serialized, liveBeforeRequest });
        return destination.stream;
      }
    });
    Object.defineProperty(navigator.mediaDevices, 'enumerateDevices', {
      configurable: true,
      value: async () => [
        { kind: 'audioinput', deviceId: 'mic-a', label: '桌面麦克风' },
        { kind: 'audioinput', deviceId: 'mic-b', label: 'USB 麦克风' },
      ],
    });
    await refreshMicrophones({ requestPermission: true });
    const microphone = document.querySelector('#microphone-select');
    microphone.value = 'mic-b';
    microphone.dispatchEvent(new Event('change', { bubbles: true }));
    window.__microphoneSelection = {
      options: [...microphone.options].map((option) => ({ value: option.value, text: option.textContent.trim() })),
      selected: microphone.value,
      settings: JSON.parse(localStorage.getItem('red-watch-study-settings-v1')).microphoneDeviceId,
      constraints: microphoneConstraints(),
    };
    window.__gumCalls = [];
    window.__gumStreams = [];
    window.__gumRequests = [];
    document.querySelector('#recite-mode-button').click();
    const button = document.querySelector('#preflight-test-button');
    button.click();
    await Promise.resolve();
    return {
      snapshot: window.__beishuTest.getSnapshot(),
      profile: state.speakerProfileExists,
      buttonDisabled: button.disabled,
      buttonText: button.textContent.trim(),
      status: document.querySelector('#preflight-test-status').textContent.trim(),
      gumCalls: window.__gumCalls.length,
    };
  })()`);
  assert(report.preflightWithoutVoiceprint.snapshot.mode === 'recite'
    && !report.preflightWithoutVoiceprint.profile
    && !report.preflightWithoutVoiceprint.snapshot.preflightCanStart
    && !report.preflightWithoutVoiceprint.snapshot.preflightTesting
    && !report.preflightWithoutVoiceprint.snapshot.microphoneOpen
    && report.preflightWithoutVoiceprint.buttonDisabled
    && report.preflightWithoutVoiceprint.status.includes('请先录入本人声音')
    && report.preflightWithoutVoiceprint.gumCalls === 0,
  `Missing-voiceprint preflight was misleading or requested the microphone: ${JSON.stringify(report.preflightWithoutVoiceprint)}`);
  report.microphoneSelection = await main.evaluate(`window.__microphoneSelection`);
  assert(report.microphoneSelection.selected === 'mic-b'
    && report.microphoneSelection.settings === 'mic-b'
    && report.microphoneSelection.options.length === 3
    && report.microphoneSelection.constraints.audio.deviceId.exact === 'mic-b'
    && report.microphoneSelection.constraints.video === false,
  `Microphone selection was not persisted or applied: ${JSON.stringify(report.microphoneSelection)}`);

  report.preflightStarted = await main.evaluate(`(async () => {
    document.querySelector('#study-mode-button').click();
    const snapshot = window.__beishuTest.getSnapshot();
    window.__preflightBaseline = {
      snapshot,
      scenePhase: document.body.dataset.scenePhase,
      sceneClip: document.body.dataset.sceneClip,
      sceneRunning: state.sceneRunning,
      timer: document.querySelector('#timer').textContent,
    };
    await window.__beishuTest.startPreflightTest();
    return {
      baseline: window.__preflightBaseline,
      snapshot: window.__beishuTest.getSnapshot(),
    };
  })()`);
  assert(report.preflightStarted.snapshot.mode === 'study'
    && report.preflightStarted.snapshot.preflightTesting
    && !report.preflightStarted.snapshot.active
    && report.preflightStarted.snapshot.sessionPhase === 'idle',
  `Study preflight did not start in idle mode: ${JSON.stringify(report.preflightStarted)}`);
  await completePreflightCalibration(main);
  const preflightElapsedBefore = await main.evaluate(`window.__beishuTest.getSnapshot().effectiveElapsedMs`);
  await wait(300);
  report.preflightCalibrated = await main.evaluate(`(() => {
    const snapshot = window.__beishuTest.getSnapshot();
    const stream = window.__gumStreams[0];
    return {
      snapshot,
      gum: window.__gumRequests[0],
      audioTracks: stream?.getAudioTracks().length || 0,
      videoTracks: stream?.getVideoTracks().length || 0,
      liveTracks: stream?.getTracks().filter((track) => track.readyState === 'live').length || 0,
      scenePhase: document.body.dataset.scenePhase,
      sceneClip: document.body.dataset.sceneClip,
      sceneRunning: state.sceneRunning,
      timer: document.querySelector('#timer').textContent,
      status: document.querySelector('#preflight-test-status').textContent.trim(),
    };
  })()`);
  assert(Boolean(report.preflightCalibrated.gum?.constraints?.audio)
    && report.preflightCalibrated.gum?.constraints?.video === false
    && report.preflightCalibrated.gum?.constraints?.audio?.deviceId?.exact === 'mic-b'
    && report.preflightCalibrated.gum.liveBeforeRequest === 0
    && report.preflightCalibrated.audioTracks === 1
    && report.preflightCalibrated.videoTracks === 0
    && report.preflightCalibrated.liveTracks === 1,
  `Study preflight microphone was not a single audio-only stream: ${JSON.stringify(report.preflightCalibrated)}`);
  assert(report.preflightCalibrated.snapshot.preflightTesting
    && report.preflightCalibrated.snapshot.microphoneOpen
    && !report.preflightCalibrated.snapshot.calibrating
    && !report.preflightCalibrated.snapshot.active
    && report.preflightCalibrated.snapshot.sessionPhase === 'idle'
    && report.preflightCalibrated.snapshot.effectiveElapsedMs === preflightElapsedBefore
    && report.preflightCalibrated.snapshot.alerts === report.preflightStarted.baseline.snapshot.alerts
    && report.preflightCalibrated.snapshot.lives === report.preflightStarted.baseline.snapshot.lives
    && JSON.stringify(report.preflightCalibrated.snapshot.trace) === JSON.stringify(report.preflightStarted.baseline.snapshot.trace)
    && JSON.stringify(report.preflightCalibrated.snapshot.audioTrace) === JSON.stringify(report.preflightStarted.baseline.snapshot.audioTrace)
    && report.preflightCalibrated.scenePhase === report.preflightStarted.baseline.scenePhase
    && report.preflightCalibrated.sceneClip === report.preflightStarted.baseline.sceneClip
    && report.preflightCalibrated.sceneRunning === report.preflightStarted.baseline.sceneRunning
    && report.preflightCalibrated.timer === report.preflightStarted.baseline.timer,
  `Idle preflight started session state, timing, reminders, scenes, or source audio: ${JSON.stringify(report.preflightCalibrated)}`);

  report.preflightThreshold = await main.evaluate(`(() => {
    const duration = document.querySelector('#study-voice-limit-input');
    const sensitivity = document.querySelector('#voice-threshold-input');
    duration.value = '3';
    duration.dispatchEvent(new Event('input', { bubbles: true }));
    sensitivity.value = '16';
    sensitivity.dispatchEvent(new Event('input', { bubbles: true }));
    state.vad.process = () => ({
      calibrated: true,
      calibrationProgress: 1,
      isSpeech: true,
      levelDb: -40,
      levelPercent: 60,
      noiseFloorDb: -50,
      thresholdDb: -34,
      steadyNoise: false,
      speechScore: 1,
      voiceRatio: 0.7,
      flatness: 0.2,
      flux: 0.08
    });
    pollMicrophone();
    const highSensitivity = {
      detector: state.quietDetector.snapshot(),
      evidence: state.latestQuietResult.evidence,
    };
    sensitivity.value = '6';
    sensitivity.dispatchEvent(new Event('input', { bubbles: true }));
    pollMicrophone();
    const lowSensitivity = {
      detector: state.quietDetector.snapshot(),
      evidence: state.latestQuietResult.evidence,
    };
    for (let index = 0; index < 28; index += 1) pollMicrophone();
    const beforeThreshold = {
      snapshot: window.__beishuTest.getSnapshot(),
      status: document.querySelector('#preflight-test-status').textContent.trim(),
    };
    pollMicrophone();
    const afterThreshold = {
      snapshot: window.__beishuTest.getSnapshot(),
      status: document.querySelector('#preflight-test-status').textContent.trim(),
      voiceChip: document.querySelector('#voice-state').textContent.trim(),
      voiceStatus: document.querySelector('#voice-status').textContent.trim(),
      durationOutput: document.querySelector('#study-voice-limit-value').textContent.trim(),
      sensitivityOutput: document.querySelector('#voice-threshold-value').textContent.trim(),
      sceneRunning: state.sceneRunning,
    };

    duration.value = '15';
    duration.dispatchEvent(new Event('input', { bubbles: true }));
    const afterDurationChange = {
      snapshot: window.__beishuTest.getSnapshot(),
      detector: state.quietDetector.snapshot(),
      latestQuietResult: state.latestQuietResult,
      status: document.querySelector('#preflight-test-status').textContent.trim(),
      voiceStatus: document.querySelector('#voice-status').textContent.trim(),
    };
    for (let index = 0; index < 149; index += 1) pollMicrophone();
    const beforeNewDuration = {
      snapshot: window.__beishuTest.getSnapshot(),
      detector: state.quietDetector.snapshot(),
    };
    pollMicrophone();
    const afterNewDuration = {
      snapshot: window.__beishuTest.getSnapshot(),
      detector: state.quietDetector.snapshot(),
      status: document.querySelector('#preflight-test-status').textContent.trim(),
    };

    const marker = document.querySelector('#live-volume-threshold');
    const detailMarker = document.querySelector('#volume-threshold');
    const meter = document.querySelector('#live-meter');
    const rect = meter.getBoundingClientRect();
    const markerRect = marker.getBoundingClientRect();
    const pointerId = 43;
    marker.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, pointerId, pointerType: 'mouse', button: 0, buttons: 1,
      clientX: markerRect.left + markerRect.width / 2,
    }));
    window.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true, pointerId, pointerType: 'mouse', buttons: 1,
      clientX: rect.left + rect.width * 0.64,
    }));
    window.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true, pointerId, pointerType: 'mouse', button: 0,
      clientX: rect.left + rect.width * 0.64,
    }));
    const afterMarkerChange = {
      snapshot: window.__beishuTest.getSnapshot(),
      detector: state.quietDetector.snapshot(),
      vadSensitivityDb: state.vad.sensitivityDb,
      latestQuietResult: state.latestQuietResult,
      status: document.querySelector('#preflight-test-status').textContent.trim(),
      voiceStatus: document.querySelector('#voice-status').textContent.trim(),
      range: Number(sensitivity.value),
      liveLeft: marker.style.left,
      detailLeft: detailMarker.style.left,
      liveAriaNow: marker.getAttribute('aria-valuenow'),
      detailAriaNow: detailMarker.getAttribute('aria-valuenow'),
      persisted: JSON.parse(localStorage.getItem('red-watch-study-settings-v1')).studySensitivityDb,
    };
    return {
      highSensitivity,
      lowSensitivity,
      beforeThreshold,
      afterThreshold,
      afterDurationChange,
      beforeNewDuration,
      afterNewDuration,
      afterMarkerChange,
    };
  })()`);
  assert(report.preflightThreshold.highSensitivity.detector.violationSeconds === 3
    && report.preflightThreshold.highSensitivity.detector.sensitivityDb === 16
    && !report.preflightThreshold.highSensitivity.evidence
    && report.preflightThreshold.lowSensitivity.detector.sensitivityDb === 6
    && report.preflightThreshold.lowSensitivity.evidence,
  `Preflight sliders did not update the live detector: ${JSON.stringify(report.preflightThreshold)}`);
  assert(!report.preflightThreshold.beforeThreshold.snapshot.preflightThresholdReached
    && report.preflightThreshold.afterThreshold.snapshot.preflightThresholdReached
    && report.preflightThreshold.afterThreshold.status === '按当前设置将触发提醒。'
    && report.preflightThreshold.afterThreshold.voiceChip === '已达到提醒条件'
    && report.preflightThreshold.afterThreshold.voiceStatus === '已达到提醒条件'
    && report.preflightThreshold.afterThreshold.durationOutput === '3 秒'
    && report.preflightThreshold.afterThreshold.sensitivityOutput === '底噪 + 6 dB'
    && report.preflightThreshold.afterThreshold.snapshot.alerts === report.preflightStarted.baseline.snapshot.alerts
    && report.preflightThreshold.afterThreshold.snapshot.lives === report.preflightStarted.baseline.snapshot.lives
    && JSON.stringify(report.preflightThreshold.afterThreshold.snapshot.trace) === JSON.stringify(report.preflightStarted.baseline.snapshot.trace)
    && JSON.stringify(report.preflightThreshold.afterThreshold.snapshot.audioTrace) === JSON.stringify(report.preflightStarted.baseline.snapshot.audioTrace)
    && !report.preflightThreshold.afterThreshold.sceneRunning,
  `Preflight threshold caused a real reminder or scene change: ${JSON.stringify(report.preflightThreshold)}`);
  assert(!report.preflightThreshold.afterDurationChange.snapshot.preflightThresholdReached
    && report.preflightThreshold.afterDurationChange.detector.violationSeconds === 15
    && report.preflightThreshold.afterDurationChange.detector.suspectedSpeechMs === 0
    && report.preflightThreshold.afterDurationChange.latestQuietResult === null
    && report.preflightThreshold.afterDurationChange.status === '设置已更新，请继续测试。'
    && report.preflightThreshold.afterDurationChange.voiceStatus === '设置已更新，请继续测试'
    && !report.preflightThreshold.beforeNewDuration.snapshot.preflightThresholdReached
    && report.preflightThreshold.beforeNewDuration.detector.suspectedSpeechMs === 14_900
    && report.preflightThreshold.afterNewDuration.snapshot.preflightThresholdReached
    && !report.preflightThreshold.afterNewDuration.detector.armed
    && report.preflightThreshold.afterNewDuration.detector.suspectedSpeechMs === 0
    && report.preflightThreshold.afterNewDuration.status === '按当前设置将触发提醒。',
  `Changing the preflight duration preserved stale evidence or ignored the new duration: ${JSON.stringify(report.preflightThreshold)}`);
  assert(!report.preflightThreshold.afterMarkerChange.snapshot.preflightThresholdReached
    && report.preflightThreshold.afterMarkerChange.snapshot.studySensitivityDb === 14
    && report.preflightThreshold.afterMarkerChange.detector.sensitivityDb === 14
    && report.preflightThreshold.afterMarkerChange.detector.suspectedSpeechMs === 0
    && report.preflightThreshold.afterMarkerChange.vadSensitivityDb === 14
    && report.preflightThreshold.afterMarkerChange.latestQuietResult === null
    && report.preflightThreshold.afterMarkerChange.status === '设置已更新，请继续测试。'
    && report.preflightThreshold.afterMarkerChange.voiceStatus === '设置已更新，请继续测试'
    && report.preflightThreshold.afterMarkerChange.range === 14
    && report.preflightThreshold.afterMarkerChange.liveLeft === '64%'
    && report.preflightThreshold.afterMarkerChange.detailLeft === '64%'
    && report.preflightThreshold.afterMarkerChange.liveAriaNow === '14'
    && report.preflightThreshold.afterMarkerChange.detailAriaNow === '14'
    && report.preflightThreshold.afterMarkerChange.persisted === 14,
  `Dragging the live marker did not reset stale preflight evidence or synchronize detectors: ${JSON.stringify(report.preflightThreshold)}`);

  report.preflightStopped = await main.evaluate(`(async () => {
    const stream = window.__gumStreams[0];
    await window.__beishuTest.stopPreflightTest();
    return {
      snapshot: window.__beishuTest.getSnapshot(),
      audioTimer: Boolean(state.audioTimer),
      analyser: Boolean(state.analyser),
      context: Boolean(state.audioContext),
      trackStates: stream.getTracks().map((track) => track.readyState),
      buttonText: document.querySelector('#preflight-test-button').textContent.trim(),
    };
  })()`);
  assert(!report.preflightStopped.snapshot.preflightTesting
    && !report.preflightStopped.snapshot.preflightStarting
    && !report.preflightStopped.snapshot.preflightStopping
    && !report.preflightStopped.snapshot.microphoneOpen
    && !report.preflightStopped.audioTimer
    && !report.preflightStopped.analyser
    && !report.preflightStopped.context
    && report.preflightStopped.trackStates.every((value) => value === 'ended')
    && report.preflightStopped.buttonText === '测试当前设置',
  `Stopping preflight leaked microphone resources: ${JSON.stringify(report.preflightStopped)}`);

  await main.evaluate(`window.__beishuTest.startPreflightTest()`);
  await waitForEvaluation(
    main,
    `window.__beishuTest.getSnapshot()`,
    (value) => value.preflightTesting && value.microphoneOpen,
  );
  await main.evaluate(`(() => {
    window.__endedPreflightStream = window.__gumStreams.at(-1);
    window.__endedPreflightStream.getAudioTracks()[0].dispatchEvent(new Event('ended'));
    return true;
  })()`);
  report.preflightDeviceEnded = await waitForEvaluation(
    main,
    `({
      snapshot: window.__beishuTest.getSnapshot(),
      status: document.querySelector('#preflight-test-status').textContent.trim(),
      trackStates: window.__endedPreflightStream.getTracks().map((track) => track.readyState),
      hasTimer: Boolean(state.audioTimer),
      hasContext: Boolean(state.audioContext),
      hasAnalyser: Boolean(state.analyser)
    })`,
    (value) => !value.snapshot.preflightTesting
      && !value.snapshot.preflightStopping
      && !value.snapshot.microphoneOpen,
  );
  assert(report.preflightDeviceEnded.status.includes('麦克风已断开')
    && report.preflightDeviceEnded.trackStates.every((value) => value === 'ended')
    && !report.preflightDeviceEnded.hasTimer
    && !report.preflightDeviceEnded.hasContext
    && !report.preflightDeviceEnded.hasAnalyser,
  `Preflight device-ended callback leaked resources or hid the cause: ${JSON.stringify(report.preflightDeviceEnded)}`);

  await main.evaluate(`(async () => {
    const NativeAudioContext = window.AudioContext;
    const originalGetUserMedia = navigator.mediaDevices.getUserMedia;
    let sourceContext = null;
    let endedStream = null;
    let errorMessage = '';
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      configurable: true,
      value: async () => {
        sourceContext = new NativeAudioContext({ sampleRate: 16000 });
        const destination = sourceContext.createMediaStreamDestination();
        endedStream = destination.stream;
        return endedStream;
      },
    });
    window.AudioContext = class EndingAudioContext extends NativeAudioContext {
      async resume() {
        const result = await super.resume();
        const track = endedStream.getAudioTracks()[0];
        track.stop();
        track.dispatchEvent(new Event('ended'));
        return result;
      }
    };
    state.startPending = true;
    try {
      await openMicrophone();
    } catch (error) {
      errorMessage = error.message;
    } finally {
      window.AudioContext = NativeAudioContext;
      Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
        configurable: true,
        value: originalGetUserMedia,
      });
      await sourceContext?.close().catch(() => {});
    }
    window.__startingTrackEnded = {
      errorMessage,
      trackStates: endedStream.getTracks().map((track) => track.readyState),
    };
    return true;
  })()`);
  report.startingTrackEnded = await waitForEvaluation(
    main,
    `({
      result: window.__startingTrackEnded,
      snapshot: window.__beishuTest.getSnapshot(),
      cleanupPending: state.sessionFailureCleanupPending,
      hasTimer: Boolean(state.audioTimer),
      hasContext: Boolean(state.audioContext),
      hasAnalyser: Boolean(state.analyser),
      voiceStatus: document.querySelector('#voice-status').textContent.trim()
    })`,
    (value) => !value.snapshot.startPending
      && !value.snapshot.active
      && value.snapshot.sessionPhase === 'idle'
      && !value.snapshot.microphoneOpen
      && !value.cleanupPending,
  );
  assert(report.startingTrackEnded.result.errorMessage.includes('实时音频轨道')
    && report.startingTrackEnded.result.trackStates.every((value) => value === 'ended')
    && !report.startingTrackEnded.hasTimer
    && !report.startingTrackEnded.hasContext
    && !report.startingTrackEnded.hasAnalyser
    && report.startingTrackEnded.voiceStatus.includes('麦克风已断开'),
  `A microphone track ending during startup was accepted or leaked resources: ${JSON.stringify(report.startingTrackEnded)}`);

  report.studyWithoutVoiceprint = await main.evaluate(`(async () => {
    await window.__beishuTest.startPreflightTest();
    return {
      mode: window.__beishuTest.getSnapshot().mode,
      profile: state.speakerProfileExists,
      startEnabled: !document.querySelector('#start-button').disabled,
      preflightStreamIndex: window.__gumStreams.length - 1,
    };
  })()`);
  assert(report.studyWithoutVoiceprint.mode === 'study'
    && !report.studyWithoutVoiceprint.profile
    && report.studyWithoutVoiceprint.startEnabled, 'Study mode was blocked by a missing voiceprint');
  await completePreflightCalibration(main);
  report.startWinsRace = await main.evaluate(`(async () => {
    const [startResult, previewResult, enrollmentResult] = await Promise.all([
      startSession(),
      previewSelectedClip(),
      openSpeakerEnrollment(),
    ]);
    return {
      startResult,
      previewResult,
      enrollmentResult,
      startPending: state.startPending,
      previewPending: state.previewPending,
      presentation: Boolean(state.presentation),
      enrollmentPending: state.enrollmentPending,
      enrollmentOpen: state.enrollmentOpen,
    };
  })()`);
  assert(!report.startWinsRace.previewPending
    && !report.startWinsRace.presentation
    && !report.startWinsRace.enrollmentPending
    && !report.startWinsRace.enrollmentOpen,
  `Start did not exclude simultaneous preview/enrollment: ${JSON.stringify(report.startWinsRace)}`);
  await completeCalibration(main);
  report.studyStarted = await main.evaluate(`({
    snapshot: window.__beishuTest.getSnapshot(),
    gum: window.__gumRequests.at(-1),
    audioTracks: state.audioStream?.getAudioTracks().length || 0,
    videoTracks: state.audioStream?.getVideoTracks().length || 0,
    preflightTrackStates: window.__gumStreams[window.__gumStreams.length - 2]
      .getTracks().map((track) => track.readyState),
    liveTracksAcrossRequests: window.__gumStreams
      .flatMap((stream) => stream.getTracks())
      .filter((track) => track.readyState === 'live').length,
    layout: ${layoutExpression}
  })`);
  assert(report.studyStarted.snapshot.active && report.studyStarted.snapshot.mode === 'study'
    && report.studyStarted.snapshot.sessionPhase === 'studying'
    && !report.studyStarted.snapshot.preflightTesting
    && !report.studyStarted.snapshot.preflightStarting
    && !report.studyStarted.snapshot.preflightStopping,
  'Study session did not take over cleanly from preflight');
  assert(Boolean(report.studyStarted.gum?.constraints?.audio)
    && report.studyStarted.gum?.constraints?.video === false
    && report.studyStarted.gum.liveBeforeRequest === 0
    && report.studyStarted.audioTracks === 1
    && report.studyStarted.videoTracks === 0
    && report.studyStarted.preflightTrackStates.every((value) => value === 'ended')
    && report.studyStarted.liveTracksAcrossRequests === 1,
  `Preflight-to-session handoff leaked or duplicated audio tracks: ${JSON.stringify(report.studyStarted)}`);
  assertLayout(report.studyStarted.layout, 'Active study layout');

  report.meters = await main.evaluate(`(() => {
    state.vad.process = () => ${forcedVadResult};
    pollMicrophone();
    const detailMeter = document.querySelector('.meter-wrap .meter');
    const liveMeter = document.querySelector('#live-meter');
    const snapshot = window.__beishuTest.getSnapshot();
    const expectedThreshold = String(Math.min(100, Math.max(0,
      snapshot.latestNoiseFloorDb + snapshot.studySensitivityDb + 100))) + '%';
    return {
      detailAria: detailMeter.getAttribute('aria-valuenow'),
      liveAria: liveMeter.getAttribute('aria-valuenow'),
      detailBar: document.querySelector('#volume-bar').style.width,
      liveBar: document.querySelector('#live-volume-bar').style.width,
      detailThreshold: document.querySelector('#volume-threshold').style.left,
      liveThreshold: document.querySelector('#live-volume-threshold').style.left,
      expectedThreshold,
      sensitivityDb: snapshot.studySensitivityDb,
      noiseFloorDb: snapshot.latestNoiseFloorDb,
      stripVisible: ${layoutExpression}.stripVisible,
    };
  })()`);
  if (report.meters.detailAria !== '37' || report.meters.liveAria !== '37') {
    report.failures.push(`Meter aria values are not synchronized: ${JSON.stringify(report.meters)}`);
  }
  assert(report.meters.detailBar === '37%' && report.meters.liveBar === '37%'
    && report.meters.detailThreshold === report.meters.expectedThreshold
    && report.meters.liveThreshold === report.meters.expectedThreshold
    && report.meters.sensitivityDb === 14
    && report.meters.noiseFloorDb === -50,
  `Meter visuals are not synchronized: ${JSON.stringify(report.meters)}`);
  assert(report.meters.stripVisible, 'Live voice strip disappeared during active detection');

  await main.evaluate(`stopSession(false, true)`);
  await waitForEvaluation(main, `window.__beishuTest.getSnapshot()`, (value) => !value.active && value.sessionPhase === 'idle');

  report.previewWinsRace = await main.evaluate(`(async () => {
    await window.__beishuTest.startPreflightTest();
    const [previewResult, startResult, enrollmentResult] = await Promise.all([
      previewSelectedClip(),
      startSession(),
      openSpeakerEnrollment(),
    ]);
    return {
      previewResult,
      startResult,
      enrollmentResult,
      active: state.active,
      startPending: state.startPending,
      previewPending: state.previewPending,
      presentation: state.presentation?.kind || '',
      enrollmentPending: state.enrollmentPending,
      enrollmentOpen: state.enrollmentOpen,
      microphoneOpen: Boolean(state.audioStream),
    };
  })()`);
  assert(!report.previewWinsRace.active
    && !report.previewWinsRace.startPending
    && !report.previewWinsRace.previewPending
    && report.previewWinsRace.presentation === 'preview'
    && !report.previewWinsRace.enrollmentPending
    && !report.previewWinsRace.enrollmentOpen
    && !report.previewWinsRace.microphoneOpen,
  `Preview did not exclude simultaneous start/enrollment: ${JSON.stringify(report.previewWinsRace)}`);
  await main.evaluate(`finishPreview()`);
  await waitForEvaluation(
    main,
    `({ presentation: Boolean(state.presentation), startDisabled: document.querySelector('#start-button').disabled,
      modeDisabled: document.querySelector('#recite-mode-button').disabled,
      enrollDisabled: document.querySelector('#speaker-enroll-button').disabled })`,
    (value) => !value.presentation && !value.startDisabled && !value.modeDisabled && !value.enrollDisabled,
  );

  report.enrollmentWinsRace = await main.evaluate(`(async () => {
    await window.__beishuTest.startPreflightTest();
    const [enrollmentResult, startResult, previewResult] = await Promise.all([
      openSpeakerEnrollment(),
      startSession(),
      previewSelectedClip(),
    ]);
    return {
      enrollmentResult,
      startResult,
      previewResult,
      active: state.active,
      startPending: state.startPending,
      previewPending: state.previewPending,
      presentation: Boolean(state.presentation),
      enrollmentPending: state.enrollmentPending,
      enrollmentOpen: state.enrollmentOpen,
      microphoneOpen: Boolean(state.audioStream),
    };
  })()`);
  assert(!report.enrollmentWinsRace.active
    && !report.enrollmentWinsRace.startPending
    && !report.enrollmentWinsRace.previewPending
    && !report.enrollmentWinsRace.presentation
    && !report.enrollmentWinsRace.enrollmentPending
    && report.enrollmentWinsRace.enrollmentOpen
    && !report.enrollmentWinsRace.microphoneOpen,
  `Enrollment did not exclude simultaneous start/preview: ${JSON.stringify(report.enrollmentWinsRace)}`);
  await main.evaluate(`closeSpeakerEnrollment({ cancel: true })`);
  await waitForEvaluation(main, `Boolean(state.enrollmentOpen || state.enrollmentPending)`, (value) => !value);

  await main.evaluate(`window.__beishuTest.startPreflightTest()`);
  await waitForEvaluation(
    main,
    `window.__beishuTest.getSnapshot()`,
    (value) => value.preflightTesting && value.microphoneOpen,
  );
  await main.evaluate(`(() => {
    window.__hiddenPreflightStream = window.__gumStreams.at(-1);
    document.querySelector('#window-close-button').click();
    return true;
  })()`);
  report.hiddenPreflight = await waitForEvaluation(
    main,
    `(async () => ({
      snapshot: window.__beishuTest.getSnapshot(),
      runtime: await window.desktopAPI.getRuntimeWindowState(),
      trackStates: window.__hiddenPreflightStream.getTracks().map((track) => track.readyState),
      hasTimer: Boolean(state.audioTimer),
      hasContext: Boolean(state.audioContext),
      hasAnalyser: Boolean(state.analyser)
    }))()`,
    (value) => value.runtime.mode === 'hidden'
      && !value.runtime.visible
      && !value.snapshot.preflightTesting
      && !value.snapshot.preflightStarting
      && !value.snapshot.preflightStopping,
  );
  assert(!report.hiddenPreflight.snapshot.microphoneOpen
    && report.hiddenPreflight.trackStates.every((value) => value === 'ended')
    && !report.hiddenPreflight.hasTimer
    && !report.hiddenPreflight.hasContext
    && !report.hiddenPreflight.hasAnalyser,
  `Hiding the window leaked preflight microphone state: ${JSON.stringify(report.hiddenPreflight)}`);
  await main.evaluate(`window.desktopAPI.restoreSceneMode()`);
  await waitForEvaluation(
    main,
    `(async () => await window.desktopAPI.getRuntimeWindowState())()`,
    (value) => value.mode === 'scene' && value.visible,
  );

  await main.evaluate(`window.__beishuTest.startPreflightTest()`);
  await waitForEvaluation(
    main,
    `window.__beishuTest.getSnapshot()`,
    (value) => value.preflightTesting && value.microphoneOpen,
  );
  await main.evaluate(`(() => {
    window.__minimizedPreflightStream = window.__gumStreams.at(-1);
    document.querySelector('#window-minimize-button').click();
    return true;
  })()`);
  report.minimizedPreflight = await waitForEvaluation(
    main,
    `(async () => ({
      snapshot: window.__beishuTest.getSnapshot(),
      runtime: await window.desktopAPI.getRuntimeWindowState(),
      trackStates: window.__minimizedPreflightStream.getTracks().map((track) => track.readyState),
      hasTimer: Boolean(state.audioTimer),
      hasContext: Boolean(state.audioContext),
      hasAnalyser: Boolean(state.analyser)
    }))()`,
    (value) => value.runtime.minimized
      && !value.snapshot.preflightTesting
      && !value.snapshot.preflightStarting
      && !value.snapshot.preflightStopping,
  );
  assert(!report.minimizedPreflight.snapshot.microphoneOpen
    && report.minimizedPreflight.trackStates.every((value) => value === 'ended')
    && !report.minimizedPreflight.hasTimer
    && !report.minimizedPreflight.hasContext
    && !report.minimizedPreflight.hasAnalyser,
  `Minimizing the window leaked preflight microphone state: ${JSON.stringify(report.minimizedPreflight)}`);
  await main.evaluate(`window.desktopAPI.restoreSceneMode()`);
  await waitForEvaluation(
    main,
    `(async () => await window.desktopAPI.getRuntimeWindowState())()`,
    (value) => value.mode === 'scene' && value.visible && !value.minimized,
  );

  report.voiceprint = await main.evaluate(`(async () => {
    const encoded = ${JSON.stringify(speakerFixtures)};
    const context = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
    const decode = async (base64) => {
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
      const buffer = await context.decodeAudioData(bytes.buffer);
      const mono = SpeakerAudio.mixToMono(buffer);
      return buffer.sampleRate === 16000
        ? mono
        : SpeakerAudio.resampleLinear(mono, buffer.sampleRate, 16000);
    };
    const decoded = {};
    for (const [name, value] of Object.entries(encoded)) decoded[name] = await decode(value);
    await window.desktopAPI.beginSpeakerEnrollment();
    const names = [...Object.keys(decoded), ...Object.keys(decoded), ...Object.keys(decoded)].slice(0, 8);
    for (const name of names) {
      await window.desktopAPI.addSpeakerEnrollmentSample({
        source: 'mic',
        samples: decoded[name],
        sampleRate: 16000,
      });
    }
    const profile = await window.desktopAPI.finishSpeakerEnrollment();
    await refreshSpeakerState();
    await context.close();
    return { profile, rendererProfile: state.speakerProfileExists };
  })()`);
  assert(report.voiceprint.profile.profileExists && report.voiceprint.rendererProfile,
    'Isolated recite test voiceprint registration failed');

  await main.evaluate(`(() => {
    document.querySelector('#recite-mode-button').click();
    return window.__beishuTest.startPreflightTest();
  })()`);
  await completePreflightCalibration(main);
  report.recitePreflightGrace = await main.evaluate(`(() => {
    state.vad.process = () => ${forcedVadResult};
    const alerts = state.alerts;
    const lives = state.lives;
    state.speakerVerificationPending = true;
    state.silentSince = Date.now() - violationLimitMs();
    pollMicrophone();
    const withinGrace = {
      snapshot: window.__beishuTest.getSnapshot(),
      status: document.querySelector('#preflight-test-status').textContent.trim(),
    };
    state.silentSince = Date.now() - violationLimitMs() - SPEAKER_DEADLINE_GRACE_MS - 50;
    pollMicrophone();
    const afterGrace = {
      snapshot: window.__beishuTest.getSnapshot(),
      status: document.querySelector('#preflight-test-status').textContent.trim(),
    };
    state.speakerVerificationPending = false;
    const duration = document.querySelector('#silence-limit-input');
    duration.value = '20';
    duration.dispatchEvent(new Event('input', { bubbles: true }));
    const afterSettingChange = {
      snapshot: window.__beishuTest.getSnapshot(),
      status: document.querySelector('#preflight-test-status').textContent.trim(),
      voiceStatus: document.querySelector('#voice-status').textContent.trim(),
      silentForMs: Date.now() - state.silentSince,
      persisted: JSON.parse(localStorage.getItem('red-watch-study-settings-v1')).reciteSilenceSeconds,
    };
    pollMicrophone();
    const afterNextPoll = {
      snapshot: window.__beishuTest.getSnapshot(),
      status: document.querySelector('#preflight-test-status').textContent.trim(),
    };
    return { alerts, lives, withinGrace, afterGrace, afterSettingChange, afterNextPoll };
  })()`);
  assert(!report.recitePreflightGrace.withinGrace.snapshot.preflightThresholdReached
    && report.recitePreflightGrace.withinGrace.status.includes('等待本次声纹确认')
    && report.recitePreflightGrace.afterGrace.snapshot.preflightThresholdReached
    && report.recitePreflightGrace.afterGrace.status === '按当前设置将触发提醒。'
    && report.recitePreflightGrace.afterGrace.snapshot.alerts === report.recitePreflightGrace.alerts
    && report.recitePreflightGrace.afterGrace.snapshot.lives === report.recitePreflightGrace.lives,
  `Recite preflight did not mirror the formal speaker-verification grace: ${JSON.stringify(report.recitePreflightGrace)}`);
  assert(!report.recitePreflightGrace.afterSettingChange.snapshot.preflightThresholdReached
    && report.recitePreflightGrace.afterSettingChange.snapshot.reciteSilenceSeconds === 20
    && report.recitePreflightGrace.afterSettingChange.status === '设置已更新，请继续测试。'
    && report.recitePreflightGrace.afterSettingChange.voiceStatus === '设置已更新，请继续测试'
    && report.recitePreflightGrace.afterSettingChange.silentForMs < 1_000
    && report.recitePreflightGrace.afterSettingChange.persisted === 20
    && !report.recitePreflightGrace.afterNextPoll.snapshot.preflightThresholdReached
    && report.recitePreflightGrace.afterNextPoll.status.includes('当前阈值 20 秒'),
  `Changing recite preflight settings preserved a stale warning: ${JSON.stringify(report.recitePreflightGrace)}`);
  await main.evaluate(`window.__beishuTest.stopPreflightTest()`);
  await waitForEvaluation(
    main,
    `window.__beishuTest.getSnapshot()`,
    (value) => !value.preflightTesting && !value.preflightStopping && !value.microphoneOpen,
  );

  await main.evaluate(`(() => {
    document.querySelector('#recite-mode-button').click();
    document.querySelector('#start-button').click();
    return true;
  })()`);
  await completeCalibration(main);
  report.reciteStarted = await main.evaluate(`window.__beishuTest.getSnapshot()`);
  assert(report.reciteStarted.active && report.reciteStarted.mode === 'recite'
    && report.reciteStarted.sessionPhase === 'studying', 'Recite session did not enter studying');

  report.milestoneBefore = await main.evaluate(`(() => {
    window.__beishuTest.setEffectiveElapsedMs(20 * 60 * 1000 - 1000);
    return window.__beishuTest.getSnapshot();
  })()`);
  assert(report.milestoneBefore.breakCredits === 0, 'Recite voucher was granted before 20 effective minutes');
  await main.evaluate(`window.__beishuTest.setEffectiveElapsedMs(20 * 60 * 1000)`);

  const promptTarget = await waitForTarget(
    debugPort,
    (target) => target.url === 'rwt://renderer/break-prompt.html',
    appProcess,
  );
  prompt = await connect(promptTarget.webSocketDebuggerUrl);
  report.promptBridge = await waitForEvaluation(
    prompt,
    `({
      hasBreakPrompt: Boolean(window.breakPrompt),
      hasDesktopAPI: Boolean(window.desktopAPI),
      hasDesktop: Boolean(window.desktop)
    })`,
    (value) => value.hasBreakPrompt,
  );
  assert(!report.promptBridge.hasDesktopAPI && !report.promptBridge.hasDesktop,
    `Break prompt received main renderer bridges: ${JSON.stringify(report.promptBridge)}`);
  report.earned = await waitForEvaluation(
    main,
    `(async () => ({
      snapshot: window.__beishuTest.getSnapshot(),
      runtime: await window.desktopAPI.getRuntimeWindowState(),
      breakText: document.querySelector('#break-button').textContent
    }))()`,
    (value) => value.snapshot.breakCredits === 1 && value.runtime.windowCount === 2,
  );
  const earnedPromptExpression = `(() => {
    const start = document.querySelector('#start-rest').getBoundingClientRect();
    const bank = document.querySelector('#bank-rest').getBoundingClientRect();
    const availLeft = Number.isFinite(screen.availLeft) ? screen.availLeft : 0;
    const availTop = Number.isFinite(screen.availTop) ? screen.availTop : 0;
    return {
      title: document.title,
      kind: document.body.dataset.kind,
      credits: document.querySelector('#credit-count').textContent,
      earnedVisible: !document.querySelector('#earned-view').hidden,
      restingHidden: document.querySelector('#resting-view').hidden,
      focused: document.hasFocus(),
      innerWidth,
      innerHeight,
      screenX,
      screenY,
      rightGap: availLeft + screen.availWidth - (screenX + outerWidth),
      bottomGap: availTop + screen.availHeight - (screenY + outerHeight),
      buttonOverlap: start.left < bank.right && start.right > bank.left
        && start.top < bank.bottom && start.bottom > bank.top,
    };
  })()`;
  try {
    report.earnedPrompt = await waitForEvaluation(
      prompt,
      earnedPromptExpression,
      (value) => value.kind === 'earned' && value.credits.includes('1'),
      3_000,
    );
  } catch {
    report.failures.push('Earned break prompt did not receive its initial credits state after loading.');
    await main.evaluate(`window.desktop.updateBreakPrompt({ kind: 'earned', credits: 1, remainingSeconds: 0 })`);
    report.earnedPrompt = await waitForEvaluation(
      prompt,
      earnedPromptExpression,
      (value) => value.kind === 'earned' && value.credits.includes('1'),
      10_000,
    );
  }
  assert(report.earned.runtime.webContentsId === mainWebContentsId
    && report.earned.runtime.windowCount === 2, 'Break prompt replaced the main webContents or duplicated windows');
  assert(report.earnedPrompt.kind === 'earned' && report.earnedPrompt.earnedVisible
    && report.earnedPrompt.restingHidden && report.earnedPrompt.credits.includes('1'),
  `Earned prompt content is wrong: ${JSON.stringify(report.earnedPrompt)}`);
  assert(Math.abs(report.earnedPrompt.innerWidth - 420) <= 8
    && Math.abs(report.earnedPrompt.innerHeight - 220) <= 8,
    `Break prompt size is wrong: ${report.earnedPrompt.innerWidth}x${report.earnedPrompt.innerHeight}`);
  assert(report.earnedPrompt.rightGap >= 0 && report.earnedPrompt.rightGap <= 40
    && report.earnedPrompt.bottomGap >= 0 && report.earnedPrompt.bottomGap <= 40,
  `Break prompt is not in the lower-right corner: ${JSON.stringify(report.earnedPrompt)}`);
  assert(!report.earnedPrompt.buttonOverlap, 'Break prompt buttons overlap');
  assert((await targetList(debugPort)).filter((target) => target.url === 'rwt://renderer/break-prompt.html').length === 1,
    'More than one break prompt renderer exists');

  await main.evaluate(`(() => {
    window.__bankCompleted = false;
    window.__bankOriginal = bankBreakPrompt;
    bankBreakPrompt = async (...args) => {
      const result = await window.__bankOriginal(...args);
      window.__bankCompleted = true;
      return result;
    };
    return true;
  })()`);
  await prompt.evaluate(`document.querySelector('#bank-rest').click()`);
  report.banked = await waitForEvaluation(
    main,
    `({
      completed: window.__bankCompleted === true,
      snapshot: window.__beishuTest.getSnapshot(),
      breakText: document.querySelector('#break-button').textContent
    })`,
    (value) => value.completed,
  );
  await main.evaluate(`bankBreakPrompt = window.__bankOriginal`);
  report.bankedPrompt = await prompt.evaluate(`({
    documentHidden: document.hidden,
    visibilityState: document.visibilityState,
    startDisabled: document.querySelector('#start-rest').disabled,
    bankDisabled: document.querySelector('#bank-rest').disabled
  })`);
  assert(report.banked.snapshot.breakCredits === 1 && report.banked.breakText.includes('1'),
    'Banking the prompt consumed the voucher');
  assert(report.bankedPrompt.startDisabled && report.bankedPrompt.bankDisabled,
    'Bank action did not complete its renderer round trip');
  if (!report.bankedPrompt.documentHidden) {
    report.coverageGaps.push(
      'BrowserWindow uses backgroundThrottling=false, so Page Visibility cannot prove the banked prompt is hidden; the test verifies the bank handler and hide IPC completed.',
    );
  }

  await main.evaluate(`(() => {
    window.__restOriginalStartBreak = startBreak;
    startBreak = () => window.__restOriginalStartBreak(5_000);
    window.__beishuTest.clearTrace();
    document.querySelector('#break-button').click();
    return true;
  })()`);
  report.resting = await waitForEvaluation(
    main,
    `(async () => ({
      snapshot: window.__beishuTest.getSnapshot(),
      runtime: await window.desktopAPI.getRuntimeWindowState()
    }))()`,
    (value) => value.snapshot.sessionPhase === 'resting'
      && value.runtime.mode === 'hidden'
      && !value.runtime.visible,
  );
  report.restingPrompt = await waitForEvaluation(
    prompt,
    `({
      kind: document.body.dataset.kind,
      earnedHidden: document.querySelector('#earned-view').hidden,
      restingVisible: !document.querySelector('#resting-view').hidden,
      countdown: document.querySelector('#rest-countdown').textContent
    })`,
    (value) => value.kind === 'resting' && value.restingVisible,
  );
  await main.evaluate(`startBreak = window.__restOriginalStartBreak`);
  assert(report.resting.snapshot.breakCredits === 0 && report.resting.runtime.webContentsId === mainWebContentsId
    && report.resting.runtime.windowCount === 2, 'Main break button did not enter isolated rest correctly');
  assert(report.restingPrompt.earnedHidden && /^00:0[1-5]$/.test(report.restingPrompt.countdown),
    `Rest countdown is wrong: ${JSON.stringify(report.restingPrompt)}`);

  const frozenBefore = await main.evaluate(`window.__beishuTest.getSnapshot().effectiveElapsedMs`);
  await wait(400);
  const frozenAfter = await main.evaluate(`window.__beishuTest.getSnapshot().effectiveElapsedMs`);
  report.frozenClock = { before: frozenBefore, after: frozenAfter, delta: frozenAfter - frozenBefore };
  assert(report.frozenClock.delta === 0, `Effective study time advanced during rest: ${JSON.stringify(report.frozenClock)}`);

  await main.evaluate(`window.__beishuTest.clearTrace(); window.__beishuTest.completeBreak()`);
  await waitForEvaluation(
    main,
    `({ phase: state.sessionPhase, calibrating: state.calibrating, vad: Boolean(state.vad) })`,
    (value) => value.phase === 'resuming' && value.calibrating && value.vad,
  );
  await main.evaluate(`(() => {
    state.vad.process = () => ${forcedVadResult};
    pollMicrophone();
    return true;
  })()`);
  report.resumed = await waitForEvaluation(
    main,
    `(async () => ({
      snapshot: window.__beishuTest.getSnapshot(),
      runtime: await window.desktopAPI.getRuntimeWindowState(),
      vadState: document.body.dataset.vadState,
      silenceArmed: state.silenceArmed,
      hasStream: Boolean(state.audioStream),
      hasAudioTimer: Boolean(state.audioTimer)
    }))()`,
    (value) => value.snapshot.sessionPhase === 'studying'
      && value.vadState === 'ready'
      && value.runtime.mode === 'scene'
      && value.runtime.visible,
  );
  assertArray(ids(report.resumed.snapshot.trace), ['E1_enter_walk', 'S1_intro_speech', 'X1_exit'],
    'Rest completion did not play exactly one E1 -> S1 -> X1 sequence');
  assertArray(
    report.resumed.snapshot.audioTrace.map((item) => item.audioClipId),
    ['E1_enter_walk', 'S1_intro_speech', 'X1_exit'],
    'Rest completion sequence was not fully sourced-audio playback',
  );
  assert(report.resumed.runtime.webContentsId === mainWebContentsId
    && report.resumed.runtime.windowCount === 2
    && report.resumed.runtime.mode === 'scene'
    && report.resumed.runtime.visible, 'Main window did not return to the foreground after rest');
  assert(report.resumed.snapshot.active && report.resumed.silenceArmed
    && report.resumed.hasStream && report.resumed.hasAudioTimer,
  'Detection did not resume after the rest intro');

  await main.evaluate(`window.__beishuTest.setEffectiveElapsedMs(2_400_000)`);
  await waitForEvaluation(
    main,
    `window.__beishuTest.getSnapshot()`,
    (value) => value.breakCredits === 1,
  );
  await main.evaluate(`window.__beishuTest.startBreak(3_000)`);
  await waitForEvaluation(
    main,
    `window.__beishuTest.getSnapshot()`,
    (value) => value.sessionPhase === 'resting',
  );
  await main.evaluate(`window.__beishuTest.completeBreak()`);
  await waitForEvaluation(
    main,
    `window.__beishuTest.getSnapshot()`,
    (value) => value.sessionPhase === 'resuming' && value.eventBusy,
  );
  await main.evaluate(`window.__resumeStopPromise = stopSession(false)`);
  report.stopDuringResume = await waitForEvaluation(
    main,
    `(() => ({
      snapshot: window.__beishuTest.getSnapshot(),
      sceneRunning: state.sceneRunning,
      clockRunning: state.studyClock.running,
      hasStream: Boolean(state.audioStream),
      startEnabled: !document.querySelector('#start-button').disabled
    }))()`,
    (value) => value.snapshot.sessionPhase === 'idle'
      && !value.snapshot.active
      && !value.snapshot.eventBusy
      && !value.sceneRunning,
  );
  const stoppedElapsed = report.stopDuringResume.snapshot.effectiveElapsedMs;
  await wait(300);
  const stoppedElapsedLater = await main.evaluate(`window.__beishuTest.getSnapshot().effectiveElapsedMs`);
  report.stopDuringResume.elapsedDeltaAfterStop = stoppedElapsedLater - stoppedElapsed;
  assert(!report.stopDuringResume.clockRunning && !report.stopDuringResume.hasStream
    && report.stopDuringResume.startEnabled && report.stopDuringResume.elapsedDeltaAfterStop === 0,
  `Stopping during the resume intro leaked state: ${JSON.stringify(report.stopDuringResume)}`);

  await main.evaluate(`(() => {
    document.querySelector('#study-mode-button').click();
    document.querySelector('#start-button').click();
    return true;
  })()`);
  await completeCalibration(main);
  await main.evaluate(`(() => {
    window.__sessionFailurePromise = window.__beishuTest.runScheduledPlan({
      kind: 'patrol',
      clips: ['__missing_test_clip__'],
      fatal: false,
    }).catch(handleSessionFlowError);
    return true;
  })()`);
  report.failedMediaCleanup = await waitForEvaluation(
    main,
    `(async () => ({
      snapshot: window.__beishuTest.getSnapshot(),
      clockRunning: state.studyClock.running,
      hasStream: Boolean(state.audioStream),
      hasAudioTimer: Boolean(state.audioTimer),
      presentation: Boolean(state.presentation),
      alertMode: document.body.classList.contains('alert-mode'),
      overlayHidden: document.querySelector('#inline-alert').hidden,
      sceneStatus: document.querySelector('#study-scene-status').textContent,
      runtime: await window.desktopAPI.getRuntimeWindowState()
    }))()`,
    (value) => value.snapshot.sessionPhase === 'idle'
      && !value.snapshot.active
      && !value.snapshot.eventBusy,
  );
  assert(!report.failedMediaCleanup.clockRunning
    && !report.failedMediaCleanup.hasStream
    && !report.failedMediaCleanup.hasAudioTimer
    && !report.failedMediaCleanup.presentation
    && !report.failedMediaCleanup.alertMode
    && report.failedMediaCleanup.overlayHidden
    && report.failedMediaCleanup.runtime.mode === 'scene'
    && report.failedMediaCleanup.runtime.visible
    && report.failedMediaCleanup.sceneStatus.includes('学习已安全停止'),
  `Failed media cleanup left stale session state: ${JSON.stringify(report.failedMediaCleanup)}`);

  await main.evaluate(`(() => {
    document.querySelector('#study-mode-button').click();
    document.querySelector('#start-button').click();
    return true;
  })()`);
  await completeCalibration(main);
  await main.evaluate(`(() => {
    window.__stoppingFailurePromise = window.__beishuTest.runScheduledPlan({
      kind: 'patrol',
      clips: ['__missing_race_test_clip__'],
      fatal: false,
    }).catch(handleSessionFlowError);
    window.__stoppingFailureStop = stopSession(false);
    return true;
  })()`);
  report.stopFailureRace = await waitForEvaluation(
    main,
    `(() => ({
      snapshot: window.__beishuTest.getSnapshot(),
      clockRunning: state.studyClock.running,
      hasStream: Boolean(state.audioStream),
      hasAudioTimer: Boolean(state.audioTimer),
      sceneRunning: state.sceneRunning,
      failureCleanupPending: state.sessionFailureCleanupPending,
      alertMode: document.body.classList.contains('alert-mode'),
      overlayHidden: document.querySelector('#inline-alert').hidden
    }))()`,
    (value) => value.snapshot.sessionPhase === 'idle'
      && !value.snapshot.eventBusy
      && !value.failureCleanupPending,
  );
  assert(!report.stopFailureRace.snapshot.active
    && !report.stopFailureRace.clockRunning
    && !report.stopFailureRace.hasStream
    && !report.stopFailureRace.hasAudioTimer
    && !report.stopFailureRace.sceneRunning
    && !report.stopFailureRace.alertMode
    && report.stopFailureRace.overlayHidden,
  `Stop/media-failure race deadlocked or leaked state: ${JSON.stringify(report.stopFailureRace)}`);

  if (report.failures.length) {
    console.error(JSON.stringify(report));
    throw new Error(`Mode/rest UI adversarial failures:\n- ${report.failures.join('\n- ')}`);
  }
  console.log(JSON.stringify(report));
} catch (error) {
  if (childOutput) error.message = `${error.message}\nSource instance output:\n${childOutput}`;
  throw error;
} finally {
  if (main) {
    await main.evaluate(`(async () => {
      await stopSession(false, true).catch(() => {});
      await window.desktop.hideBreakPrompt().catch(() => {});
      await window.desktopAPI.deleteSpeakerProfile().catch(() => {});
      await refreshSpeakerState().catch(() => {});
      localStorage.removeItem('red-watch-study-settings-v1');
      await Promise.all((window.__testAudioContexts || []).map((context) => context.close().catch(() => {})));
      setTimeout(() => window.desktopAPI.quitApp(), 50);
      return true;
    })()`).catch(() => {});
  }
  await waitForProcessExit(appProcess).catch(async () => {
    appProcess.kill();
    await waitForProcessExit(appProcess, 5_000).catch(() => {});
  });
  prompt?.close();
  main?.close();
  await removeIsolatedRoot(isolatedRoot);
}
