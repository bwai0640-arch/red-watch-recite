const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

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
assert.match(workerSource, /const matched = score >= threshold;/);
assert.doesNotMatch(workerSource, /manager\.verify\(/);

console.log(JSON.stringify({
  quickWindowSeconds: 2,
  quickConfirmThreshold: 0.74,
  standardWindowSeconds: 2.4,
  ordinaryThreshold: 0.55,
  strongThreshold: 0.70,
  confirmationHoldSeconds: 2.5,
}));
