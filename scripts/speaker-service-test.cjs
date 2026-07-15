const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const sherpa = require('sherpa-onnx-node');
const { SpeakerService, constants } = require('../speaker-service');

assert.equal(constants.VERIFICATION_THRESHOLD, 0.55);
assert.equal(constants.STRONG_MATCH_THRESHOLD, 0.70);

const root = path.resolve(__dirname, '..');
const dataRoot = path.join(root, 'work', 'speaker-service-test-data');
const fixtures = path.join(root, 'work', 'speaker-fixtures');
const modelPath = path.join(root, 'models', '3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx');
const workerPath = path.join(root, 'speaker-worker.js');
const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(value, 'utf8'),
  decryptString: (value) => Buffer.from(value).toString('utf8'),
};

function wave(name) {
  const result = sherpa.readWave(path.join(fixtures, name), false);
  return { samples: result.samples, sampleRate: result.sampleRate };
}

function syntheticFan() {
  const sampleRate = 16_000;
  const samples = new Float32Array(Math.round(sampleRate * 2.4));
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = (0.035 * Math.sin(2 * Math.PI * 120 * index / sampleRate))
      + (0.02 * Math.sin(2 * Math.PI * 240 * index / sampleRate))
      + (0.01 * Math.sin(2 * Math.PI * 360 * index / sampleRate));
  }
  return { samples, sampleRate };
}

async function add(service, source, name) {
  const audio = wave(name);
  return service.addEnrollmentSample({ source, ...audio });
}

async function enrollOwner(service) {
  for (const name of [
    'fangjun-sr-1.wav',
    'fangjun-sr-2.wav',
    'fangjun-sr-3.wav',
    'fangjun-sr-1.wav',
    'fangjun-sr-2.wav',
    'fangjun-sr-3.wav',
    'fangjun-sr-1.wav',
    'fangjun-sr-2.wav',
  ]) {
    await add(service, 'mic', name);
  }
}

async function run() {
  await fsp.rm(dataRoot, { recursive: true, force: true });
  const service = new SpeakerService({ workerPath, modelPath, dataRoot, safeStorage });
  let state = await service.initialize();
  assert.equal(state.ready, true);
  assert.equal(state.profileExists, false);

  await service.beginEnrollment();
  await assert.rejects(
    () => add(service, 'import', 'fangjun-sr-1.wav'),
    /来源无效/,
  );
  await assert.rejects(
    () => service.addEnrollmentSample({ source: 'mic', ...syntheticFan() }),
    /连续朗读/,
  );
  await enrollOwner(service);
  state = await service.finishEnrollment();
  assert.equal(state.profileExists, true);

  const owner = await service.verify(wave('fangjun-test-sr-1.wav'));
  const other = await service.verify(wave('leijun-test-sr-1.wav'));
  assert.equal(owner.matched, true);
  assert.equal(other.matched, false);
  assert.ok(owner.score >= owner.threshold);
  assert.ok(other.score < other.threshold);

  const files = await fsp.readdir(dataRoot);
  assert.deepEqual(files, ['speaker-profile.dat']);
  assert.equal(files.some((name) => /\.(wav|pcm|mp3|m4a)$/iu.test(name)), false);
  const storedProfile = JSON.parse(await fsp.readFile(path.join(dataRoot, 'speaker-profile.dat'), 'utf8'));
  assert.equal(storedProfile.schemaVersion, 2);
  assert.equal(storedProfile.embeddings.length, 6);

  // Overwrite the same profile path to exercise Windows atomic replacement.
  await service.beginEnrollment();
  await enrollOwner(service);
  await service.finishEnrollment();
  await service.dispose();

  const reloaded = new SpeakerService({ workerPath, modelPath, dataRoot, safeStorage });
  state = await reloaded.initialize();
  assert.equal(state.ready, true);
  assert.equal(state.profileExists, true);
  assert.equal((await reloaded.verify(wave('fangjun-test-sr-1.wav'))).matched, true);

  // The robust 8 -> 6 selector must discard up to two contaminated candidates.
  await reloaded.beginEnrollment();
  for (const name of [
    'fangjun-sr-1.wav', 'fangjun-sr-2.wav', 'fangjun-sr-3.wav',
    'fangjun-sr-1.wav', 'fangjun-sr-2.wav', 'fangjun-sr-3.wav',
    'leijun-sr-1.wav', 'leijun-sr-2.wav',
  ]) await add(reloaded, 'mic', name);
  await reloaded.finishEnrollment();
  assert.equal((await reloaded.verify(wave('fangjun-test-sr-1.wav'))).matched, true);
  assert.equal((await reloaded.verify(wave('leijun-test-sr-1.wav'))).matched, false);

  await reloaded.deleteProfile();
  assert.equal(fs.existsSync(path.join(dataRoot, 'speaker-profile.dat')), false);
  await reloaded.dispose();

  await fsp.writeFile(path.join(dataRoot, 'speaker-profile.dat'), Buffer.from('{broken'));
  const corrupted = new SpeakerService({ workerPath, modelPath, dataRoot, safeStorage });
  state = await corrupted.initialize();
  assert.equal(state.ready, true);
  assert.equal(state.profileExists, false);
  assert.ok(state.error);
  assert.equal((await corrupted.verify(wave('fangjun-test-sr-1.wav'))).matched, false);
  await corrupted.deleteProfile();
  await corrupted.dispose();
  await fsp.rm(dataRoot, { recursive: true, force: true });

  console.log(JSON.stringify({
    ownerScore: Number(owner.score.toFixed(3)),
    otherScore: Number(other.score.toFixed(3)),
    threshold: owner.threshold,
    rawAudioPersisted: false,
    importSourceRejected: true,
    fanOnlyEnrollmentRejected: true,
    profileReloaded: true,
    contaminatedCandidatesDropped: true,
    corruptProfileFailedClosed: true,
  }));
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
