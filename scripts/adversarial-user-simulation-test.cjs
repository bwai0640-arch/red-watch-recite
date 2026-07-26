const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// This suite deliberately stays below the desktop shell: it never imports
// Electron, opens a window, requests a media device, or reads application data.
const {
  QuietModeDetector,
  classifyStudyAudioEvents,
} = require('../renderer/study-policy.js');
const {
  clampFloatingBounds,
  normalizeFloatingWindowSize,
  readBackgroundPreference,
  readFloatingWindowSize,
  resolveAlertReturnMode,
  writeBackgroundPreference,
  writeFloatingWindowSize,
} = require('../window-mode-policy.js');

const ROOT = path.join(__dirname, '..');
const SECOND = 1_000;
const FLOATING_DEFAULT = Object.freeze({ width: 320, height: 225 });
const FLOATING_MINIMUM = Object.freeze({ width: 224, height: 170 });
const FLOATING_OPTIONS = Object.freeze({
  defaultSize: FLOATING_DEFAULT,
  minimumSize: FLOATING_MINIMUM,
  maximumSize: FLOATING_DEFAULT,
});

function readSource(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function detector(overrides = {}) {
  return new QuietModeDetector({
    violationSeconds: 3,
    frameMs: SECOND,
    evidenceGapSeconds: 5,
    rearmQuietSeconds: 5,
    // Runtime classifies a two-second window once per second. The first
    // overlapping second must not be counted twice.
    evidenceOverlapSeconds: 1,
    ...overrides,
  });
}

function processEvents(target, events, frameMs = SECOND) {
  const decision = classifyStudyAudioEvents(events);
  return { decision, result: target.process(decision, frameMs) };
}

function assertNoViolationFor(target, events, seconds, label) {
  for (let index = 0; index < seconds; index += 1) {
    const { decision, result } = processEvents(target, events);
    assert.equal(decision.mediaEvidence, false, `${label} was classified as media at second ${index + 1}`);
    assert.equal(result.violated, false, `${label} triggered a violation at second ${index + 1}`);
    assert.equal(result.rawEvidenceMs, 0, `${label} accumulated a hidden media candidate`);
  }
}

function assertBoundsInside(bounds, workArea, label) {
  assert.ok(bounds.width >= Math.min(FLOATING_MINIMUM.width, workArea.width), `${label}: width below minimum`);
  assert.ok(bounds.height >= Math.min(FLOATING_MINIMUM.height, workArea.height), `${label}: height below minimum`);
  assert.ok(bounds.width <= Math.min(FLOATING_DEFAULT.width, workArea.width), `${label}: width above maximum`);
  assert.ok(bounds.height <= Math.min(FLOATING_DEFAULT.height, workArea.height), `${label}: height above maximum`);
  assert.ok(bounds.x >= workArea.x, `${label}: left edge escaped its display`);
  assert.ok(bounds.y >= workArea.y, `${label}: top edge escaped its display`);
  assert.ok(bounds.x + bounds.width <= workArea.x + workArea.width, `${label}: right edge escaped its display`);
  assert.ok(bounds.y + bounds.height <= workArea.y + workArea.height, `${label}: bottom edge escaped its display`);
}

function runAudioAdversary() {
  const narratedVideo = Object.freeze([
    { name: 'Television', prob: 0.54 },
    { name: 'Speech', prob: 0.31 },
  ]);
  const weakSpokenVideoWithKeyboard = Object.freeze([
    { name: 'Typing', prob: 0.91 },
    { name: 'Speech', prob: 0.13 },
    { name: 'Music', prob: 0.03 },
  ]);
  const effectOnlyGameplay = Object.freeze([
    { name: 'Gunshot, gunfire', prob: 0.45 },
    { name: 'Sound effect', prob: 0.30 },
  ]);
  const instrumentalVideo = Object.freeze([
    { name: 'Piano', prob: 0.72 },
  ]);
  const keyboardOnly = Object.freeze([
    { name: 'Typing', prob: 0.94 },
    { name: 'Clicking', prob: 0.43 },
  ]);
  const keyboardWithWeakFalseMedia = Object.freeze([
    { name: 'Typing', prob: 0.90 },
    { name: 'Music', prob: 0.13 },
    { name: 'Sound effect', prob: 0.03 },
  ]);
  const silence = Object.freeze([
    { name: 'Silence', prob: 0.98 },
  ]);
  const steadyFan = Object.freeze([
    { name: 'Mechanical fan', prob: 0.87 },
    { name: 'White noise', prob: 0.38 },
    { name: 'Hum', prob: 0.24 },
  ]);
  const fanAndVideo = Object.freeze([
    ...steadyFan,
    { name: 'Speech', prob: 0.13 },
  ]);
  const keyboardAndInstrumental = Object.freeze([
    { name: 'Typing', prob: 0.95 },
    { name: 'Piano', prob: 0.36 },
  ]);
  const pageTurn = Object.freeze([{ name: 'Rustle', prob: 0.82 }]);
  const continuousDeskTap = Object.freeze([{ name: 'Tap', prob: 0.82 }]);
  const normalBreathing = Object.freeze([{ name: 'Breathing', prob: 0.90 }]);
  const humanHumming = Object.freeze([{ name: 'Humming', prob: 0.80 }]);

  // A continuously playing video must reach the strictest user threshold.
  const continuous = detector();
  for (let tick = 1; tick <= 3; tick += 1) {
    assert.equal(processEvents(continuous, narratedVideo).result.violated, false);
  }
  assert.equal(
    processEvents(continuous, narratedVideo).result.violated,
    true,
    'continuous narrated video escaped the three-second threshold after overlap compensation',
  );

  // Games and action clips do not always contain speech or music. Their own
  // sound-effect taxonomy must still count as media evidence.
  const effectOnly = detector();
  for (let tick = 1; tick <= 3; tick += 1) {
    const { decision, result } = processEvents(effectOnly, effectOnlyGameplay);
    assert.equal(decision.speechEvidence, false);
    assert.equal(decision.mediaEvidence, true, 'game sound effects were ignored as non-media');
    assert.equal(result.violated, false);
  }
  assert.equal(
    processEvents(effectOnly, effectOnlyGameplay).result.violated,
    true,
    'effect-only gameplay never triggered after overlap compensation',
  );

  const instrumental = detector();
  for (let tick = 1; tick <= 3; tick += 1) processEvents(instrumental, instrumentalVideo);
  assert.equal(
    processEvents(instrumental, instrumentalVideo).result.violated,
    true,
    'pure-instrumental video escaped the strong non-study sound fallback',
  );

  // Intermittent classifier misses must not let a stop/start video evade the timer.
  const intermittent = detector();
  assert.equal(processEvents(intermittent, narratedVideo).result.violated, false);
  assert.equal(processEvents(intermittent, silence).result.violated, false);
  assert.equal(processEvents(intermittent, narratedVideo).result.violated, false);
  assert.equal(processEvents(intermittent, narratedVideo).result.violated, false);
  assert.equal(
    processEvents(intermittent, narratedVideo).result.violated,
    true,
    'intermittent video reset the accumulated anomaly time',
  );

  // Four quiet seconds preserve the original candidate; playback then continues it.
  const pauseAndResume = detector();
  for (let tick = 1; tick <= 3; tick += 1) processEvents(pauseAndResume, narratedVideo);
  for (let quietSecond = 1; quietSecond <= 4; quietSecond += 1) {
    const held = processEvents(pauseAndResume, silence).result;
    assert.equal(held.rawEvidenceMs, 3 * SECOND, `candidate cleared after a ${quietSecond}-second pause`);
    assert.equal(held.evidenceGapMs, quietSecond * SECOND);
  }
  assert.equal(
    processEvents(pauseAndResume, narratedVideo).result.violated,
    true,
    'resuming a video after four quiet seconds restarted the anomaly timer',
  );

  // Five genuinely normal seconds are required, and sufficient, to clear it.
  const fullRecovery = detector();
  for (let tick = 1; tick <= 3; tick += 1) processEvents(fullRecovery, narratedVideo);
  for (let quietSecond = 1; quietSecond <= 4; quietSecond += 1) {
    assert.equal(processEvents(fullRecovery, silence).result.rawEvidenceMs, 3 * SECOND);
  }
  const recovered = processEvents(fullRecovery, silence).result;
  assert.equal(recovered.rawEvidenceMs, 0, 'five normal seconds did not clear the candidate');
  assert.equal(recovered.suspectedSpeechMs, 0, 'recovered candidate leaked counted evidence');
  assert.equal(processEvents(fullRecovery, narratedVideo).result.suspectedSpeechMs, 0);

  // A difficult but legitimate computer-study workload stays allowed.
  assertNoViolationFor(detector(), keyboardOnly, 120, 'continuous keyboard work');
  assertNoViolationFor(
    detector(),
    keyboardWithWeakFalseMedia,
    120,
    'keyboard with weak Music/Sound effect side labels',
  );
  assertNoViolationFor(detector(), silence, 120, 'silence');
  assertNoViolationFor(detector(), steadyFan, 120, 'steady cooling fan');
  assertNoViolationFor(detector(), normalBreathing, 120, 'normal breathing');

  // Keyboard must not mask low-confidence human speech from a playing video.
  const keyboardAndVideo = detector();
  for (let tick = 1; tick <= 3; tick += 1) {
    const { decision, result } = processEvents(keyboardAndVideo, weakSpokenVideoWithKeyboard);
    assert.equal(decision.keyboardEvidence, true);
    assert.equal(decision.speechEvidence, true, 'weak human speech was discarded beside keyboard input');
    assert.equal(decision.mediaEvidence, true, 'keyboard input masked weak spoken media');
    assert.equal(result.violated, false);
  }
  assert.equal(
    processEvents(keyboardAndVideo, weakSpokenVideoWithKeyboard).result.violated,
    true,
    'keyboard plus weak spoken video never triggered',
  );

  // Cooling noise and keyboard input must not be usable as a masking layer.
  for (const [label, events] of [
    ['fan plus narrated video', fanAndVideo],
    ['keyboard plus instrumental video', keyboardAndInstrumental],
  ]) {
    const mixed = detector();
    for (let tick = 1; tick <= 3; tick += 1) {
      assert.equal(processEvents(mixed, events).result.violated, false, `${label} triggered too early`);
    }
    assert.equal(processEvents(mixed, events).result.violated, true, `${label} masked the media`);
  }

  // Repeated four-second pauses are not a loophole: each new burst continues
  // the same candidate until the user is genuinely quiet for five seconds.
  const repeatedShortBursts = detector();
  for (let burst = 1; burst <= 3; burst += 1) {
    assert.equal(processEvents(repeatedShortBursts, narratedVideo).result.violated, false);
    for (let quietSecond = 1; quietSecond <= 4; quietSecond += 1) {
      assert.equal(processEvents(repeatedShortBursts, silence).result.violated, false);
    }
  }
  assert.equal(
    processEvents(repeatedShortBursts, narratedVideo).result.violated,
    true,
    'four-second stop/start playback evaded the accumulated anomaly timer',
  );

  // Once warned, continuous playback must not spam warnings. Exactly five
  // normal seconds rearms it, after which the same behaviour is caught again.
  const rearmAfterWarning = detector();
  for (let tick = 1; tick <= 3; tick += 1) processEvents(rearmAfterWarning, narratedVideo);
  assert.equal(processEvents(rearmAfterWarning, narratedVideo).result.violated, true);
  for (let tick = 1; tick <= 6; tick += 1) {
    assert.equal(processEvents(rearmAfterWarning, narratedVideo).result.violated, false, 'warning spammed');
  }
  for (let quietSecond = 1; quietSecond <= 4; quietSecond += 1) {
    assert.equal(processEvents(rearmAfterWarning, silence).result.rearmed, false);
  }
  assert.equal(processEvents(rearmAfterWarning, silence).result.rearmed, true);
  for (let tick = 1; tick <= 3; tick += 1) processEvents(rearmAfterWarning, narratedVideo);
  assert.equal(processEvents(rearmAfterWarning, narratedVideo).result.violated, true);

  // The most forgiving user setting still eventually catches uninterrupted media.
  const maximumDelay = detector({ violationSeconds: 15 });
  for (let tick = 1; tick <= 15; tick += 1) {
    assert.equal(processEvents(maximumDelay, narratedVideo).result.violated, false);
  }
  assert.equal(processEvents(maximumDelay, narratedVideo).result.violated, true);

  // Real classifier callbacks jitter between 500 and 1500 ms. They must be
  // accounted by elapsed duration, not by assuming a fixed callback count.
  const jitteryCallbacks = detector();
  const jitterFrames = [1_500, 500, 1_500, 500];
  jitterFrames.slice(0, -1).forEach((frameMs) => {
    assert.equal(processEvents(jitteryCallbacks, narratedVideo, frameMs).result.violated, false);
  });
  assert.equal(
    processEvents(jitteryCallbacks, narratedVideo, jitterFrames.at(-1)).result.violated,
    true,
  );

  // A student turning a page every few seconds must not slowly build a hidden
  // warning. A continuous tapping/humming track must still be caught.
  const pageTurning = detector();
  for (let page = 1; page <= 30; page += 1) {
    const transient = processEvents(pageTurning, pageTurn);
    assert.equal(transient.decision.transientEvidence, true);
    assert.equal(transient.result.neutralTransient, true);
    assert.equal(transient.result.rawEvidenceMs, 0);
    for (let quietSecond = 1; quietSecond <= 4; quietSecond += 1) {
      assert.equal(processEvents(pageTurning, silence).result.violated, false);
    }
  }
  for (const [label, events] of [
    ['continuous desk tapping', continuousDeskTap],
    ['human humming', humanHumming],
  ]) {
    const continuousSound = detector();
    let warned = false;
    for (let tick = 1; tick <= 6; tick += 1) {
      warned ||= processEvents(continuousSound, events).result.violated;
    }
    assert.equal(warned, true, `${label} escaped continuous-sound escalation`);
  }
}

async function runFloatingWindowAdversary() {
  assert.deepEqual(
    normalizeFloatingWindowSize({ width: -9_999, height: 0 }, FLOATING_OPTIONS),
    FLOATING_MINIMUM,
    'undersized preference did not clamp to the supported minimum',
  );
  assert.deepEqual(
    normalizeFloatingWindowSize({ width: 99_999, height: 99_999 }, FLOATING_OPTIONS),
    FLOATING_DEFAULT,
    'oversized preference did not clamp to the current maximum',
  );
  assert.deepEqual(
    normalizeFloatingWindowSize(FLOATING_DEFAULT, FLOATING_OPTIONS),
    FLOATING_DEFAULT,
    'the advertised maximum floating size changed unexpectedly',
  );

  const primary = { x: 0, y: 0, width: 1920, height: 1040 };
  const leftDisplay = { x: -1920, y: -120, width: 1920, height: 1080 };
  const aboveDisplay = { x: 300, y: -1200, width: 1280, height: 1024 };
  const tinyDisplay = { x: -180, y: 50, width: 180, height: 120 };
  const cases = [
    ['primary oversize/bottom-right', { x: 50_000, y: 50_000, width: 900, height: 700 }, primary],
    ['left display negative escape', { x: -50_000, y: -50_000, width: 1, height: 1 }, leftDisplay],
    ['above display maximum escape', { x: 50_000, y: -50_000, width: 50_000, height: 50_000 }, aboveDisplay],
    ['display smaller than minimum', { x: Infinity, y: NaN, width: 999, height: -9 }, tinyDisplay],
  ];
  for (const [label, requested, workArea] of cases) {
    const clamped = clampFloatingBounds(
      requested,
      workArea,
      FLOATING_DEFAULT,
      FLOATING_MINIMUM,
    );
    assertBoundsInside(clamped, workArea, label);
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rwt-adversarial-window-'));
  const preferencePath = path.join(tempRoot, 'window-preferences.json');
  try {
    fs.writeFileSync(preferencePath, '{broken json', 'utf8');
    assert.equal(readBackgroundPreference(preferencePath), 'hidden');
    assert.deepEqual(
      readFloatingWindowSize(preferencePath, FLOATING_OPTIONS),
      FLOATING_DEFAULT,
      'damaged size preferences did not fail closed to the current maximum/default',
    );

    await writeFloatingWindowSize(preferencePath, { width: 247, height: 181 });
    await writeBackgroundPreference(preferencePath, 'floating');
    await writeBackgroundPreference(preferencePath, 'hidden');
    assert.equal(readBackgroundPreference(preferencePath), 'hidden');
    assert.deepEqual(
      readFloatingWindowSize(preferencePath, FLOATING_OPTIONS),
      { width: 247, height: 181 },
      'changing hidden/floating preference silently discarded the chosen size',
    );

    // A fidgety user can switch the choice many times. Serialized writes must
    // leave one valid document and keep the independent resize preference.
    for (let index = 0; index < 25; index += 1) {
      await writeBackgroundPreference(preferencePath, index % 2 ? 'floating' : 'hidden');
    }
    await writeBackgroundPreference(preferencePath, 'floating');
    assert.equal(readBackgroundPreference(preferencePath), 'floating');
    assert.deepEqual(readFloatingWindowSize(preferencePath, FLOATING_OPTIONS), { width: 247, height: 181 });
    const stored = JSON.parse(fs.readFileSync(preferencePath, 'utf8'));
    assert.deepEqual(Object.keys(stored).sort(), ['backgroundMode', 'floatingWindowSize']);
    assert.equal('x' in stored, false, 'dragged screen coordinates were persisted');
    assert.equal('y' in stored, false, 'dragged screen coordinates were persisted');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function runStaticAdversary() {
  const mainSource = readSource('main.js');
  const appSource = readSource('renderer/app.js');
  const htmlSource = readSource('renderer/index.html');
  const cssSource = readSource('renderer/styles.css');
  const rendererSource = `${appSource}\n${htmlSource}`;

  const browserWindowCreations = mainSource.match(/new BrowserWindow\s*\(/g) || [];
  assert.equal(
    browserWindowCreations.length,
    2,
    'a third BrowserWindow was added instead of reusing the main window and existing break prompt',
  );

  // Alerts reuse the existing main window and return to the user's chosen
  // hidden/floating state instead of leaving an unexpected full-size window.
  assert.equal(resolveAlertReturnMode('floating', true), 'floating');
  assert.equal(resolveAlertReturnMode('hidden', false), 'hidden');
  assert.equal(resolveAlertReturnMode('scene', true), 'scene');

  assert.match(appSource, /const label = '好好学！盯着你呢！';/);
  assert.match(appSource, /function pauseSilenceClock\(\)[\s\S]*?showAnimationWatchState\(\);/);
  assert.match(appSource, /function resumeSilenceClock\(\)[\s\S]*?showAnimationWatchState\(\);/);
  assert.doesNotMatch(rendererSource, /检测暂停|正在恢复检测|动画预览期间暂停测试/);

  // Every visible copy of the animation-watch state receives the same yellow.
  assert.match(cssSource, /\.chip\.watch\s*\{[^}]*color:\s*#f0bd5d/);
  assert.match(cssSource, /\.floating-voice-state\.watch\s*\{[^}]*color:\s*#f0bd5d/);
  assert.match(cssSource, /\.watch-copy\s*\{[^}]*color:\s*#f0bd5d\s*!important/);
  assert.match(appSource, /UI\.liveVoiceDuration\.classList\.toggle\('watch-copy', watchPresentation\)/);
  assert.match(appSource, /UI\.voiceStatus\.classList\.toggle\('watch-copy', watchPresentation\)/);
  assert.match(appSource, /preflightTestStatus\.classList\.toggle\('watch-copy', text === '好好学！盯着你呢！'\)/);

  // The hover menu has one state owner. Pointer/focus pseudo-classes must not
  // keep it visually open after Escape or after JavaScript marks it closed.
  assert.match(cssSource, /\.background-action-menu\s*\{[^}]*top:\s*calc\(100% - 1px\)[^}]*bottom:\s*auto[^}]*visibility:\s*hidden[^}]*opacity:\s*0[^}]*pointer-events:\s*none/);
  assert.match(cssSource, /\.background-action\.menu-open \.background-action-menu\s*\{[^}]*visibility:\s*visible[^}]*opacity:\s*1[^}]*pointer-events:\s*auto/);
  assert.doesNotMatch(cssSource, /\.background-action:(?:hover|focus-within) \.background-action-menu/);
  assert.match(cssSource, /\.actions\s*\{[^}]*align-items:\s*start/);
  assert.match(cssSource, /body\.scene-mode:not\(\.controls-open\) \.background-action\.menu-open \.background-action-menu\s*\{[^}]*position:\s*static[^}]*margin-top:\s*4px[^}]*transform:\s*none/);
  assert.doesNotMatch(cssSource, /body\.scene-mode:not\(\.controls-open\) \.background-action-menu\s*\{[^}]*bottom:\s*calc\(100% - 1px\)/);
  assert.match(appSource, /backgroundAction\.addEventListener\('pointerenter',[^\n]*setBackgroundActionExpanded\(true\)/);
  assert.match(appSource, /backgroundAction\.addEventListener\('pointerleave',[^\n]*setBackgroundActionExpanded\(false\)/);

  // The whole compact surface can be dragged; only real action buttons may
  // intercept the pointer as no-drag hit targets.
  assert.match(cssSource, /body\[data-window-mode="floating"\]\s*\{[^}]*-webkit-app-region:\s*drag/);
  assert.match(cssSource, /\.floating-hover-tools\s*\{[^}]*-webkit-app-region:\s*drag/);
  assert.match(cssSource, /\.floating-timer\s*\{[^}]*-webkit-app-region:\s*drag/);
  assert.match(cssSource, /body\[data-window-mode="floating"\] \.study-scene\s*\{[^}]*-webkit-app-region:\s*drag/);
  assert.match(cssSource, /body\[data-window-mode="floating"\] \.study-scene canvas\s*\{[^}]*-webkit-app-region:\s*drag/);
  assert.match(cssSource, /\.floating-action\s*\{[^}]*-webkit-app-region:\s*no-drag/);
  assert.doesNotMatch(cssSource, /\.floating-(?:hover-tools|timer)[^{]*\{[^}]*-webkit-app-region:\s*no-drag/);

  assert.match(mainSource, /floatingWindowMinimumSize\s*=\s*Object\.freeze\(\{ width: 224, height: 170 \}\)/);
  assert.match(mainSource, /setMinimumSize\(floatingWindowMinimumSize\.width, floatingWindowMinimumSize\.height\)/);
  assert.match(mainSource, /function showFloatingWindowNow\([\s\S]*?setResizable\(true\)/);
  assert.match(mainSource, /mainWindow\.on\('resized',[\s\S]*?persistFloatingWindowSize\(\)/);
  assert.match(mainSource, /mainWindow\.on\('moved',[\s\S]*?floatingRestoreBounds = \{ \.\.\.mainWindow\.getBounds\(\) \}/);
  assert.match(mainSource, /mainWindow\.on\('will-move', \(\) => \{\s*if \(mainWindowMode === 'floating'\)/);
  assert.doesNotMatch(mainSource, /mainWindow\.on\('will-move', \(event/);
  assert.match(htmlSource, /id="floating-anomaly-time"[^>]*>未确认本人 0 秒</);
  assert.match(appSource, /function renderFloatingAnomaly\(\)[\s\S]*?异常声音 \$\{seconds\} 秒[\s\S]*?未确认本人 \$\{seconds\} 秒/);
  assert.doesNotMatch(cssSource, /:(?:hover|focus-within) \.floating-(?:voice-state|anomaly-time)[^{]*\{[^}]*opacity:\s*0/);
  assert.match(mainSource, /let backgroundPreferenceWriteChain = Promise\.resolve\(\)/);
  assert.match(mainSource, /function persistFloatingWindowSize\(\)[\s\S]*?backgroundPreferenceWriteChain[\s\S]*?writeFloatingWindowSize/);
  assert.doesNotMatch(appSource, /floatingVoiceState\.addEventListener\('dblclick'/);

  // A fidgety user may tune duration live but cannot erase an active candidate.
  // Recite noise gating is automatic and has no user-facing bypass controls.
  assert.match(appSource, /function resetDetectionAfterSettingChange\(\)\s*\{\s*const preflight = isPreflightAudioActive\(\);\s*if \(!preflight\) return;/);
  assert.doesNotMatch(appSource, /detectionSettingControlsLocked|detectionSettingsLocked/);
  assert.match(appSource, /UI\.studyVoiceLimit\.addEventListener\('input',[\s\S]*?quietDetector\?\.setViolationSeconds\(state\.settings\.studyVoiceSeconds\);[\s\S]*?resetDetectionAfterSettingChange\(\)/);
  assert.match(appSource, /const RECITE_AUTO_VOICE_MARGIN_DB = 8;/);
  assert.doesNotMatch(appSource, /reciteSensitivityDb|voiceThreshold|thresholdMarker|recalibrateButton/);
  assert.doesNotMatch(htmlSource, /voice-threshold|volume-threshold|floating-threshold|抗噪幅度|环境底噪|重新校准/);
  assert.doesNotMatch(cssSource, /\.threshold-marker|\.floating-threshold-control/);
  assert.match(appSource, /const pausesAudioDetection = planUsesSourceAudio\(plan\)/);
  assert.match(appSource, /showAnimationWatchState\(\);\s*if \(pausesAudioDetection\) pauseSilenceClock\(\);/);
  assert.match(appSource, /if \(token === state\.sceneToken && pausesAudioDetection\) resumeSilenceClock\(\);/);
  assert.match(appSource, /transientEvidence: decision\.transientEvidence/);

  // A praise milestone earned while hidden/floating temporarily reveals the
  // same main window, keeps controls hidden, then returns to the prior mode.
  assert.match(appSource, /revealPraiseFromBackground[\s\S]*?classList\.add\('praise-presentation'\)[\s\S]*?revealForInlineAlert\(\)/);
  assert.match(appSource, /finishInlineAlert\(\{ alertId: praiseAlertId, disposition: 'return' \}\)[\s\S]*?classList\.remove\('praise-presentation'\)/);
  assert.match(cssSource, /body\.praise-presentation \.shell\s*\{\s*visibility:\s*hidden/);
  assert.match(appSource, /state\.windowMode === 'hidden' && state\.earnedPraiseMarks <= state\.praisedMark/);

  // System/model failures must never consume a life as if the student were
  // silent. They stop the session before any violation can accumulate.
  assert.match(appSource, /if \(result\?\.error\) throw new Error/);
  assert.match(appSource, /else if \(state\.active\) \{[\s\S]*?await stopSession\(false, true\);[\s\S]*?未计为违规/);
  assert.match(appSource, /const SPEAKER_VERIFY_TIMEOUT_MS = 5_000;/);
  assert.match(appSource, /Promise\.race\(\[[\s\S]*?verifySpeaker\([\s\S]*?声纹处理超时/);
  assert.match(
    appSource,
    /if \(silentForMs >= violationLimitMs\(\)\) \{\s*if \(state\.speakerVerificationPending\) \{[\s\S]*?return;[\s\S]*?const graceDeadline/,
  );

  // The alert overlay is ready before the full-size native window appears and
  // remains until the native return transition completes, preventing shell flashes.
  assert.match(appSource, /showOverlay\(\{[\s\S]*?const revealResult = await window\.desktopAPI\.revealForInlineAlert\(\)/);
  assert.match(appSource, /finishInlineAlert\(\{ alertId, disposition: 'return' \}\);\s*hideOverlay\(\)/);
}

async function main() {
  runAudioAdversary();
  await runFloatingWindowAdversary();
  runStaticAdversary();
  console.log(JSON.stringify({
    suite: 'adversarial-user-simulation',
    uiStarted: false,
    electronImported: false,
    microphoneRequested: false,
    speakerProfileRead: false,
    scenarios: {
      audio: 22,
      floatingWindow: 10,
      staticContracts: 25,
    },
  }));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
