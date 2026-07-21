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
  broadcast: 0.12,
  keyboard: 0.18,
  keyboardMixedMedia: 0.10,
  keyboardMixedMediaSecondary: 0.025,
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

// Representative speech/media/broadcast labels must count as prohibited audio.
for (const mediaFixture of [
  { name: 'Speech', prob: 0.21 },
  { name: 'Conversation', prob: 0.21 },
  { name: 'Narration, monologue', prob: 0.21 },
  { name: 'Singing', prob: 0.21 },
  { name: 'Music', prob: 0.21 },
  { name: 'Video game music', prob: 0.21 },
  { name: 'Laughter', prob: 0.21 },
  { name: 'A capella', prob: 0.21 },
  { name: 'Television', prob: 0.13 },
  { name: 'Radio', prob: 0.13 },
]) {
  const result = classify([event(mediaFixture.name, mediaFixture.prob)]);
  assert.equal(result.mediaEvidence, true, `${mediaFixture.name} was not media evidence`);
  assert.equal(result.keyboardOnly, false, `${mediaFixture.name} became keyboard-only`);
}

// Regression for the real failure mode: loud keyboard classification must not
// veto quieter video/speech classification in the same analysis window.
const loudKeyboardQuietSpeech = classify([
  event('Computer keyboard', 0.99),
  event('Speech', 0.205),
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

// When keyboard labels dominate the window, two independent media labels can
// confirm a quieter underlying track. One borderline music label alone is not
// enough because real keyboard recordings can produce that false positive.
const loudKeyboardTwoMediaLabels = classify([
  event('Typing', 0.82),
  event('Computer keyboard', 0.74),
  event('Music', 0.13),
  event('Speech', 0.05),
]);
assert.equal(loudKeyboardTwoMediaLabels.mediaEvidence, true);
assert.equal(loudKeyboardTwoMediaLabels.keyboardMixedMediaEvidence, true);
assert.equal(loudKeyboardTwoMediaLabels.secondaryMediaLabel, 'Speech');

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
assert.equal(classify([event('Speech', 0.199)]).mediaEvidence, false);
assert.equal(classify([event('Speech', 0.20)]).mediaEvidence, true);
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
  keyboardThreshold: 0.80,
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
  evidenceGapSeconds: 1,
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
  evidenceGapSeconds: 1,
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
  evidenceGapSeconds: 1,
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
  evidenceGapSeconds: 1,
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

// Pure-source integration guard: live setting changes must invalidate the
// current rolling buffer and any in-flight classifier generation, not just the
// preflight path.
const rendererSource = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'app.js'), 'utf8');
assert.match(rendererSource, /function resetDetectionAfterSettingChange\(\)/);
assert.match(rendererSource, /const studyActive = isStudyDetectionActive\(\);/);
assert.match(rendererSource, /const reciteActive = isReciteDetectionActive\(\);/);
assert.match(rendererSource, /state\.quietDetector\?\.reset\(\);\s+resetStudyAudioRuntime\(\);/);
assert.match(rendererSource, /studyAudioClassificationGeneration \+= 1;/);
assert.match(rendererSource, /evidenceOverlapSeconds: STUDY_EVENT_OVERLAP_SECONDS/);
assert.match(rendererSource, /const directStudyDetection = state\.mode === 'study';/);
assert.match(rendererSource, /state\.vad = directStudyDetection\s+\? null/);
assert.match(rendererSource, /\? \{ levelPercent: calculateAudioLevelPercent\(\) \}/);
assert.match(rendererSource, /POLICY\.classifyStudyAudioEvents\(result\?\.events\)/);
assert.doesNotMatch(rendererSource, /studySensitivityDb/);
assert.doesNotMatch(rendererSource, /levelDeltaDb: levelDb - state\.latestNoiseFloorDb/);
assert.doesNotMatch(rendererSource, /evidenceGapSeconds:/);
assert.doesNotMatch(rendererSource, /resetPreflightDetectionAfterSettingChange/);

console.log(JSON.stringify({
  keyboardLabelsCovered: 5,
  mediaLabelsCovered: 10,
  loudKeyboardDoesNotMaskMedia: true,
  directClassificationAndProbabilityBoundariesCovered: true,
  adjustableViolationSecondsCovered: [3, 15],
  genericGapTolerancePolicyCovered: true,
  genericGapExpiryPolicyCovered: true,
  overlappingWindowsDeduplicated: true,
  liveSettingChangeInvalidatesRollingAudio: true,
  studyNoiseFloorGateRemoved: true,
  studyRequiresConsecutiveClassifierEvidence: true,
  uiStarted: false,
  microphoneAccessed: false,
  profileAccessed: false,
  networkAccessed: false,
}));
