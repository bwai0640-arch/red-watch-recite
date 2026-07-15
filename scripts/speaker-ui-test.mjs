import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const port = Number(process.argv[2]);
if (!port) throw new Error('Usage: node speaker-ui-test.mjs <remote-debugging-port>');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtureDir = path.join(root, 'work', 'speaker-fixtures');
const fixtureNames = [
  'fangjun-sr-1.wav',
  'fangjun-sr-2.wav',
  'fangjun-sr-3.wav',
  'fangjun-test-sr-1.wav',
  'leijun-test-sr-1.wav',
];
const fixtures = Object.fromEntries(fixtureNames.map((name) => [
  name,
  fs.readFileSync(path.join(fixtureDir, name)).toString('base64'),
]));

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
let target;
for (let attempt = 0; attempt < 180; attempt += 1) {
  try {
    const list = await fetch(`http://127.0.0.1:${port}/json`).then((response) => response.json());
    target = list.find((item) => item.url === 'rwt://renderer/index.html');
    if (target) break;
  } catch {}
  await wait(250);
}
if (!target) throw new Error('Main renderer target not found');

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});
let nextId = 1;
const pending = new Map();
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  const request = pending.get(message.id);
  if (!request) return;
  pending.delete(message.id);
  if (message.result?.exceptionDetails) {
    request.reject(new Error(message.result.exceptionDetails.exception?.description || message.result.exceptionDetails.text));
  } else {
    request.resolve(message.result?.result?.value);
  }
});
function evaluate(expression) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({
      id,
      method: 'Runtime.evaluate',
      params: { expression, awaitPromise: true, returnByValue: true },
    }));
  });
}
async function waitFor(expression, predicate, timeout = 60_000) {
  const deadline = Date.now() + timeout;
  let value;
  while (Date.now() < deadline) {
    value = await evaluate(expression);
    if (predicate(value)) return value;
    await wait(100);
  }
  throw new Error(`Timed out: ${expression}\nLast value: ${JSON.stringify(value)}`);
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const overlapExpression = `(() => {
  const buttons = [...document.querySelectorAll('button')]
    .filter((button) => !button.hidden && getComputedStyle(button).display !== 'none')
    .map((button) => button.getBoundingClientRect())
    .filter((rect) => rect.width > 0 && rect.height > 0);
  return buttons.some((a, index) => buttons.slice(index + 1).some((b) => (
    a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
  )));
})()`;

const report = {};
try {
  await waitFor(
    `({ api: Boolean(window.desktopAPI), testApi: Boolean(window.__beishuTest) })`,
    (value) => value.api && value.testApi,
  );
  await waitFor(
    `({ ready: state.speakerReady, scene: document.querySelector('#study-scene-canvas').dataset.animationReady })`,
    (value) => value.ready && value.scene === 'true',
  );
  await evaluate(`window.desktopAPI.deleteSpeakerProfile().catch(() => {}); refreshSpeakerState()`);
  report.initial = await evaluate(`({
    profile: state.speakerProfileExists,
    startText: UI.startButton.textContent,
    startEnabled: !UI.startButton.disabled,
    enrollmentHidden: UI.speakerEnrollment.hidden,
    overlap: ${overlapExpression}
  })`);
  assert(!report.initial.profile && report.initial.startEnabled, 'First run is not ready for enrollment');
  assert(report.initial.startText === '开始学习' && report.initial.enrollmentHidden, 'Enrollment interrupted the initial scene');
  assert(!report.initial.overlap, 'Initial buttons overlap');

  await evaluate(`UI.startButton.click()`);
  report.enrollment = await waitFor(
    `({
      open: state.enrollmentOpen,
      hidden: UI.speakerEnrollment.hidden,
      importButton: Boolean(document.querySelector('#enrollment-import-button')),
      fileInput: Boolean(document.querySelector('#enrollment-file-input')),
      actionLabels: [...document.querySelectorAll('.enrollment-actions button')].map((button) => button.textContent.trim()),
      topBottomClear: document.querySelector('.enrollment-top').getBoundingClientRect().bottom < innerHeight * .38
        && document.querySelector('.enrollment-bottom').getBoundingClientRect().top > innerHeight * .55,
      overlap: ${overlapExpression}
    })`,
    (value) => value.open && !value.hidden,
  );
  assert(report.enrollment.topBottomClear, 'Enrollment text or controls cover the middle animation');
  assert(!report.enrollment.overlap, 'Enrollment buttons overlap');
  assert(!report.enrollment.importButton && !report.enrollment.fileInput, 'Audio import controls still exist');
  assert(report.enrollment.actionLabels.length === 2
    && report.enrollment.actionLabels[0].includes('24 秒录入')
    && report.enrollment.actionLabels[1] === '取消', 'Enrollment is not microphone-only');
  await evaluate(`closeSpeakerEnrollment({ cancel: true })`);

  await evaluate(`(async () => {
    const encoded = ${JSON.stringify(fixtures)};
    const context = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
    const decode = async (base64) => {
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
      const buffer = await context.decodeAudioData(bytes.buffer);
      const mono = SpeakerAudio.mixToMono(buffer);
      return buffer.sampleRate === 16000 ? mono : SpeakerAudio.resampleLinear(mono, buffer.sampleRate, 16000);
    };
    window.__speakerFixtures = {};
    for (const [name, value] of Object.entries(encoded)) window.__speakerFixtures[name] = await decode(value);
    const sources = [
      window.__speakerFixtures['fangjun-sr-1.wav'],
      window.__speakerFixtures['fangjun-sr-2.wav'],
      window.__speakerFixtures['fangjun-sr-3.wav'],
    ];
    const recording = new Float32Array(16000 * 24);
    let offset = 0;
    let sourceIndex = 0;
    while (offset < recording.length) {
      const source = sources[sourceIndex % sources.length];
      const count = Math.min(source.length, recording.length - offset);
      recording.set(source.subarray(0, count), offset);
      offset += count;
      sourceIndex += 1;
    }
    window.__originalCaptureEnrollmentMicrophone = captureEnrollmentMicrophone;
    captureEnrollmentMicrophone = async () => recording;
    await openSpeakerEnrollment();
    UI.enrollmentMicButton.click();
    await context.close();
    return true;
  })()`);
  report.registration = await waitFor(
    `({
      rendererProfile: state.speakerProfileExists,
      enrollmentOpen: state.enrollmentOpen,
      label: UI.speakerProfileState.textContent,
      requiredSamples: ENROLLMENT_SAMPLE_COUNT
    })`,
    (value) => value.rendererProfile && !value.enrollmentOpen,
    60_000,
  );
  await evaluate(`captureEnrollmentMicrophone = window.__originalCaptureEnrollmentMicrophone`);
  assert(report.registration.rendererProfile && report.registration.requiredSamples === 8, 'Microphone profile did not become active');

  await evaluate(`(() => {
    window.__beishuTest.setPlaybackRate(16);
    window.__testAudioContexts = [];
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      configurable: true,
      value: async (constraints) => {
        const context = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
        const destination = context.createMediaStreamDestination();
        window.__testAudioContexts.push(context);
        window.__lastGumConstraints = constraints;
        return destination.stream;
      }
    });
    UI.startButton.click();
    return true;
  })()`);
  report.started = await waitFor(
    `({
      active: state.active,
      intro: state.introComplete,
      busy: state.eventBusy,
      vad: document.body.dataset.vadState,
      captureMode: state.pcmCapture?.mode,
      videoTracks: state.audioStream?.getVideoTracks().length,
      constraints: window.__lastGumConstraints
    })`,
    (value) => value.active && value.intro && !value.busy && value.vad === 'ready',
    90_000,
  );
  assert(report.started.captureMode === 'audio-worklet' || report.started.captureMode === 'script-processor', 'Continuous PCM capture did not start');
  assert(report.started.videoTracks === 0 && report.started.constraints.video === false, 'Camera/video was requested');

  report.verification = await evaluate(`(async () => {
    clearInterval(state.audioTimer);
    state.audioTimer = null;
    state.silenceArmed = true;
    state.silentSince = 123456;
    await window.__beishuTest.verifyOwnerVoice(window.__speakerFixtures['leijun-test-sr-1.wav']);
    await window.__beishuTest.verifyOwnerVoice(window.__speakerFixtures['leijun-test-sr-1.wav']);
    await window.__beishuTest.verifyOwnerVoice(window.__speakerFixtures['leijun-test-sr-1.wav']);
    const afterOther = {
      silentSince: state.silentSince,
      matched: state.lastSpeakerMatched,
      rejected: state.lastSpeakerRejected,
      score: state.lastSpeakerScore,
      detected: document.body.dataset.voiceDetected,
    };
    await window.__beishuTest.verifyOwnerVoice(window.__speakerFixtures['fangjun-test-sr-1.wav']);
    const afterOwner = {
      silentSince: state.silentSince,
      matched: state.lastSpeakerMatched,
      score: state.lastSpeakerScore,
      detected: document.body.dataset.voiceDetected,
    };
    return { afterOther, afterOwner };
  })()`);
  assert(report.verification.afterOther.silentSince === 123456, 'Other speaker reset the silence clock');
  assert(!report.verification.afterOther.matched && report.verification.afterOther.rejected
    && report.verification.afterOther.detected === 'false', 'Other speaker was accepted or not rejected after three windows');
  assert(report.verification.afterOwner.silentSince === 0, 'Owner voice did not reset the silence clock');
  assert(report.verification.afterOwner.matched && report.verification.afterOwner.detected === 'true', 'Owner voice was not accepted');

  await evaluate(`(async () => {
    await stopSession(false, true);
    await window.desktopAPI.deleteSpeakerProfile();
    await refreshSpeakerState();
    return true;
  })()`);
  report.cleaned = await evaluate(`({ profile: state.speakerProfileExists, active: state.active, stream: state.audioStream })`);
  assert(!report.cleaned.profile && !report.cleaned.active && report.cleaned.stream === null, 'Test profile or microphone leaked');
  console.log(JSON.stringify(report));
} finally {
  await evaluate(`(async () => {
    await stopSession(false, true).catch(() => {});
    await window.desktopAPI.deleteSpeakerProfile().catch(() => {});
    await Promise.all((window.__testAudioContexts || []).map((context) => context.close().catch(() => {})));
    setTimeout(() => window.desktopAPI.quitApp(), 50);
    return true;
  })()`).catch(() => {});
  await wait(300);
  socket.close();
}
