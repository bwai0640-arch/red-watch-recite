const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  STUDY_AUDIO_EVENT_THRESHOLDS,
  QuietModeDetector,
  classifyStudyAudioEvents,
} = require('../renderer/study-policy.js');

const SECOND_MS = 1_000;

function event(name, prob) {
  return { name, prob };
}

function classify(events, overrides = {}) {
  return classifyStudyAudioEvents(events, overrides);
}

function feed(detector, decisions, frameMs = SECOND_MS) {
  return decisions.map((decision) => detector.process(decision, frameMs));
}

assert.deepEqual(STUDY_AUDIO_EVENT_THRESHOLDS, {
  media: 0.20,
  speech: 0.12,
  broadcast: 0.12,
  keyboard: 0.18,
  strongNonStudySound: 0.35,
  keyboardMaskedMusic: 0.12,
  keyboardMaskedMusicCompanion: 0.02,
});
assert.equal(Object.isFrozen(STUDY_AUDIO_EVENT_THRESHOLDS), true);

// Keyboard-like events are allowed even when they are much louder or more
// confidently classified than anything else in the window.
for (const keyboardLabel of [
  'Typing',
  'Typewriter',
  'Computer keyboard',
  'Clicking',
  'Clickety-clack',
]) {
  const result = classify([event(keyboardLabel, 0.99)]);
  assert.equal(result.mediaEvidence, false, `${keyboardLabel} became media evidence`);
  assert.equal(result.keyboardEvidence, true, `${keyboardLabel} was not recognized as keyboard`);
  assert.equal(result.keyboardOnly, true, `${keyboardLabel} was not treated as keyboard-only`);
}

// Explicit human-voice labels use the more sensitive speech threshold, while
// music and broadcast labels retain their independent boundaries.
for (const mediaFixture of [
  { name: 'Speech', prob: 0.12 },
  { name: 'Male speech, man speaking', prob: 0.12 },
  { name: 'Conversation', prob: 0.12 },
  { name: 'Narration, monologue', prob: 0.12 },
  { name: 'Speech synthesizer', prob: 0.12 },
  { name: 'Whispering', prob: 0.12 },
  { name: 'Singing', prob: 0.12 },
  { name: 'Laughter', prob: 0.12 },
  { name: 'Chatter', prob: 0.12 },
  { name: 'A capella', prob: 0.12 },
  { name: 'Music', prob: 0.21 },
  { name: 'Video game music', prob: 0.21 },
  { name: 'Musical instrument', prob: 0.21 },
  { name: 'Keyboard (musical)', prob: 0.21 },
  { name: 'Crowd', prob: 0.21 },
  { name: 'Vehicle', prob: 0.21 },
  { name: 'Engine', prob: 0.21 },
  { name: 'Telephone', prob: 0.21 },
  { name: 'Ringtone', prob: 0.21 },
  { name: 'Alarm', prob: 0.21 },
  { name: 'Siren', prob: 0.21 },
  { name: 'Explosion', prob: 0.21 },
  { name: 'Gunshot, gunfire', prob: 0.21 },
  { name: 'Machine gun', prob: 0.21 },
  { name: 'Fireworks', prob: 0.21 },
  { name: 'Sound effect', prob: 0.35 },
  { name: 'Effects unit', prob: 0.35 },
  { name: 'Television', prob: 0.13 },
  { name: 'Radio', prob: 0.13 },
]) {
  const result = classify([event(mediaFixture.name, mediaFixture.prob)]);
  assert.equal(result.mediaEvidence, true, `${mediaFixture.name} was not media evidence`);
  assert.equal(result.keyboardOnly, false, `${mediaFixture.name} became keyboard-only`);
}

// Substring lookalikes are not human speech. They can still count as a strong
// non-study sound, but must not receive the more sensitive 0.12 speech path.
for (const nonSpeechLabel of [
  'Single-lens reflex camera',
  'Car passing by',
  'Reversing beeps',
  'Singing bowl',
  'Bird vocalization, bird call, bird song',
  'Whale vocalization',
]) {
  const result = classify([event(nonSpeechLabel, 0.99)]);
  assert.equal(result.speechEvidence, false, `${nonSpeechLabel} became speech evidence`);
  assert.equal(result.strongNonStudySoundEvidence, true, `${nonSpeechLabel} missed the strong-sound fallback`);
  assert.equal(result.mediaEvidence, true, `${nonSpeechLabel} escaped all media detection`);
}

// High-confidence sounds commonly present in games, sports, pure-instrumental
// videos and room audio must not require a hand-maintained media allowlist.
for (const strongSoundLabel of [
  'Piano',
  'Cheering',
  'Applause',
  'Walk, footsteps',
  'Door',
  'Whoosh, swoosh, swish',
  'Basketball bounce',
]) {
  const result = classify([event(strongSoundLabel, 0.35)]);
  assert.equal(result.strongNonStudySoundEvidence, true, `${strongSoundLabel} missed strong-sound detection`);
  assert.equal(result.mediaEvidence, true, `${strongSoundLabel} escaped media detection`);
}

// Common study-room sounds remain explicit negatives even at high confidence.
for (const allowedStudyLabel of [
  'Typing',
  'Writing',
  'Printer',
  'Mechanical fan',
  'Air conditioning',
  'Clock',
  'Tick-tock',
  'Static',
  'White noise',
  'Hum',
  'Inside, small room',
  'Breathing',
]) {
  assert.equal(
    classify([event(allowedStudyLabel, 0.99)]).mediaEvidence,
    false,
    `${allowedStudyLabel} was not allowed as a study-room sound`,
  );
}

// Human study transients are a third state: one isolated cough, sneeze, page
// rustle or desk tap neither accumulates a warning nor clears an existing
// media candidate. Continuous occurrences are escalated by the detector.
for (const transientLabel of [
  'Cough',
  'Throat clearing',
  'Sneeze',
  'Sniff',
  'Rustle',
  'Tap',
]) {
  const result = classify([event(transientLabel, 0.80)]);
  assert.equal(result.mediaEvidence, false, `${transientLabel} became immediate media evidence`);
  assert.equal(result.transientEvidence, true, `${transientLabel} was not marked transient`);
  assert.equal(result.strongNonStudySoundEvidence, false, `${transientLabel} entered the generic fallback`);
}
assert.equal(classify([event('Humming', 0.80)]).mediaEvidence, true, 'human humming was mistaken for fan hum');
assert.equal(classify([event('Hum', 0.99)]).mediaEvidence, false, 'machine hum stopped being allowed');

// Captured model outputs from the pure-Node smoke fixtures guard the small
// safety margin below the unchanged 0.20 music threshold.
for (const nonMediaFixture of [
  {
    name: 'silence',
    events: [event('Music', 0.1714), event('Speech', 0.0177), event('Silence', 0.5098)],
  },
  {
    name: 'keyboard',
    events: [event('Synthesizer', 0.2839), event('Music', 0.1873), event('Speech', 0.0037)],
  },
  {
    name: 'steady fan',
    events: [event('Static', 0.3808), event('White noise', 0.2325), event('Hum', 0.1691), event('Speech', 0.001)],
  },
]) {
  assert.equal(
    classify(nonMediaFixture.events).mediaEvidence,
    false,
    `${nonMediaFixture.name} became media evidence`,
  );
}

// Regression for the real failure mode: loud keyboard classification must not
// veto quieter video/speech classification in the same analysis window.
const loudKeyboardQuietSpeech = classify([
  event('Computer keyboard', 0.99),
  event('Speech', 0.125),
]);
assert.equal(loudKeyboardQuietSpeech.keyboardEvidence, true);
assert.equal(loudKeyboardQuietSpeech.mediaEvidence, true, 'loud keyboard masked quieter speech');
assert.equal(loudKeyboardQuietSpeech.keyboardOnly, false, 'mixed keyboard and speech became keyboard-only');
assert.equal(loudKeyboardQuietSpeech.keyboardLabel, 'Computer keyboard');
assert.equal(loudKeyboardQuietSpeech.mediaLabel, 'Speech');

const loudKeyboardQuietTelevision = classify([
  event('Typing', 1),
  event('Television', 0.121),
]);
assert.equal(loudKeyboardQuietTelevision.keyboardEvidence, true);
assert.equal(loudKeyboardQuietTelevision.mediaEvidence, true, 'loud keyboard masked quieter television audio');
assert.equal(loudKeyboardQuietTelevision.broadcastLabel, 'Television');

// Weak Music/Sound effect side labels are a known keyboard-model failure mode;
// they must never combine into a violation merely because Typing is present.
const loudKeyboardWithWeakFalseMedia = classify([
  event('Typing', 0.90),
  event('Music', 0.13),
  event('Sound effect', 0.03),
]);
assert.equal(loudKeyboardWithWeakFalseMedia.mediaEvidence, false);
assert.equal(loudKeyboardWithWeakFalseMedia.keyboardMixedMediaEvidence, false);
assert.equal(loudKeyboardWithWeakFalseMedia.keyboardOnly, true);

// Real keyboard recordings can push a playing song just below the ordinary
// music threshold. Only a second, specifically musical label may corroborate
// that weak Music score; generic Sound effect must never do so.
const realFixtureShapedMaskedMusic = classify([
  event('Typing', 0.598),
  event('Computer keyboard', 0.422),
  event('Music', 0.132),
  event('Musical instrument', 0.027),
  event('Brass instrument', 0.021),
  event('Sound effect', 0.011),
]);
assert.equal(realFixtureShapedMaskedMusic.keyboardEvidence, true);
assert.equal(realFixtureShapedMaskedMusic.keyboardMaskedMusicEvidence, true);
assert.equal(realFixtureShapedMaskedMusic.mediaEvidence, true);

const weakMusicWithoutKeyboard = classify([
  event('Music', 0.1873),
  event('Electronic music', 0.051),
  event('Musical instrument', 0.030),
]);
assert.equal(weakMusicWithoutKeyboard.keyboardEvidence, false);
assert.equal(weakMusicWithoutKeyboard.keyboardMaskedMusicEvidence, false);
assert.equal(weakMusicWithoutKeyboard.mediaEvidence, false);

const borderlineKeyboardOnly = classify([
  event('Typing', 0.45),
  event('Computer keyboard', 0.44),
  event('Music', 0.186),
  event('Musical instrument', 0.024),
]);
assert.equal(borderlineKeyboardOnly.mediaEvidence, false);
assert.equal(borderlineKeyboardOnly.keyboardOnly, true);

// Probability boundaries are inclusive. Legacy ambient-level options must not
// suppress a qualifying label because self-study now classifies sound directly.
assert.equal(classify([event('Speech', 0.119)]).mediaEvidence, false);
assert.equal(classify([event('Speech', 0.12)]).mediaEvidence, true);
assert.equal(classify([event('Music', 0.199)]).mediaEvidence, false);
assert.equal(classify([event('Music', 0.20)]).mediaEvidence, true);
assert.equal(classify([event('Sound effect', 0.349)]).mediaEvidence, false);
assert.equal(classify([event('Sound effect', 0.35)]).mediaEvidence, true);
assert.equal(classify([event('Television', 0.119)]).mediaEvidence, false);
assert.equal(classify([event('Television', 0.12)]).mediaEvidence, true);
assert.equal(classify([event('Typing', 0.179)]).keyboardEvidence, false);
assert.equal(classify([event('Typing', 0.18)]).keyboardEvidence, true);
assert.equal(classify([event('Speech', 0.99)], {
  levelDeltaDb: -100,
  sensitivityDb: 100,
}).mediaEvidence, true);
assert.equal('aboveLevelThreshold' in classify([event('Speech', 0.99)]), false);

const customThresholds = classify([
  event('Speech', 0.39),
  event('Typing', 0.79),
], {
  mediaThreshold: 0.40,
  speechThreshold: 0.40,
  keyboardThreshold: 0.80,
  strongNonStudySoundThreshold: 0.80,
});
assert.equal(customThresholds.mediaEvidence, false);
assert.equal(customThresholds.keyboardEvidence, false);

// Classification is case-insensitive, ignores malformed entries, clamps
// probabilities, and keeps the strongest matching label without mutating input.
const untrustedEvents = [
  null,
  {},
  event(' ', 1),
  event('Unknown sound', 1),
  event('speech', -10),
  event('  MUSIC  ', 2),
  event('Typing', 'not-a-number'),
];
const untrustedSnapshot = JSON.stringify(untrustedEvents);
const normalized = classify(untrustedEvents);
assert.equal(normalized.mediaEvidence, true);
assert.equal(normalized.mediaScore, 1);
assert.equal(normalized.mediaLabel, 'MUSIC');
assert.equal(normalized.keyboardEvidence, false);
assert.equal(Object.isFrozen(normalized), true);
assert.equal(JSON.stringify(untrustedEvents), untrustedSnapshot, 'classifier mutated input events');
assert.equal(classify(null).mediaEvidence, false);
assert.equal(classify('not-an-array').mediaEvidence, false);

const strongest = classify([
  event('Speech', 0.31),
  event('Music', 0.72),
  event('Television', 0.45),
  event('Radio', 0.62),
  event('Typing', 0.44),
  event('Computer keyboard', 0.87),
]);
assert.equal(strongest.mediaLabel, 'Music');
assert.equal(strongest.mediaScore, 0.72);
assert.equal(strongest.broadcastLabel, 'Radio');
assert.equal(strongest.broadcastScore, 0.62);
assert.equal(strongest.keyboardLabel, 'Computer keyboard');
assert.equal(strongest.keyboardScore, 0.87);

const media = Object.freeze({ mediaEvidence: true, speechEvidence: false });
const allowedKeyboard = Object.freeze({
  mediaEvidence: false,
  speechEvidence: true,
  isSpeech: true,
});
const isolatedTransient = Object.freeze({
  mediaEvidence: false,
  transientEvidence: true,
});

// The model sees two-second windows every second. Deduct the one-second
// overlap once per candidate so the same finite clip cannot be counted once
// for every overlapping window that still contains it.
const overlapDetector = new QuietModeDetector({
  violationSeconds: 3,
  frameMs: SECOND_MS,
  evidenceGapSeconds: 1,
  evidenceOverlapSeconds: 1,
});
let overlapResults = feed(overlapDetector, [media, media, media]);
assert.deepEqual(overlapResults.map((result) => result.suspectedSpeechMs), [0, 1_000, 2_000]);
assert.equal(overlapResults.some((result) => result.violated), false, 'overlapping windows fired one second early');
assert.equal(overlapDetector.process(media).violated, true, 'confirmed media did not fire after overlap deduction');

const finiteClipDetector = new QuietModeDetector({
  violationSeconds: 3,
  frameMs: SECOND_MS,
  evidenceGapSeconds: 1,
  evidenceOverlapSeconds: 1,
});
overlapResults = feed(finiteClipDetector, [media, media, media, allowedKeyboard, allowedKeyboard]);
assert.equal(overlapResults.some((result) => result.violated), false, 'finite overlapping clip became a three-second violation');
assert.equal(overlapResults.at(-1).rawEvidenceMs, 0);
assert.equal(overlapResults.at(-1).suspectedSpeechMs, 0);

feed(finiteClipDetector, [media, media]);
finiteClipDetector.reset();
const firstAfterReset = finiteClipDetector.process(media);
assert.equal(firstAfterReset.rawEvidenceMs, SECOND_MS);
assert.equal(firstAfterReset.suspectedSpeechMs, 0, 'reset retained overlap-adjusted evidence');

const jitteredOverlapDetector = new QuietModeDetector({
  violationSeconds: 3,
  evidenceGapSeconds: 1,
  evidenceOverlapSeconds: 1,
});
overlapResults = [
  jitteredOverlapDetector.process(media, 1_000),
  jitteredOverlapDetector.process(media, 1_200),
  jitteredOverlapDetector.process(media, 800),
];
assert.deepEqual(overlapResults.map((result) => result.suspectedSpeechMs), [0, 1_200, 2_000]);
assert.equal(overlapResults.some((result) => result.violated), false);
assert.equal(jitteredOverlapDetector.process(media, 1_000).violated, true, 'millisecond overlap deduction drifted with jittered frames');

const firstWindowGapDetector = new QuietModeDetector({
  violationSeconds: 3,
  frameMs: SECOND_MS,
  evidenceGapSeconds: 2,
  evidenceOverlapSeconds: 1,
});
overlapResults = feed(firstWindowGapDetector, [media, allowedKeyboard, media]);
assert.deepEqual(overlapResults.map((result) => result.suspectedSpeechMs), [0, 0, 1_000]);
assert.equal(overlapResults[1].rawEvidenceMs, SECOND_MS, 'allowed gap discarded first raw evidence window');
assert.equal(overlapResults[1].evidenceGapMs, SECOND_MS);

// mediaEvidence is authoritative for the new classifier path. Legacy VAD
// fields cannot turn an allowed keyboard window into a violation.
const keyboardDetector = new QuietModeDetector({
  violationSeconds: 3,
  frameMs: SECOND_MS,
  evidenceGapSeconds: 1,
});
for (let index = 0; index < 60; index += 1) {
  const result = keyboardDetector.process(allowedKeyboard);
  assert.equal(result.evidence, false);
  assert.equal(result.violated, false, 'keyboard-only windows accumulated into a violation');
  assert.equal(result.suspectedSpeechMs, 0);
}

const intermittentTransientDetector = new QuietModeDetector({
  violationSeconds: 3,
  frameMs: SECOND_MS,
  evidenceGapSeconds: 5,
  evidenceOverlapSeconds: 1,
  transientEscalationSeconds: 2,
});
for (let cycle = 0; cycle < 20; cycle += 1) {
  const transientResult = intermittentTransientDetector.process(isolatedTransient);
  assert.equal(transientResult.neutralTransient, true);
  assert.equal(transientResult.rawEvidenceMs, 0);
  assert.equal(transientResult.violated, false, 'isolated study transients accumulated a warning');
  for (let quietSecond = 0; quietSecond < 4; quietSecond += 1) {
    intermittentTransientDetector.process(allowedKeyboard);
  }
}

const continuousTransientDetector = new QuietModeDetector({
  violationSeconds: 3,
  frameMs: SECOND_MS,
  evidenceGapSeconds: 5,
  evidenceOverlapSeconds: 1,
  transientEscalationSeconds: 2,
});
const transientResults = feed(continuousTransientDetector, Array(5).fill(isolatedTransient));
assert.equal(transientResults[0].neutralTransient, true);
assert.equal(transientResults[1].transientEscalated, true);
assert.equal(transientResults.at(-1).violated, true, 'continuous transient audio never escalated');

const candidateHeldByTransient = new QuietModeDetector({
  violationSeconds: 3,
  frameMs: SECOND_MS,
  evidenceGapSeconds: 5,
  evidenceOverlapSeconds: 1,
  transientEscalationSeconds: 2,
});
feed(candidateHeldByTransient, [media, media]);
const heldByTransient = candidateHeldByTransient.process(isolatedTransient);
assert.equal(heldByTransient.rawEvidenceMs, 2 * SECOND_MS);
assert.equal(heldByTransient.evidenceGapMs, 0, 'transient audio incorrectly advanced recovery');
assert.equal(heldByTransient.neutralTransient, true);

// All adjustable boundaries (3 through 15 seconds) trigger on the exact Nth
// one-second media window, never early.
for (let violationSeconds = 3; violationSeconds <= 15; violationSeconds += 1) {
  const detector = new QuietModeDetector({
    violationSeconds,
    frameMs: SECOND_MS,
    evidenceGapSeconds: 1,
  });
  for (let index = 1; index < violationSeconds; index += 1) {
    const result = detector.process(media);
    assert.equal(result.violated, false, `${violationSeconds}s threshold fired at ${index}s`);
    assert.equal(result.suspectedSpeechMs, index * SECOND_MS);
  }
  const thresholdResult = detector.process(media);
  assert.equal(thresholdResult.violated, true, `${violationSeconds}s threshold did not fire exactly`);
  assert.equal(thresholdResult.armed, false);
}

// One missing classifier window is tolerated but contributes no evidence time.
const oneGapDetector = new QuietModeDetector({
  violationSeconds: 3,
  frameMs: SECOND_MS,
  evidenceGapSeconds: 2,
});
let results = feed(oneGapDetector, [media, allowedKeyboard, media]);
assert.equal(results[0].suspectedSpeechMs, SECOND_MS);
assert.equal(results[1].suspectedSpeechMs, SECOND_MS, 'one-second gap discarded the candidate');
assert.equal(results[1].evidenceGapMs, SECOND_MS);
assert.equal(results[2].suspectedSpeechMs, 2 * SECOND_MS);
assert.equal(results.some((result) => result.violated), false, 'gap incorrectly counted as media time');
assert.equal(oneGapDetector.process(media).violated, true, 'media did not violate after three evidence seconds');

// A second consecutive missing window exceeds the tolerance and resets the
// candidate; subsequent media must earn the full threshold again.
const twoGapDetector = new QuietModeDetector({
  violationSeconds: 3,
  frameMs: SECOND_MS,
  evidenceGapSeconds: 2,
});
results = feed(twoGapDetector, [media, allowedKeyboard, allowedKeyboard]);
assert.equal(results[1].suspectedSpeechMs, SECOND_MS);
assert.equal(results[2].suspectedSpeechMs, 0);
assert.equal(results[2].evidenceGapMs, 0);
results = feed(twoGapDetector, [media, media]);
assert.equal(results.every((result) => result.violated === false), true);
assert.equal(twoGapDetector.process(media).violated, true, 'candidate survived a two-window gap');

// Without explicit gap tolerance, old callers retain the strict continuous
// behavior. After a violation, one full quiet window rearms the detector.
const strictDetector = new QuietModeDetector({ violationSeconds: 3, frameMs: SECOND_MS });
results = feed(strictDetector, [media, allowedKeyboard, media, media]);
assert.equal(results.at(-1).violated, false);
assert.equal(strictDetector.process(media).violated, true);
assert.equal(strictDetector.process(media).rearmed, false);
const rearmResult = strictDetector.process(allowedKeyboard);
assert.equal(rearmResult.rearmed, true);
assert.equal(rearmResult.armed, true);
assert.equal(strictDetector.process(media).violated, false, 'rearmed detector fired without a full threshold');

const resetDetector = new QuietModeDetector({
  violationSeconds: 3,
  frameMs: SECOND_MS,
  evidenceGapSeconds: 2,
});
feed(resetDetector, [media, allowedKeyboard]);
assert.equal(resetDetector.snapshot().suspectedSpeechMs, SECOND_MS);
assert.equal(resetDetector.snapshot().evidenceGapMs, SECOND_MS);
resetDetector.reset();
assert.deepEqual(
  {
    armed: resetDetector.snapshot().armed,
    suspectedSpeechMs: resetDetector.snapshot().suspectedSpeechMs,
    evidenceGapMs: resetDetector.snapshot().evidenceGapMs,
  },
  { armed: true, suspectedSpeechMs: 0, evidenceGapMs: 0 },
);

// Live tuning changes the boundary without granting a fresh candidate. Raising
// the threshold preserves earned evidence; lowering it only caps evidence at
// the new boundary instead of resetting it to zero.
const liveAdjustmentDetector = new QuietModeDetector({
  violationSeconds: 10,
  frameMs: SECOND_MS,
  evidenceGapSeconds: 5,
});
feed(liveAdjustmentDetector, Array(4).fill(media));
assert.equal(liveAdjustmentDetector.snapshot().suspectedSpeechMs, 4 * SECOND_MS);
assert.equal(liveAdjustmentDetector.setViolationSeconds(12), 12);
assert.equal(liveAdjustmentDetector.snapshot().suspectedSpeechMs, 4 * SECOND_MS);
assert.equal(liveAdjustmentDetector.setViolationSeconds(3), 3);
assert.equal(liveAdjustmentDetector.snapshot().suspectedSpeechMs, 3 * SECOND_MS);

// Pure-source integration guard: preflight tuning may reset its disposable test
// candidate, while live learning adjustments preserve active evidence.
const rendererSource = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'app.js'), 'utf8');
const rendererHtml = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
assert.match(rendererSource, /function resetDetectionAfterSettingChange\(\)\s*\{\s*const preflight = isPreflightAudioActive\(\);\s*if \(!preflight\) return;/);
assert.match(rendererSource, /state\.quietDetector\?\.reset\(\);\s+resetStudyAudioRuntime\(\);/);
assert.match(rendererSource, /studyAudioClassificationGeneration \+= 1;/);
assert.doesNotMatch(rendererSource, /detectionSettingControlsLocked|detectionSettingsLocked/);
assert.match(rendererSource, /UI\.studyVoiceLimit\.addEventListener\('input',[\s\S]*?quietDetector\?\.setViolationSeconds\(state\.settings\.studyVoiceSeconds\);[\s\S]*?resetDetectionAfterSettingChange\(\)/);
assert.match(rendererSource, /const RECITE_AUTO_VOICE_MARGIN_DB = 8;/);
assert.match(rendererSource, /new AdaptiveVad\.AdaptiveVoiceDetector\([\s\S]*?sensitivityDb: RECITE_AUTO_VOICE_MARGIN_DB/);
assert.doesNotMatch(rendererSource, /reciteSensitivityDb|voiceThreshold|thresholdMarker|recalibrateButton/);
assert.doesNotMatch(rendererHtml, /voice-threshold|volume-threshold|floating-threshold|抗噪幅度|环境底噪|重新校准/);
assert.match(rendererSource, /evidenceOverlapSeconds: STUDY_EVENT_OVERLAP_SECONDS/);
assert.match(rendererSource, /transientEvidence: decision\.transientEvidence/);
assert.match(rendererSource, /const directStudyDetection = state\.mode === 'study';/);
assert.match(rendererSource, /state\.vad = directStudyDetection\s+\? null/);
assert.match(rendererSource, /\? \{ levelPercent: calculateAudioLevelPercent\(\) \}/);
assert.match(rendererSource, /POLICY\.classifyStudyAudioEvents\(result\?\.events\)/);
assert.doesNotMatch(rendererSource, /studySensitivityDb/);
assert.doesNotMatch(rendererSource, /levelDeltaDb: levelDb - state\.latestNoiseFloorDb/);
assert.match(rendererSource, /const STUDY_RECOVERY_CONFIRM_SECONDS = 5;/);
assert.match(rendererSource, /rearmQuietSeconds: STUDY_RECOVERY_CONFIRM_SECONDS/);
assert.match(rendererSource, /evidenceGapSeconds: STUDY_RECOVERY_CONFIRM_SECONDS/);
assert.doesNotMatch(rendererSource, /resetPreflightDetectionAfterSettingChange/);

console.log(JSON.stringify({
  keyboardLabelsCovered: 5,
  mediaLabelsCovered: 36,
  explicitSpeechThresholdCovered: true,
  substringLookalikesRejected: true,
  silenceKeyboardAndFanSnapshotsAllowed: true,
  loudKeyboardDoesNotMaskMedia: true,
  weakKeyboardSideLabelsDoNotTrigger: true,
  keyboardMaskedMusicUsesSpecificCorroboration: true,
  strongNonStudySoundFallbackCovered: true,
  directClassificationAndProbabilityBoundariesCovered: true,
  adjustableViolationSecondsCovered: [3, 15],
  genericGapTolerancePolicyCovered: true,
  genericGapExpiryPolicyCovered: true,
  overlappingWindowsDeduplicated: true,
  activeSettingChangesPreserveEvidence: true,
  automaticReciteVoiceGateCovered: true,
  isolatedStudyTransientsDoNotAccumulate: true,
  continuousTransientAudioEscalates: true,
  studyNoiseFloorGateRemoved: true,
  studyUsesFiveSecondRecoveryTolerance: true,
  uiStarted: false,
  microphoneAccessed: false,
  profileAccessed: false,
  networkAccessed: false,
}));
