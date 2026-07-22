import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const port = Number(process.argv[2]);
if (!port) throw new Error('Usage: node adversarial-ui-test.mjs <remote-debugging-port>');

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const speakerFixtures = Object.fromEntries([
  'fangjun-sr-1.wav',
  'fangjun-sr-2.wav',
  'fangjun-sr-3.wav',
].map((name) => [
  name,
  fs.readFileSync(path.join(projectRoot, 'work', 'speaker-fixtures', name)).toString('base64'),
]));

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function targets() {
  const response = await fetch(`http://127.0.0.1:${port}/json`);
  return response.json();
}

async function waitForTarget(predicate, timeout = 45_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const target = (await targets()).find(predicate);
      if (target) return target;
    } catch {}
    await wait(250);
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
        close: () => socket.close(),
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

async function waitForEvaluation(client, expression, predicate, timeout = 90_000, interval = 100) {
  const deadline = Date.now() + timeout;
  let lastValue;
  while (Date.now() < deadline) {
    lastValue = await client.evaluate(expression);
    if (predicate(lastValue)) return lastValue;
    await wait(interval);
  }
  throw new Error(`Timed out waiting for expression: ${expression}\nLast value: ${JSON.stringify(lastValue)}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function ids(trace) {
  return trace.map((item) => item.clipId);
}

function assertArray(actual, expected, message) {
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${message}: ${JSON.stringify(actual)}`);
}

async function dispatchElementClick(client, selector) {
  const point = await client.evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const hit = document.elementFromPoint(x, y);
    return {
      x,
      y,
      inViewport: rect.width > 0 && rect.height > 0
        && rect.left >= 0 && rect.top >= 0
        && rect.right <= innerWidth && rect.bottom <= innerHeight,
      hit: Boolean(hit && element.contains(hit)),
    };
  })()`);
  assert(point?.inViewport && point.hit, `Cannot click visible element ${selector}: ${JSON.stringify(point)}`);
  await client.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: point.x,
    y: point.y,
    button: 'left',
    buttons: 1,
    clickCount: 1,
  });
  await client.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: point.x,
    y: point.y,
    button: 'left',
    buttons: 0,
    clickCount: 1,
  });
}

async function dispatchElementDoubleClick(client, selector) {
  const point = await client.evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const hit = document.elementFromPoint(x, y);
    return {
      x,
      y,
      inViewport: rect.width > 0 && rect.height > 0
        && rect.left >= 0 && rect.top >= 0
        && rect.right <= innerWidth && rect.bottom <= innerHeight,
      hit: Boolean(hit && element.contains(hit)),
    };
  })()`);
  assert(point?.inViewport && point.hit, `Cannot double-click visible element ${selector}: ${JSON.stringify(point)}`);
  for (const clickCount of [1, 2]) {
    await client.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: point.x,
      y: point.y,
      button: 'left',
      buttons: 1,
      clickCount,
    });
    await client.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: point.x,
      y: point.y,
      button: 'left',
      buttons: 0,
      clickCount,
    });
  }
}

const visibleButtonOverlapExpression = `(() => {
  const rectangles = [...document.querySelectorAll('button')]
    .filter((button) => {
      const style = getComputedStyle(button);
      const rect = button.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    })
    .map((button) => button.getBoundingClientRect());
  return rectangles.some((first, firstIndex) => rectangles.slice(firstIndex + 1).some((second) => (
    first.left < second.right && first.right > second.left && first.top < second.bottom && first.bottom > second.top
  )));
})()`;

const report = {};
const mainTarget = await waitForTarget((target) => target.url === 'rwt://renderer/index.html');
const main = await connect(mainTarget.webSocketDebuggerUrl);
await waitForEvaluation(main, `Boolean(window.desktopAPI?.restoreSceneMode)`, Boolean);
await main.evaluate(`window.desktopAPI.restoreSceneMode()`);

try {
  console.error('[adversarial] initial scene, clean controls, and main-window identity');
  const readyState = await waitForEvaluation(
    main,
    `(async () => ({
      ready: typeof startSession === 'function' && Boolean(window.__beishuTest),
      startEnabled: !document.querySelector('#start-button')?.disabled,
      sceneReady: document.querySelector('#study-scene-canvas')?.dataset.animationReady === 'true',
      runtime: await window.desktopAPI.getRuntimeWindowState()
    }))()`,
    (value) => value.ready && value.startEnabled && value.sceneReady && value.runtime.visible,
  );
  const mainWebContentsId = readyState.runtime.webContentsId;
  const assertMainWindowIdentity = (runtime, label) => {
    assert(runtime.webContentsId === mainWebContentsId && runtime.windowCount === 1,
      `${label} replaced the main window: ${JSON.stringify(runtime)}`);
  };

  console.error('[adversarial] frameless titlebar layout and native window controls');
  report.windowChrome = await main.evaluate(`(async () => {
    const titlebar = document.querySelector('#window-titlebar');
    const controls = document.querySelector('.window-controls');
    const canvas = document.querySelector('#study-scene-canvas');
    const titlebarRect = titlebar?.getBoundingClientRect();
    const canvasRect = canvas?.getBoundingClientRect();
    const buttonElements = titlebar ? [...titlebar.querySelectorAll('.window-control')] : [];
    const styleRegion = (element) => {
      if (!element) return '';
      const style = getComputedStyle(element);
      return style.getPropertyValue('-webkit-app-region') || style.webkitAppRegion || '';
    };
    return {
      titlebarExists: Boolean(titlebar),
      titlebarPosition: titlebar ? getComputedStyle(titlebar).position : '',
      dragRegion: styleRegion(titlebar),
      noDragRegion: styleRegion(controls),
      titlebarInViewport: Boolean(titlebarRect
        && titlebarRect.width > 0 && titlebarRect.height > 0
        && titlebarRect.left >= 0 && titlebarRect.top >= 0
        && titlebarRect.right <= innerWidth && titlebarRect.bottom <= innerHeight),
      controls: buttonElements.map((button) => {
        const rect = button.getBoundingClientRect();
        const style = getComputedStyle(button);
        return {
          id: button.id,
          label: button.getAttribute('aria-label'),
          visible: style.display !== 'none' && style.visibility !== 'hidden'
            && rect.width > 0 && rect.height > 0,
          inViewport: rect.left >= 0 && rect.top >= 0
            && rect.right <= innerWidth && rect.bottom <= innerHeight,
        };
      }),
      canvasWidth: canvasRect?.width || 0,
      canvasHeight: canvasRect?.height || 0,
      canvasAspectRatio: canvasRect && canvasRect.height > 0 ? canvasRect.width / canvasRect.height : 0,
      runtime: await window.desktopAPI.getRuntimeWindowState(),
    };
  })()`);
  assert(report.windowChrome.titlebarExists
    && report.windowChrome.titlebarPosition === 'fixed'
    && report.windowChrome.titlebarInViewport,
  `Custom frameless titlebar is missing or outside the viewport: ${JSON.stringify(report.windowChrome)}`);
  assert(report.windowChrome.dragRegion.includes('drag')
    && report.windowChrome.noDragRegion.includes('no-drag'),
  `Titlebar drag/no-drag regions are wrong: ${JSON.stringify(report.windowChrome)}`);
  assertArray(
    report.windowChrome.controls.map((control) => control.id),
    ['window-minimize-button', 'window-maximize-button', 'window-close-button'],
    'Window controls are missing or out of order',
  );
  assert(report.windowChrome.controls.every((control) => control.visible && control.inViewport),
    `Window controls are hidden or outside the viewport: ${JSON.stringify(report.windowChrome.controls)}`);
  assert(report.windowChrome.canvasWidth > 0 && report.windowChrome.canvasHeight > 0
    && Math.abs(report.windowChrome.canvasAspectRatio - (16 / 9)) < 0.001,
  `Scene canvas is not 16:9: ${JSON.stringify(report.windowChrome)}`);
  assertMainWindowIdentity(report.windowChrome.runtime, 'Initial custom chrome');

  await dispatchElementClick(main, '#window-maximize-button');
  report.windowChrome.maximized = await waitForEvaluation(
    main,
    `(async () => ({
      runtime: await window.desktopAPI.getRuntimeWindowState(),
      label: document.querySelector('#window-maximize-button')?.getAttribute('aria-label'),
      dataMaximized: document.querySelector('#window-maximize-button')?.dataset.maximized
    }))()`,
    (value) => value.runtime.maximized === true && value.dataMaximized === 'true',
  );
  assert(report.windowChrome.maximized.label === '还原窗口',
    `Maximize button did not become Restore: ${JSON.stringify(report.windowChrome.maximized)}`);
  assertMainWindowIdentity(report.windowChrome.maximized.runtime, 'Maximize button');

  await dispatchElementClick(main, '#window-maximize-button');
  report.windowChrome.restored = await waitForEvaluation(
    main,
    `window.desktopAPI.getRuntimeWindowState()`,
    (value) => value.visible === true && value.maximized === false,
  );
  assertMainWindowIdentity(report.windowChrome.restored, 'Restore button');

  await dispatchElementDoubleClick(main, '.window-title');
  report.windowChrome.doubleClickMaximized = await waitForEvaluation(
    main,
    `window.desktopAPI.getRuntimeWindowState()`,
    (value) => value.maximized === true,
  );
  assertMainWindowIdentity(report.windowChrome.doubleClickMaximized, 'Titlebar double-click maximize');
  await dispatchElementDoubleClick(main, '.window-title');
  report.windowChrome.doubleClickRestored = await waitForEvaluation(
    main,
    `window.desktopAPI.getRuntimeWindowState()`,
    (value) => value.visible === true && value.maximized === false,
  );
  assertMainWindowIdentity(report.windowChrome.doubleClickRestored, 'Titlebar double-click restore');

  await dispatchElementClick(main, '#window-minimize-button');
  report.windowChrome.minimized = await waitForEvaluation(
    main,
    `window.desktopAPI.getRuntimeWindowState()`,
    (value) => value.minimized === true,
  );
  assertMainWindowIdentity(report.windowChrome.minimized, 'Minimize button');
  await main.evaluate(`window.desktopAPI.restoreSceneMode()`);
  report.windowChrome.restoredAfterMinimize = await waitForEvaluation(
    main,
    `window.desktopAPI.getRuntimeWindowState()`,
    (value) => value.mode === 'scene' && value.visible === true && value.minimized === false,
  );
  assertMainWindowIdentity(report.windowChrome.restoredAfterMinimize, 'Restore after minimize');

  await dispatchElementClick(main, '#window-close-button');
  report.windowChrome.hiddenByClose = await waitForEvaluation(
    main,
    `window.desktopAPI.getRuntimeWindowState()`,
    (value) => value.mode === 'hidden' && value.visible === false,
  );
  assertMainWindowIdentity(report.windowChrome.hiddenByClose, 'Close-to-background button');
  const hiddenTarget = (await targets()).find((target) => target.url === 'rwt://renderer/index.html');
  assert(hiddenTarget?.id === mainTarget.id,
    `Close-to-background replaced the DevTools target: ${JSON.stringify({ before: mainTarget.id, after: hiddenTarget?.id })}`);
  await main.evaluate(`window.desktopAPI.restoreSceneMode()`);
  report.windowChrome.restoredAfterClose = await waitForEvaluation(
    main,
    `window.desktopAPI.getRuntimeWindowState()`,
    (value) => value.mode === 'scene' && value.visible === true && value.minimized === false,
  );
  assertMainWindowIdentity(report.windowChrome.restoredAfterClose, 'Restore after close-to-background');

  report.initial = await main.evaluate(`(async () => ({
    title: document.title,
    session: document.querySelector('#session-state').textContent,
    startText: document.querySelector('#start-button').textContent,
    timer: document.querySelector('#timer').textContent,
    clip: document.querySelector('#study-scene-canvas').dataset.clipId,
    frame: document.querySelector('#study-scene-canvas').dataset.frameIndex,
    playback: document.querySelector('#study-scene-canvas').dataset.playbackState,
    alertHidden: document.querySelector('#inline-alert').hidden,
    videoElements: document.querySelectorAll('video').length,
    buttonOverlap: ${visibleButtonOverlapExpression},
    physicalWidth: Math.round(document.querySelector('#study-scene-canvas').getBoundingClientRect().width * devicePixelRatio),
    physicalHeight: Math.round(document.querySelector('#study-scene-canvas').getBoundingClientRect().height * devicePixelRatio),
    runtime: await window.desktopAPI.getRuntimeWindowState()
  }))()`);
  console.error('[adversarial] initial report', JSON.stringify(report.initial));
  assert(report.initial.session === '待命' && report.initial.startText === '开始学习', 'App does not open at 开始学习');
  assert(report.initial.title === '凛冬督学局', 'Product title was not renamed');
  assert(report.initial.timer === '00:00', 'Initial timer is not zero');
  assert(report.initial.clip === 'E1_enter_walk' && report.initial.frame === '0' && report.initial.playback === 'held', 'Initial empty-room frame is wrong');
  assert(report.initial.alertHidden, 'Reminder is visible before Start');
  assert(report.initial.videoElements === 0, 'Camera/video element exists');
  assert(!report.initial.buttonOverlap, 'Initial buttons overlap');
  assert(report.initial.runtime.windowCount === 1, 'App did not create exactly one BrowserWindow');
  assert(report.initial.physicalWidth === 1920 && report.initial.physicalHeight === 1080, 'Scene is not rendered at 1920x1080 physical pixels');

  report.library = await waitForEvaluation(
    main,
    `({ catalog: state.mediaCatalog.length, options: document.querySelector('#clip-select').options.length })`,
    (value) => value.catalog === 22 && value.options === 22,
  );

  console.error('[adversarial] X6 remains in the complete library but not in runtime exit pool');
  await main.evaluate(`(() => {
    window.__beishuTest.setPlaybackRate(10);
    document.querySelector('#clip-select').value = 'X6_exit_abrupt';
    document.querySelector('#preview-clip-button').click();
    return true;
  })()`);
  report.preview = await waitForEvaluation(
    main,
    `(async () => ({
      clip: document.querySelector('#study-scene-canvas').dataset.clipId,
      audio: document.body.dataset.audioClipId,
      overlay: !document.querySelector('#inline-alert').hidden,
      runtime: await window.desktopAPI.getRuntimeWindowState()
    }))()`,
    (value) => value.clip === 'X6_exit_abrupt' && value.audio === 'X6_exit_abrupt',
  );
  assert(report.preview.overlay && report.preview.runtime.windowCount === 1, 'Preview did not stay in the main window');
  await main.evaluate(`document.querySelector('#inline-alert-dismiss').click()`);
  await waitForEvaluation(
    main,
    `({ presentation: state.presentation, clip: document.querySelector('#study-scene-canvas').dataset.clipId, startEnabled: !document.querySelector('#start-button').disabled })`,
    (value) => value.presentation === null && value.clip === 'E1_enter_walk' && value.startEnabled,
  );

  console.error('[adversarial] install black-frame, clear, resize, and transition probes');
  await main.evaluate(`(() => {
    const canvas = document.querySelector('#study-scene-canvas');
    const probe = document.createElement('canvas');
    probe.width = 32; probe.height = 18;
    const probeContext = probe.getContext('2d', { willReadFrequently: true });
    const sample = () => {
      probeContext.drawImage(canvas, 0, 0, probe.width, probe.height);
      const pixels = probeContext.getImageData(0, 0, probe.width, probe.height).data;
      let total = 0;
      for (let index = 0; index < pixels.length; index += 4) total += (pixels[index] + pixels[index + 1] + pixels[index + 2]) / 3;
      const mean = total / (pixels.length / 4);
      window.__frameQuality.samples += 1;
      window.__frameQuality.minMean = Math.min(window.__frameQuality.minMean, mean);
      if (mean < 15) window.__frameQuality.blank += 1;
      return mean;
    };
    window.__frameQuality = { samples: 0, blank: 0, minMean: 255, seamMeans: [], resizeMutations: 0, clearCalls: 0 };
    window.__originalClearRect = CanvasRenderingContext2D.prototype.clearRect;
    CanvasRenderingContext2D.prototype.clearRect = function (...args) {
      if (this.canvas === canvas) window.__frameQuality.clearCalls += 1;
      return window.__originalClearRect.apply(this, args);
    };
    window.__canvasObserver = new MutationObserver((records) => {
      for (const record of records) {
        if (record.attributeName === 'width' || record.attributeName === 'height') window.__frameQuality.resizeMutations += 1;
        if (record.attributeName === 'data-clip-id') window.__frameQuality.seamMeans.push({ clip: canvas.dataset.clipId, mean: sample() });
      }
    });
    window.__canvasObserver.observe(canvas, { attributes: true });
    window.__frameSampler = setInterval(sample, 16);
    return true;
  })()`);

  console.error('[adversarial] register an encrypted local speaker profile for runtime tests');
  report.speakerProfile = await main.evaluate(`(async () => {
    await window.desktopAPI.deleteSpeakerProfile().catch(() => {});
    const encoded = ${JSON.stringify(speakerFixtures)};
    const context = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
    const decode = async (base64) => {
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
      const buffer = await context.decodeAudioData(bytes.buffer);
      const mono = SpeakerAudio.mixToMono(buffer);
      return buffer.sampleRate === 16000 ? mono : SpeakerAudio.resampleLinear(mono, buffer.sampleRate, 16000);
    };
    await window.desktopAPI.beginSpeakerEnrollment();
    const names = [...Object.keys(encoded), ...Object.keys(encoded), ...Object.keys(encoded)].slice(0, 8);
    for (let index = 0; index < names.length; index += 1) {
      const samples = await decode(encoded[names[index]]);
      await window.desktopAPI.addSpeakerEnrollmentSample({
        source: 'mic',
        samples,
        sampleRate: 16000,
      });
    }
    const profile = await window.desktopAPI.finishSpeakerEnrollment();
    await refreshSpeakerState();
    await context.close();
    return { profile, rendererProfile: state.speakerProfileExists };
  })()`);
  assert(report.speakerProfile.profile.profileExists && report.speakerProfile.rendererProfile, 'Speaker profile registration failed');

  console.error('[adversarial] audio-only start and exact E1 -> S1 -> X1 opening');
  await main.evaluate(`(() => {
    window.__gumCalls = [];
    window.__testAudioContexts = [];
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      configurable: true,
      value: async (constraints) => {
        window.__gumCalls.push(JSON.parse(JSON.stringify(constraints)));
        const context = new (window.AudioContext || window.webkitAudioContext)();
        const destination = context.createMediaStreamDestination();
        window.__testAudioContexts.push(context);
        return destination.stream;
      }
    });
    document.querySelector('#start-button').click();
    return true;
  })()`);
  report.opening = await waitForEvaluation(
    main,
    `(() => {
      const snapshot = window.__beishuTest.getSnapshot();
      return {
        ...snapshot,
        constraints: window.__gumCalls[0],
        audioTracks: state.audioStream?.getAudioTracks().length || 0,
        videoTracks: state.audioStream?.getVideoTracks().length || 0,
        vadState: document.body.dataset.vadState,
        session: document.querySelector('#session-state').textContent,
        videoElements: document.querySelectorAll('video').length
      };
    })()`,
    (value) => value.active && value.introComplete && !value.eventBusy && value.vadState === 'ready',
  );
  assert(report.opening.constraints?.video === false && Boolean(report.opening.constraints?.audio), 'getUserMedia is not audio-only');
  assert(report.opening.audioTracks === 1 && report.opening.videoTracks === 0 && report.opening.videoElements === 0, 'Video/camera path is still active');
  assertArray(ids(report.opening.trace), ['E1_enter_walk', 'S1_intro_speech', 'X1_exit'], 'Opening order is wrong');
  assertArray(report.opening.audioTrace.map((item) => item.audioClipId), ids(report.opening.trace), 'Opening source audio is not one-to-one');

  console.error('[adversarial] forced ordinary patrol grammar');
  await main.evaluate(`window.__beishuTest.clearTrace()`);
  await main.evaluate(`window.__beishuTest.runScheduledPlan({
    kind: 'patrol',
    clips: ['E4_enter_prowl', 'R_close_check', 'X4_exit_sideglance'],
    entry: 'E4_enter_prowl', reaction: 'R_close_check', exit: 'X4_exit_sideglance', fatal: false
  })`);
  report.patrol = await main.evaluate(`({
    snapshot: window.__beishuTest.getSnapshot(),
    audioDataset: document.body.dataset.audioClipId || null
  })`);
  assertArray(ids(report.patrol.snapshot.trace), ['E4_enter_prowl', 'R_close_check', 'X4_exit_sideglance'], 'Ordinary patrol is not entry -> normal -> exit');
  assertArray(report.patrol.snapshot.audioTrace, [], 'Ordinary patrol must be silent');
  assert(report.patrol.audioDataset === null, 'Ordinary patrol retained a stale audio clip id');

  console.error('[adversarial] 45-minute recitation praise has source audio and a lower-right non-obscuring caption');
  await main.evaluate(`(() => {
    window.__beishuTest.clearTrace();
    window.__hourlyPlanPromise = window.__beishuTest.runScheduledPlan({
      kind: 'milestonePraise',
      clips: ['E1_enter_walk', 'R_pass_react_salute', 'X1_exit'],
      entry: 'E1_enter_walk', reaction: 'R_pass_react_salute', exit: 'X1_exit',
      milestonePraise: true, praiseMark: 1, fatal: false
    });
    return true;
  })()`);
  report.hourlyCaption = await waitForEvaluation(
    main,
    `(() => {
      const caption = document.querySelector('#praise-caption');
      const rect = caption.getBoundingClientRect();
      return {
        visible: !caption.hidden,
        text: caption.textContent,
        clip: document.querySelector('#study-scene-canvas').dataset.clipId,
        audio: document.body.dataset.audioClipId,
        rightSide: rect.left > innerWidth * .5,
        lowerSide: rect.top > innerHeight * .65,
        shellHidden: getComputedStyle(document.querySelector('.shell')).visibility === 'hidden'
      };
    })()`,
    (value) => value.visible
      && value.clip === 'R_pass_react_salute'
      && value.audio === 'R_pass_react_salute',
    30_000,
    30,
  );
  assert(report.hourlyCaption.text === '已背书满 45 分钟'
    && report.hourlyCaption.audio === 'R_pass_react_salute', 'Recitation praise caption or source audio is wrong');
  assert(report.hourlyCaption.rightSide && report.hourlyCaption.lowerSide
    && report.hourlyCaption.shellHidden, 'Hourly caption can obscure the instructor or controls');
  report.hourly = await main.evaluate(`(async () => {
    await window.__hourlyPlanPromise;
    return {
      snapshot: window.__beishuTest.getSnapshot(),
      captionHidden: document.querySelector('#praise-caption').hidden
    };
  })()`);
  assertArray(ids(report.hourly.snapshot.trace), ['E1_enter_walk', 'R_pass_react_salute', 'X1_exit'], 'Hourly praise sequence is wrong');
  assertArray(report.hourly.snapshot.audioTrace.map((item) => item.audioClipId), ids(report.hourly.snapshot.trace), 'Hourly praise source audio mismatch');
  assert(report.hourly.captionHidden, 'Hourly praise caption did not hide after playback');

  console.error('[adversarial] independent event is isolated and cannot reveal a hidden window');
  const beforeHide = await main.evaluate(`window.desktopAPI.getRuntimeWindowState()`);
  await main.evaluate(`document.querySelector('#background-button').click()`);
  await waitForEvaluation(main, `window.desktopAPI.getRuntimeWindowState()`, (value) => value.mode === 'hidden' && !value.visible);
  await main.evaluate(`window.__beishuTest.clearTrace()`);
  await main.evaluate(`window.__beishuTest.runScheduledPlan({
    kind: 'independent', clips: ['P_pass_corridor_blue'], event: 'P_pass_corridor_blue', fatal: false
  })`);
  report.independent = await main.evaluate(`(async () => ({
    snapshot: window.__beishuTest.getSnapshot(),
    runtime: await window.desktopAPI.getRuntimeWindowState()
  }))()`);
  assertArray(ids(report.independent.snapshot.trace), ['P_pass_corridor_blue'], 'Independent event was mixed into a patrol chain');
  assertArray(report.independent.snapshot.audioTrace, [], 'Independent event must be silent');
  assert(report.independent.runtime.mode === 'hidden' && !report.independent.runtime.visible, 'Independent event revealed the hidden window');
  assert(report.independent.runtime.webContentsId === beforeHide.webContentsId && report.independent.runtime.windowCount === 1, 'Independent event replaced the main window');

  console.error('[adversarial] exact 20-second boundary and first YELL escalation from hidden');
  await main.evaluate(`window.__beishuTest.clearTrace(); window.__beishuTest.setRandomValues([0, 0])`);
  report.boundary = await main.evaluate(`(() => {
    state.vad.process = () => ({
      calibrated: true, calibrationProgress: 1, isSpeech: false,
      levelDb: -70, levelPercent: 20, noiseFloorDb: -48, thresholdDb: -40,
      steadyNoise: true, speechScore: 0, voiceRatio: .5, flatness: .4, flux: .005
    });
    const realNow = Date.now;
    let now = 100000;
    Date.now = () => now;
    state.silenceArmed = true;
    state.silentSince = 80001;
    pollMicrophone();
    const early = state.alertOpen;
    now = 100001;
    pollMicrophone();
    const exact = state.alertOpen;
    window.__beishuTest.triggerSilenceViolation();
    window.__beishuTest.triggerSilenceViolation();
    Date.now = realNow;
    return { early, exact };
  })()`);
  assert(report.boundary.early === false && report.boundary.exact === true, '20-second silence boundary is wrong');
  report.firstReveal = await waitForEvaluation(
    main,
    `(async () => ({
      runtime: await window.desktopAPI.getRuntimeWindowState(),
      overlay: !document.querySelector('#inline-alert').hidden,
      bottomHidden: document.querySelector('.inline-alert-bottom').hidden,
      buttonOverlap: ${visibleButtonOverlapExpression},
      topPlacement: document.querySelector('.inline-alert-top').getBoundingClientRect().bottom < innerHeight * .38
    }))()`,
    (value) => value.runtime.mode === 'alert' && value.runtime.visible,
    30_000,
    30,
  );
  assert(report.firstReveal.runtime.webContentsId === beforeHide.webContentsId && report.firstReveal.runtime.windowCount === 1, 'Violation did not restore the same window');
  assert(report.firstReveal.overlay && report.firstReveal.bottomHidden && report.firstReveal.topPlacement, 'Violation overlay covers the animation or exposes irrelevant controls');
  assert(!report.firstReveal.buttonOverlap, 'Buttons overlap during violation');
  report.first = await waitForEvaluation(
    main,
    `(async () => ({ snapshot: window.__beishuTest.getSnapshot(), runtime: await window.desktopAPI.getRuntimeWindowState() }))()`,
    (value) => value.snapshot.alerts === 1 && !value.snapshot.alertOpen && !value.snapshot.eventBusy && value.runtime.mode === 'hidden',
  );
  assertArray(ids(report.first.snapshot.trace), ['E1_enter_walk', 'R1_react_yell', 'X1_exit'], 'First violation is not YELL with a nonfatal exit');
  assert(report.first.snapshot.lives === 2, 'First violation did not remove exactly one life');
  assertArray(report.first.snapshot.audioTrace.map((item) => item.audioClipId), ids(report.first.snapshot.trace), 'First violation audio mismatch');

  console.error('[adversarial] second GUN escalation');
  await main.evaluate(`window.desktopAPI.restoreSceneMode()`);
  await waitForEvaluation(main, `window.desktopAPI.getRuntimeWindowState()`, (value) => value.mode === 'scene' && value.visible);
  await main.evaluate(`window.__beishuTest.clearTrace(); window.__beishuTest.setRandomValues([0.3, 0.6]); window.__beishuTest.triggerSilenceViolation(); window.__beishuTest.triggerSilenceViolation()`);
  report.second = await waitForEvaluation(
    main,
    `window.__beishuTest.getSnapshot()`,
    (value) => value.alerts === 2 && !value.alertOpen && !value.eventBusy,
  );
  assertArray(ids(report.second.trace), ['E2_enter_sneak', 'R_aim_react_gun', 'X3_exit_backaway'], 'Second violation is not GUN with a nonfatal exit');
  assert(report.second.lives === 1, 'Second violation did not remove exactly one life');
  assertArray(report.second.audioTrace.map((item) => item.audioClipId), ids(report.second.trace), 'Second violation audio mismatch');

  console.error('[adversarial] third SHOOT escalation is fatal and has no exit');
  await main.evaluate(`document.querySelector('#background-button').click()`);
  await waitForEvaluation(main, `window.desktopAPI.getRuntimeWindowState()`, (value) => value.mode === 'hidden' && !value.visible);
  await main.evaluate(`window.__beishuTest.clearTrace(); window.__beishuTest.setRandomValues([0.4, 0.1]); window.__beishuTest.triggerSilenceViolation()`);
  report.thirdReveal = await waitForEvaluation(
    main,
    `window.desktopAPI.getRuntimeWindowState()`,
    (value) => value.mode === 'alert' && value.visible,
    30_000,
    30,
  );
  report.third = await waitForEvaluation(
    main,
    `(async () => ({
      snapshot: window.__beishuTest.getSnapshot(),
      runtime: await window.desktopAPI.getRuntimeWindowState(),
      session: document.querySelector('#session-state').textContent,
      startEnabled: !document.querySelector('#start-button').disabled,
      stream: state.audioStream,
      overlayHidden: document.querySelector('#inline-alert').hidden
    }))()`,
    (value) => value.snapshot.sessionEnded && !value.snapshot.active && !value.snapshot.eventBusy && value.startEnabled,
  );
  assertArray(ids(report.third.snapshot.trace), ['E2_enter_sneak', 'R_aim_shoot'], 'Third violation is not fatal SHOOT without exit');
  assert(!ids(report.third.snapshot.trace).some((clip) => clip.startsWith('X')), 'Fatal violation incorrectly appended an exit');
  assert(report.third.snapshot.lives === 0 && report.third.session === '本次学习结束', 'Fatal violation did not end the session');
  assert(report.third.runtime.mode === 'scene' && report.third.runtime.visible && report.third.runtime.windowCount === 1, 'Fatal result did not remain in the same visible window');
  assert(report.third.stream === null && report.third.overlayHidden, 'Fatal result leaked microphone state or overlay');
  assertArray(report.third.snapshot.audioTrace.map((item) => item.audioClipId), ids(report.third.snapshot.trace), 'Fatal violation audio mismatch');

  console.error('[adversarial] black-frame and same-canvas audit');
  report.rendering = await main.evaluate(`window.__frameQuality`);
  assert(report.rendering.samples > 100, 'Not enough frame samples');
  assert(report.rendering.blank === 0 && report.rendering.minMean >= 15, `Blank/black frames detected: ${JSON.stringify(report.rendering)}`);
  assert(report.rendering.resizeMutations === 0, `Canvas resized at animation seams: ${report.rendering.resizeMutations}`);
  assert(report.rendering.clearCalls === 0, `Canvas was cleared during playback: ${report.rendering.clearCalls}`);
  assert(report.rendering.seamMeans.every((item) => item.mean >= 15), `Dark seam detected: ${JSON.stringify(report.rendering.seamMeans)}`);

  console.error('[adversarial] new session resets escalation and manual clockoff is E1 -> salute -> X1');
  await main.evaluate(`document.querySelector('#start-button').click()`);
  await waitForEvaluation(
    main,
    `window.__beishuTest.getSnapshot()`,
    (value) => value.active && value.introComplete && !value.eventBusy,
  );
  report.reset = await main.evaluate(`window.__beishuTest.getSnapshot()`);
  assert(report.reset.alerts === 0 && report.reset.lives === 3, 'New session did not reset escalation');
  await main.evaluate(`window.__beishuTest.clearTrace()`);
  await main.evaluate(`stopSession()`);
  report.clockoff = await waitForEvaluation(
    main,
    `({
      snapshot: window.__beishuTest.getSnapshot(),
      sceneRunning: state.sceneRunning,
      clip: document.querySelector('#study-scene-canvas').dataset.clipId,
      frame: document.querySelector('#study-scene-canvas').dataset.frameIndex,
      startEnabled: !document.querySelector('#start-button').disabled,
      audioStream: state.audioStream
    })`,
    (value) => !value.snapshot.active && !value.sceneRunning && value.startEnabled,
  );
  assertArray(ids(report.clockoff.snapshot.trace), ['E1_enter_walk', 'R_pass_react_salute', 'X1_exit'], 'Clockoff order is wrong');
  assertArray(report.clockoff.snapshot.audioTrace.map((item) => item.audioClipId), ids(report.clockoff.snapshot.trace), 'Clockoff source audio mismatch');
  assert(report.clockoff.clip === 'E1_enter_walk' && report.clockoff.frame === '0', 'Clockoff did not return to the empty-room waiting frame');
  assert(report.clockoff.audioStream === null, 'Manual stop leaked the microphone stream');

  console.error('[adversarial] recoverable microphone permission failure');
  await main.evaluate(`(() => {
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      configurable: true,
      value: async () => { throw new Error('synthetic microphone denial'); }
    });
    document.querySelector('#start-button').click();
    return true;
  })()`);
  report.permissionFailure = await waitForEvaluation(
    main,
    `({ active: state.active, startEnabled: !document.querySelector('#start-button').disabled, voiceStatus: document.querySelector('#voice-status').textContent })`,
    (value) => !value.active && value.startEnabled && value.voiceStatus.includes('无法启动'),
  );

  report.finalRuntime = await main.evaluate(`window.desktopAPI.getRuntimeWindowState()`);
  assert(report.finalRuntime.windowCount === 1 && report.finalRuntime.webContentsId === beforeHide.webContentsId, 'Window count or identity changed');
  assert(!(await targets()).some((target) => target.url.includes('alert.html')), 'Legacy alert window exists');
  console.log(JSON.stringify(report));
} finally {
  await main.evaluate(`(() => {
    clearInterval(window.__frameSampler);
    window.__canvasObserver?.disconnect();
    if (window.__originalClearRect) CanvasRenderingContext2D.prototype.clearRect = window.__originalClearRect;
    Promise.all((window.__testAudioContexts || []).map((context) => context.close().catch(() => {})));
    window.desktopAPI.getSpeakerState().then(async (profileState) => {
      for (const profile of profileState?.profiles || []) {
        await window.desktopAPI.deleteSpeakerProfile(profile.id).catch(() => {});
      }
    }).catch(() => {}).finally(() => setTimeout(() => window.desktopAPI.quitApp(), 50));
    return true;
  })()`).catch(() => {});
  await wait(500);
  main.close();
}
