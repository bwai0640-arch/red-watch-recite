const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { scoreEnrolledProfiles } = require('../speaker-worker');

const root = path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'renderer', 'app.js'), 'utf8');
const serviceSource = fs.readFileSync(path.join(root, 'speaker-service.js'), 'utf8');
const workerSource = fs.readFileSync(path.join(root, 'speaker-worker.js'), 'utf8');

const quickConfirmed = (matched, score) => Boolean(matched && score >= 0.74);
assert.equal(quickConfirmed(true, 0.74), true);
assert.equal(quickConfirmed(true, 0.739), false);
assert.equal(quickConfirmed(false, 0.99), false);

assert.match(appSource, /const SPEAKER_QUICK_WINDOW_SECONDS = 2;/);
assert.match(appSource, /const SPEAKER_QUICK_CONFIRM_THRESHOLD = 0\.74;/);
assert.match(appSource, /const SPEAKER_WINDOW_SECONDS = 2\.4;/);
assert.match(appSource, /const SPEAKER_CONFIRM_HOLD_MS = 2_500;/);
assert.match(
  appSource,
  /const quickConfirmed = quickProbe\s*&& matched\s*&& score >= SPEAKER_QUICK_CONFIRM_THRESHOLD;/,
);
assert.match(
  appSource,
  /if \(quickProbe && !quickConfirmed\) \{[\s\S]*?state\.lastSpeakerVerificationAt = 0;[\s\S]*?return;/,
);
assert.match(
  appSource,
  /const confirmed = quickConfirmed \|\| \(matched && \(strongMatch \|\| repeatedMatch\)\);/,
);
assert.match(
  appSource,
  /function pumpSpeakerVerification\(sourceSampleRate\)[\s\S]*?state\.speakerSampleCount >= quickLength[\s\S]*?verifyOwnerVoice\(quickSamples, sampleRate, \{ quickProbe: true \}\)/,
);
assert.match(
  appSource,
  /state\.speakerVerificationPending = false;\s*pumpSpeakerVerification\(sourceSampleRate\);/,
);
assert.match(
  appSource,
  /state\.speakerSampleCount \+= chunk\.length;\s*pumpSpeakerVerification\(/,
);

// Accuracy guard: the ordinary and strong model thresholds remain unchanged.
assert.match(serviceSource, /const VERIFICATION_THRESHOLD = 0\.55;/);
assert.match(serviceSource, /const STRONG_MATCH_THRESHOLD = 0\.70;/);
assert.match(workerSource, /function scoreEnrolledProfiles\(/);
assert.match(workerSource, /const matched = score >= threshold;/);
assert.doesNotMatch(workerSource, /manager\.verify\(/);
assert.doesNotMatch(workerSource, /SpeakerEmbeddingManager/);

// The five saved profiles are alternatives, not samples to average into one
// global identity. A query that exactly matches one profile must survive even
// if other environment-specific profiles point elsewhere.
const profiles = [
  { id: 'current-microphone', centroid: Float32Array.from([1, 0, 0]) },
  { id: 'different-room-a', centroid: Float32Array.from([-0.8, 0.6, 0]) },
  { id: 'different-room-b', centroid: Float32Array.from([-0.8, -0.6, 0]) },
];
let profileDecision = scoreEnrolledProfiles(
  Float32Array.from([1, 0, 0]),
  profiles,
  0.55,
  0.70,
);
assert.equal(profileDecision.profileId, 'current-microphone');
assert.equal(profileDecision.matched, true);
assert.equal(profileDecision.strongMatch, true);
assert.equal(profileDecision.score, 1);

profileDecision = scoreEnrolledProfiles(
  Float32Array.from([0.6, 0.8, 0]),
  profiles.slice(0, 1),
  0.55,
  0.70,
);
assert.equal(profileDecision.matched, true);
assert.equal(profileDecision.strongMatch, false);

profileDecision = scoreEnrolledProfiles(
  Float32Array.from([0, 0, 1]),
  profiles,
  0.55,
  0.70,
);
assert.equal(profileDecision.matched, false);
assert.equal(profileDecision.strongMatch, false);

// Model the exact quick/fallback lifecycle: a failed 2.0 s probe remains
// neutral, keeps all PCM, and completion pumps a ready 2.4 s fallback even
// when no later microphone chunk arrives.
const scheduler = {
  pending: false,
  quickCompleted: false,
  sampleCount: 0,
  lastVerificationAt: 0,
  history: [],
  calls: [],
};
function pumpHarness() {
  if (scheduler.pending) return;
  if (!scheduler.quickCompleted && scheduler.sampleCount >= 2_000) {
    scheduler.quickCompleted = true;
    scheduler.pending = true;
    scheduler.calls.push('quick');
    return;
  }
  if (scheduler.sampleCount >= 2_400 && scheduler.lastVerificationAt === 0) {
    scheduler.sampleCount = 600;
    scheduler.pending = true;
    scheduler.calls.push('standard');
  }
}
scheduler.sampleCount = 2_000;
pumpHarness();
assert.deepEqual(scheduler.calls, ['quick']);
scheduler.sampleCount = 2_400; // PCM accumulated while quick inference ran.
const historyBeforeNeutralProbe = [...scheduler.history];
scheduler.lastVerificationAt = 0;
scheduler.pending = false;
pumpHarness(); // called by quick verification finally, with no new PCM event.
assert.deepEqual(scheduler.calls, ['quick', 'standard']);
assert.deepEqual(scheduler.history, historyBeforeNeutralProbe);
assert.equal(scheduler.sampleCount, 600);

console.log(JSON.stringify({
  quickWindowSeconds: 2,
  quickConfirmThreshold: 0.74,
  standardWindowSeconds: 2.4,
  ordinaryThreshold: 0.55,
  strongThreshold: 0.70,
  confirmationHoldSeconds: 2.5,
  bestProfileWins: true,
  quickFallbackPumpedWithoutNewChunk: true,
}));
