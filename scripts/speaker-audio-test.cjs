const assert = require('node:assert/strict');
const SpeakerAudio = require('../renderer/speaker-audio');

const source = new Float32Array(48_000 * 2);
for (let index = 0; index < source.length; index += 1) {
  source[index] = 0.1 * Math.sin(2 * Math.PI * 220 * index / 48_000);
}
const resampled = SpeakerAudio.resampleLinear(source, 48_000, 16_000);
assert.equal(resampled.length, 32_000);
assert.ok(SpeakerAudio.analyzeQuality(resampled).rms > 0.05);

const recording = new Float32Array(16_000 * 24);
for (let index = 0; index < recording.length; index += 1) {
  recording[index] = 0.08 * Math.sin(2 * Math.PI * 180 * index / 16_000);
}
const windows = SpeakerAudio.selectVoiceWindows(recording, 16_000, {
  count: 8,
  durationSeconds: 2.4,
  minimumDurationSeconds: 22,
});
assert.equal(windows.length, 8);
assert.ok(windows.every((window) => window.length === 38_400));

const steadyFanDynamics = SpeakerAudio.analyzeDynamics(recording, 16_000);
assert.ok(steadyFanDynamics.standardDeviationDb < 2 && steadyFanDynamics.spreadDb < 6);

const speechLike = new Float32Array(16_000 * 24);
for (let index = 0; index < speechLike.length; index += 1) {
  const envelope = [0.015, 0.04, 0.09, 0.025][Math.floor(index / 3_200) % 4];
  speechLike[index] = envelope * Math.sin(2 * Math.PI * 190 * index / 16_000);
}
const speechDynamics = SpeakerAudio.analyzeDynamics(speechLike, 16_000);
assert.ok(speechDynamics.standardDeviationDb >= 2 && speechDynamics.spreadDb >= 6);

assert.throws(
  () => SpeakerAudio.selectVoiceWindows(new Float32Array(16_000 * 30), 16_000),
  /人声太轻/,
);

console.log(JSON.stringify({
  resampledSamples: resampled.length,
  selectedWindows: windows.length,
  windowSamples: windows[0].length,
  steadyFanSpreadDb: Number(steadyFanDynamics.spreadDb.toFixed(2)),
  speechSpreadDb: Number(speechDynamics.spreadDb.toFixed(2)),
}));
