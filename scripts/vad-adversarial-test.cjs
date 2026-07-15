const assert = require('node:assert/strict');
const { AdaptiveVoiceDetector } = require('../renderer/adaptive-vad.js');
const { QuietModeDetector } = require('../renderer/study-policy.js');

const FRAME_MS = 100;

function frame(db, overrides = {}) {
  return {
    db,
    voiceRatio: 0.58,
    flatness: 0.36,
    flux: 0.006,
    ...overrides,
  };
}

function calibratedFanDetector() {
  const detector = new AdaptiveVoiceDetector({ calibrationFrames: 30, sensitivityDb: 8 });
  for (let index = 0; index < 30; index += 1) {
    const result = detector.process(frame(-42 + ((index % 3) - 1) * 0.18));
    assert.equal(typeof result.speechEvidence, 'boolean', 'calibration result omitted raw speechEvidence');
    assert.equal(Number.isFinite(result.amplitudeChangeDb), true, 'calibration result omitted amplitudeChangeDb');
    assert.ok(result.amplitudeChangeDb >= 0, 'amplitudeChangeDb must be non-negative');
  }
  assert.equal(detector.calibrated, true, 'fan baseline calibration did not finish');
  return detector;
}

const stableFan = calibratedFanDetector();
let fanSpeechFrames = 0;
let fanEvidenceFrames = 0;
for (let index = 0; index < 80; index += 1) {
  const result = stableFan.process(frame(-41.8 + ((index % 5) - 2) * 0.12));
  if (result.isSpeech) fanSpeechFrames += 1;
  if (result.speechEvidence) fanEvidenceFrames += 1;
  assert.equal(Number.isFinite(result.amplitudeChangeDb), true, 'steady-fan result omitted amplitudeChangeDb');
  assert.ok(result.amplitudeChangeDb <= 0.6, 'steady fan reported an implausible amplitude jump');
}
assert.equal(fanSpeechFrames, 0, 'stable fan noise was classified as speech');
assert.equal(fanEvidenceFrames, 0, 'stable fan noise produced raw speech evidence');

const speechDetector = calibratedFanDetector();
const speechPattern = [-32, -27, -30, -24, -29, -25, -31, -26];
const speechResults = speechPattern.map((db, index) => speechDetector.process(frame(db, {
  voiceRatio: 0.7,
  flatness: 0.42,
  flux: index === 0 ? 0.08 : 0.11,
})));
assert.equal(
  speechResults.every((result) => result.speechEvidence === true),
  true,
  'modulated human speech did not expose continuous raw speechEvidence',
);
assert.equal(
  speechResults.every((result) => Number.isFinite(result.amplitudeChangeDb) && result.amplitudeChangeDb >= 0),
  true,
  'human-speech results omitted a valid amplitudeChangeDb',
);
assert.ok(speechResults[0].amplitudeChangeDb > 8, 'speech onset amplitude change was not exposed');
assert.equal(speechResults.some((result) => result.isSpeech), true, 'modulated human speech was not detected');
assert.ok(speechResults.findIndex((result) => result.isSpeech) <= 2, 'speech detection took longer than 300 ms');

let returnedToSilence = false;
for (let index = 0; index < 20; index += 1) {
  const result = speechDetector.process(frame(-42 + (index % 2) * 0.1));
  if (!result.isSpeech) returnedToSilence = true;
}
assert.equal(returnedToSilence, true, 'speech hangover never returned to silence');

const changedFan = calibratedFanDetector();
let changedFanSpeechFrames = 0;
let changedFanResult;
for (let index = 0; index < 60; index += 1) {
  changedFanResult = changedFan.process(frame(-34 + ((index % 4) - 1.5) * 0.1));
  if (changedFanResult.isSpeech) changedFanSpeechFrames += 1;
}
assert.equal(changedFanSpeechFrames, 0, 'a fan speed change was classified as speech');
assert.ok(changedFanResult.noiseFloorDb > -36, 'adaptive noise floor did not learn the changed fan level');

function keyFrame(db = -24) {
  return frame(db, {
    voiceRatio: 0.7,
    flatness: 0.5,
    flux: 0.1,
  });
}

function fanFrame(index = 0) {
  return frame(-42 + (index % 2) * 0.1);
}

// A single 100 ms impulse can be raw evidence, but it cannot become a quiet-mode violation.
const singleKeyVad = calibratedFanDetector();
const singleKeyPolicy = new QuietModeDetector({ violationSeconds: 3, frameMs: FRAME_MS });
const singleKeyResult = singleKeyVad.process(keyFrame());
assert.equal(singleKeyResult.speechEvidence, true, 'single-key onset was not exposed as raw evidence');
assert.ok(singleKeyResult.amplitudeChangeDb > 10, 'single-key amplitude jump was not exposed');
let policyResult = singleKeyPolicy.process(singleKeyResult, FRAME_MS);
assert.equal(policyResult.violated, false, 'single key caused an immediate quiet-mode violation');
assert.equal(policyResult.suspectedSpeechMs, FRAME_MS);
for (let index = 0; index < 20; index += 1) {
  policyResult = singleKeyPolicy.process(singleKeyVad.process(fanFrame(index)), FRAME_MS);
  assert.equal(policyResult.violated, false, 'single key accumulated through later silence');
}
assert.equal(singleKeyPolicy.snapshot().suspectedSpeechMs, 0, 'single-key candidate did not reset on silence');

// Two adjacent keyboard frames are enough to start VAD hangover. The policy must consume
// speechEvidence, not isSpeech, so that hangover frames reset rather than extend the candidate.
const twoFrameKeyVad = calibratedFanDetector();
const twoFrameKeyPolicy = new QuietModeDetector({ violationSeconds: 3, frameMs: FRAME_MS });
for (const db of [-24, -23]) {
  const result = twoFrameKeyVad.process(keyFrame(db));
  assert.equal(result.speechEvidence, true, 'two-frame key impulse lost raw evidence');
  assert.equal(twoFrameKeyPolicy.process(result, FRAME_MS).violated, false);
}
let hangoverFrames = 0;
for (let index = 0; index < 20; index += 1) {
  const result = twoFrameKeyVad.process(fanFrame(index));
  policyResult = twoFrameKeyPolicy.process(result, FRAME_MS);
  if (result.isSpeech && !result.speechEvidence) {
    hangoverFrames += 1;
    assert.equal(policyResult.evidence, false, 'VAD hangover was promoted to raw policy evidence');
    assert.equal(policyResult.suspectedSpeechMs, 0, 'VAD hangover extended a keyboard candidate');
  }
  assert.equal(policyResult.violated, false, 'two-frame key impulse plus VAD hangover violated');
}
assert.ok(hangoverFrames > 0, 'two-frame key fixture did not exercise VAD hangover');

// At a 100 ms analysis cadence, alternating impulse/quiet frames model 5 Hz typing.
// isSpeech remains high for much of the sequence, while raw evidence has a quiet gap
// after every impulse and therefore must never reach the continuous-speech threshold.
const rapidKeysVad = calibratedFanDetector();
const rapidKeysPolicy = new QuietModeDetector({ violationSeconds: 3, frameMs: FRAME_MS });
let rapidKeyVadSpeechFrames = 0;
let rapidKeyEvidenceFrames = 0;
let maximumRapidKeyCandidateMs = 0;
for (let index = 0; index < 120; index += 1) {
  const impulse = index % 2 === 0;
  const result = rapidKeysVad.process(impulse ? keyFrame(-24 - (index % 4)) : fanFrame(index));
  policyResult = rapidKeysPolicy.process(result, FRAME_MS);
  if (result.isSpeech) rapidKeyVadSpeechFrames += 1;
  if (result.speechEvidence) rapidKeyEvidenceFrames += 1;
  maximumRapidKeyCandidateMs = Math.max(maximumRapidKeyCandidateMs, policyResult.suspectedSpeechMs);
  assert.equal(policyResult.violated, false, '5 Hz keyboard pulses accumulated into a violation');
}
assert.ok(rapidKeyVadSpeechFrames > 0, '5 Hz fixture did not exercise VAD speech/hangover state');
assert.ok(rapidKeyEvidenceFrames > 0, '5 Hz fixture did not contain raw impulses');
assert.ok(maximumRapidKeyCandidateMs <= FRAME_MS, '5 Hz raw impulses accumulated across quiet gaps');

// Continuous raw human-voice evidence must still violate exactly at a user-adjustable threshold.
const continuousVoiceVad = calibratedFanDetector();
const continuousVoicePolicy = new QuietModeDetector({ violationSeconds: 8, frameMs: FRAME_MS });
assert.equal(continuousVoicePolicy.setViolationSeconds(4), 4);
assert.equal(continuousVoicePolicy.violationThresholdMs(), 4_000);
const continuousVoicePattern = [-30, -25, -29, -24];
for (let index = 0; index < 39; index += 1) {
  const result = continuousVoiceVad.process(frame(continuousVoicePattern[index % 4], {
    voiceRatio: 0.72,
    flatness: 0.42,
    flux: 0.1,
  }));
  assert.equal(result.speechEvidence, true, 'continuous voice fixture lost raw speech evidence');
  assert.equal(continuousVoicePolicy.process(result, FRAME_MS).violated, false, 'voice violated before threshold');
}
const thresholdVoiceResult = continuousVoiceVad.process(frame(continuousVoicePattern[39 % 4], {
  voiceRatio: 0.72,
  flatness: 0.42,
  flux: 0.1,
}));
assert.equal(thresholdVoiceResult.speechEvidence, true);
assert.equal(
  continuousVoicePolicy.process(thresholdVoiceResult, FRAME_MS).violated,
  true,
  'continuous raw voice evidence did not violate at the adjustable threshold',
);

console.log(JSON.stringify({
  stableFanSpeechFrames: fanSpeechFrames,
  stableFanEvidenceFrames: fanEvidenceFrames,
  speechDetectedWithinFrames: speechResults.findIndex((result) => result.isSpeech) + 1,
  changedFanSpeechFrames,
  adaptedNoiseFloorDb: Number(changedFanResult.noiseFloorDb.toFixed(2)),
  twoFrameKeyHangoverFrames: hangoverFrames,
  rapidKeyVadSpeechFrames,
  rapidKeyEvidenceFrames,
  maximumRapidKeyCandidateMs,
  adjustableVoiceViolationSeconds: continuousVoicePolicy.snapshot().violationSeconds,
}));
