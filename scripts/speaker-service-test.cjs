const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const sherpa = require('sherpa-onnx-node');
const { SpeakerService, constants } = require('../speaker-service');

assert.equal(constants.VERIFICATION_THRESHOLD, 0.55);
assert.equal(constants.STRONG_MATCH_THRESHOLD, 0.70);

const root = path.resolve(__dirname, '..');
const dataRoot = path.join(root, 'work', `speaker-service-test-data-${process.pid}`);
const fixtures = path.join(root, 'work', 'speaker-fixtures');
const modelPath = path.join(root, 'models', '3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx');
const workerPath = path.join(root, 'speaker-worker.js');
let profileWriteGate = null;
const profileCrypto = {
  isAvailable: async () => true,
  encryptString: async (value) => {
    const gate = profileWriteGate;
    if (gate) {
      profileWriteGate = null;
      gate.enter();
      await gate.wait;
    }
    return Buffer.from(value, 'utf8');
  },
  decryptString: async (value) => Buffer.from(value).toString('utf8'),
};

function blockNextProfileWrite() {
  let release;
  let enter;
  const entered = new Promise((resolve) => { enter = resolve; });
  const wait = new Promise((resolve) => { release = resolve; });
  profileWriteGate = { enter, wait };
  return { entered, release };
}

function wave(name) {
  const result = sherpa.readWave(path.join(fixtures, name), false);
  return { samples: result.samples, sampleRate: result.sampleRate };
}

function waveSegment(name, startSeconds, durationSeconds) {
  const result = wave(name);
  const start = Math.round(result.sampleRate * startSeconds);
  const end = start + Math.round(result.sampleRate * durationSeconds);
  return {
    samples: result.samples.slice(start, end),
    sampleRate: result.sampleRate,
  };
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
  return service.addEnrollmentSample({
    enrollmentId: service.getState().enrollmentId,
    source,
    ...audio,
  });
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
  await fsp.mkdir(dataRoot, { recursive: true });
  const service = new SpeakerService({ workerPath, modelPath, dataRoot, profileCrypto });
  let state = await service.initialize();
  assert.equal(state.ready, true);
  assert.equal(state.profileExists, false);

  await service.beginEnrollment();
  await assert.rejects(
    () => add(service, 'import', 'fangjun-sr-1.wav'),
    /来源无效/,
  );
  await assert.rejects(
    () => service.addEnrollmentSample({
      enrollmentId: service.getState().enrollmentId,
      source: 'mic',
      ...syntheticFan(),
    }),
    /连续朗读/,
  );
  await enrollOwner(service);
  state = await service.finishEnrollment({ enrollmentId: service.getState().enrollmentId });
  assert.equal(state.profileExists, true);
  assert.equal(state.profileCount, 1);

  const owner = await service.verify(wave('fangjun-test-sr-1.wav'));
  const other = await service.verify(wave('leijun-test-sr-1.wav'));
  const ownerQuick = await service.verify(waveSegment('fangjun-test-sr-1.wav', 0, 2));
  const otherQuick = await service.verify(waveSegment('leijun-test-sr-1.wav', 0, 2));
  assert.equal(owner.matched, true);
  assert.equal(other.matched, false);
  assert.ok(owner.score >= owner.threshold);
  assert.ok(other.score < other.threshold);
  assert.ok(
    ownerQuick.score >= 0.74,
    `known owner must clear the strict two-second fast path (score=${ownerQuick.score})`,
  );
  assert.ok(otherQuick.score < 0.74, 'known other speaker must not clear the fast path');

  const files = await fsp.readdir(dataRoot);
  assert.deepEqual(files, ['speaker-profile.dat']);
  assert.equal(files.some((name) => /\.(wav|pcm|mp3|m4a)$/iu.test(name)), false);
  const storedProfile = JSON.parse(await fsp.readFile(path.join(dataRoot, 'speaker-profile.dat'), 'utf8'));
  assert.equal(storedProfile.schemaVersion, 3);
  assert.equal(storedProfile.profiles.length, 1);
  assert.equal(storedProfile.profiles[0].embeddings.length, 6);

  // A second local template is retained instead of replacing the first one.
  await service.beginEnrollment();
  await enrollOwner(service);
  state = await service.finishEnrollment({ enrollmentId: service.getState().enrollmentId });
  assert.equal(state.profileCount, 2);
  await service.dispose();

  const reloaded = new SpeakerService({ workerPath, modelPath, dataRoot, profileCrypto });
  state = await reloaded.initialize();
  assert.equal(state.ready, true);
  assert.equal(state.profileExists, true);
  assert.equal(state.profileCount, 2);
  assert.equal((await reloaded.verify(wave('fangjun-test-sr-1.wav'))).matched, true);

  // The robust 8 -> 6 selector must discard up to two contaminated candidates.
  await reloaded.beginEnrollment();
  for (const name of [
    'fangjun-sr-1.wav', 'fangjun-sr-2.wav', 'fangjun-sr-3.wav',
    'fangjun-sr-1.wav', 'fangjun-sr-2.wav', 'fangjun-sr-3.wav',
    'leijun-sr-1.wav', 'leijun-sr-2.wav',
  ]) await add(reloaded, 'mic', name);
  await reloaded.finishEnrollment({ enrollmentId: reloaded.getState().enrollmentId });
  state = reloaded.getState();
  assert.equal(state.profileCount, 3);
  assert.equal((await reloaded.verify(wave('fangjun-test-sr-1.wav'))).matched, true);
  assert.equal((await reloaded.verify(wave('leijun-test-sr-1.wav'))).matched, false);

  const profilePath = path.join(dataRoot, 'speaker-profile.dat');
  const beforeInvalidDelete = await fsp.readFile(profilePath);
  await assert.rejects(
    () => reloaded.deleteProfileArtifact(),
    (error) => error?.code === 'PROFILE_USABLE',
  );
  assert.deepEqual(await fsp.readFile(profilePath), beforeInvalidDelete);
  assert.equal(reloaded.getState().profileCount, 3);
  for (const invalidProfileId of [undefined, null, '', '   ', '../speaker-profile.dat', 'not-a-uuid']) {
    await assert.rejects(
      () => reloaded.deleteProfile(invalidProfileId),
      /有效声纹/,
    );
    assert.deepEqual(await fsp.readFile(profilePath), beforeInvalidDelete);
    assert.equal(reloaded.getState().profileCount, 3);
  }
  await assert.rejects(
    () => reloaded.deleteProfile('00000000-0000-4000-8000-000000000099'),
    /未找到要删除的声纹/,
  );
  assert.deepEqual(await fsp.readFile(profilePath), beforeInvalidDelete);

  // Canceling while finishEnrollment is inside an asynchronous encrypted write
  // must invalidate the server-side enrollment before anything is committed.
  await reloaded.beginEnrollment();
  await enrollOwner(reloaded);
  const canceledEnrollmentId = reloaded.getState().enrollmentId;
  const beforeCanceledFinish = await fsp.readFile(profilePath);
  const writeGate = blockNextProfileWrite();
  const finishing = reloaded.finishEnrollment({ enrollmentId: canceledEnrollmentId });
  await writeGate.entered;
  const canceling = reloaded.cancelEnrollment({ enrollmentId: canceledEnrollmentId });
  writeGate.release();
  await assert.rejects(finishing, (error) => error?.code === 'ENROLLMENT_CANCELLED');
  await canceling;
  assert.equal(reloaded.getState().profileCount, 3);
  assert.deepEqual(await fsp.readFile(profilePath), beforeCanceledFinish);

  await reloaded.deleteProfile(state.profiles[0].id);
  state = reloaded.getState();
  assert.equal(state.profileCount, 2);
  assert.equal((await reloaded.verify(wave('fangjun-test-sr-1.wav'))).matched, true);
  for (const profile of [...state.profiles]) await reloaded.deleteProfile(profile.id);
  assert.equal(fs.existsSync(path.join(dataRoot, 'speaker-profile.dat')), false);
  await reloaded.dispose();

  const legacyProfile = {
    schemaVersion: 2,
    modelHash: storedProfile.modelHash,
    dimension: storedProfile.dimension,
    createdAt: storedProfile.profiles[0].createdAt,
    threshold: storedProfile.threshold,
    strongThreshold: storedProfile.strongThreshold,
    embeddings: storedProfile.profiles[0].embeddings,
  };
  await fsp.writeFile(path.join(dataRoot, 'speaker-profile.dat'), JSON.stringify(legacyProfile));
  const legacy = new SpeakerService({ workerPath, modelPath, dataRoot, profileCrypto });
  state = await legacy.initialize();
  assert.equal(state.profileExists, true);
  assert.equal(state.profileCount, 1);
  assert.equal(state.profiles[0].label, '原有声纹');
  assert.equal((await legacy.verify(wave('fangjun-test-sr-1.wav'))).matched, true);
  await legacy.deleteProfile(state.profiles[0].id);
  await legacy.dispose();

  await fsp.writeFile(path.join(dataRoot, 'speaker-profile.dat'), Buffer.from('{broken'));
  const corrupted = new SpeakerService({ workerPath, modelPath, dataRoot, profileCrypto });
  state = await corrupted.initialize();
  assert.equal(state.ready, true);
  assert.equal(state.profileExists, false);
  assert.equal(state.profileArtifactExists, true);
  assert.ok(state.error);
  assert.equal((await corrupted.verify(wave('fangjun-test-sr-1.wav'))).matched, false);
  const corruptProfileBeforeRejectedDelete = await fsp.readFile(profilePath);
  await assert.rejects(() => corrupted.deleteProfile(), /有效声纹/);
  assert.deepEqual(await fsp.readFile(profilePath), corruptProfileBeforeRejectedDelete);
  const orphan = path.join(dataRoot, 'speaker-profile.dat.tmp-123-00000000-0000-4000-8000-000000000001');
  const unrelated = path.join(dataRoot, 'keep-me.txt');
  await fsp.writeFile(orphan, Buffer.from('encrypted-temp'));
  await fsp.writeFile(unrelated, 'keep');
  state = await corrupted.deleteProfileArtifact();
  assert.equal(state.profileArtifactExists, false);
  assert.equal(fs.existsSync(profilePath), false);
  assert.equal(fs.existsSync(orphan), false);
  assert.equal(fs.existsSync(unrelated), true);
  await corrupted.dispose();

  await fsp.writeFile(profilePath, Buffer.alloc(1));
  await fsp.truncate(profilePath, constants.MAX_PROFILE_FILE_BYTES + 1);
  const oversized = new SpeakerService({ workerPath, modelPath, dataRoot, profileCrypto });
  state = await oversized.initialize();
  assert.equal(state.ready, true);
  assert.equal(state.profileExists, false);
  assert.equal(state.profileArtifactExists, true);
  assert.ok(state.error);
  await oversized.deleteProfileArtifact();
  assert.equal(fs.existsSync(profilePath), false);
  await oversized.dispose();

  await fsp.rm(dataRoot, { recursive: true, force: true });

  console.log(JSON.stringify({
    ownerScore: Number(owner.score.toFixed(3)),
    otherScore: Number(other.score.toFixed(3)),
    ownerQuickScore: Number(ownerQuick.score.toFixed(3)),
    otherQuickScore: Number(otherQuick.score.toFixed(3)),
    threshold: owner.threshold,
    rawAudioPersisted: false,
    importSourceRejected: true,
    fanOnlyEnrollmentRejected: true,
    profileReloaded: true,
    contaminatedCandidatesDropped: true,
    multipleProfilesRetained: true,
    invalidProfileDeleteRejected: true,
    usableProfileArtifactDeleteRejected: true,
    inFlightEnrollmentCancelRolledBack: true,
    legacyProfileMigratedInMemory: true,
    corruptProfileFailedClosed: true,
    corruptProfileUserDeletable: true,
    oversizedProfileRejectedBeforeRead: true,
  }));
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
