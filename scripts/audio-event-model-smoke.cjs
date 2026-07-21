'use strict';

// Pure Node integration smoke test. It never opens Electron, a window, the
// microphone, or a user profile. Optional official WAV fixtures are read from
// BEISHU_AUDIO_EVENT_FIXTURES; no audio is played or written.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sherpa = require('sherpa-onnx-node');
const { AudioEventService } = require('../audio-event-service.js');
const SpeakerAudio = require('../renderer/speaker-audio.js');
const { classifyStudyAudioEvents } = require('../renderer/study-policy.js');

const ROOT = path.resolve(__dirname, '..');
const SAMPLE_RATE = SpeakerAudio.TARGET_SAMPLE_RATE;
const WINDOW_SECONDS = 2;
const WINDOW_SAMPLES = SAMPLE_RATE * WINDOW_SECONDS;

function cropOrRepeat(samples, wanted = WINDOW_SAMPLES) {
  const result = new Float32Array(wanted);
  if (!samples.length) return result;
  for (let index = 0; index < wanted; index += 1) result[index] = samples[index % samples.length];
  return result;
}

function normalizeRms(samples, targetRms) {
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  const rms = Math.sqrt(sum / Math.max(1, samples.length));
  const gain = targetRms / Math.max(rms, 1e-8);
  return Float32Array.from(samples, (sample) => Math.max(-1, Math.min(1, sample * gain)));
}

function syntheticKeyboard() {
  const result = new Float32Array(WINDOW_SAMPLES);
  let seed = 0x12345678;
  const random = () => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  for (let onset = Math.round(0.08 * SAMPLE_RATE); onset < result.length; onset += Math.round(0.115 * SAMPLE_RATE)) {
    const duration = Math.round((0.012 + random() * 0.008) * SAMPLE_RATE);
    const frequency = 2_100 + random() * 2_200;
    for (let offset = 0; offset < duration && onset + offset < result.length; offset += 1) {
      const envelope = Math.exp(-offset / (SAMPLE_RATE * 0.0035));
      const noise = random() * 2 - 1;
      const ring = Math.sin((2 * Math.PI * frequency * offset) / SAMPLE_RATE);
      result[onset + offset] += (0.72 * noise + 0.28 * ring) * envelope;
    }
  }
  return result;
}

function mixWithPeakRatio(media, keyboard, keyboardAboveMediaDb) {
  const mediaRms = 0.035;
  const normalizedMedia = normalizeRms(media, mediaRms);
  let mediaPeak = 0;
  let keyboardPeak = 0;
  for (const sample of normalizedMedia) mediaPeak = Math.max(mediaPeak, Math.abs(sample));
  for (const sample of keyboard) keyboardPeak = Math.max(keyboardPeak, Math.abs(sample));
  const targetKeyboardPeak = mediaPeak * (10 ** (keyboardAboveMediaDb / 20));
  const keyboardGain = targetKeyboardPeak / Math.max(keyboardPeak, 1e-8);
  const mixed = new Float32Array(media.length);
  let mixedPeak = 0;
  for (let index = 0; index < mixed.length; index += 1) {
    mixed[index] = normalizedMedia[index] + keyboard[index] * keyboardGain;
    mixedPeak = Math.max(mixedPeak, Math.abs(mixed[index]));
  }
  if (mixedPeak > 0.98) {
    const scale = 0.98 / mixedPeak;
    for (let index = 0; index < mixed.length; index += 1) mixed[index] *= scale;
  }
  return mixed;
}

function mixWithRmsRatio(media, keyboard, keyboardAboveMediaDb) {
  const normalizedMedia = normalizeRms(media, 0.03);
  const normalizedKeyboard = normalizeRms(keyboard, 0.03 * (10 ** (keyboardAboveMediaDb / 20)));
  const mixed = new Float32Array(normalizedMedia.length);
  let mixedPeak = 0;
  for (let index = 0; index < mixed.length; index += 1) {
    mixed[index] = normalizedMedia[index] + normalizedKeyboard[index];
    mixedPeak = Math.max(mixedPeak, Math.abs(mixed[index]));
  }
  if (mixedPeak > 0.98) {
    const scale = 0.98 / mixedPeak;
    for (let index = 0; index < mixed.length; index += 1) mixed[index] *= scale;
  }
  return mixed;
}

function readWindow(filePath, offsetSeconds = 0) {
  const wave = sherpa.readWave(filePath);
  const source = wave.sampleRate === SAMPLE_RATE
    ? wave.samples
    : SpeakerAudio.resampleLinear(wave.samples, wave.sampleRate, SAMPLE_RATE);
  const offset = Math.max(0, Math.round(Number(offsetSeconds) * SAMPLE_RATE) || 0);
  return cropOrRepeat(source.slice(offset));
}

function policyDecision(events) {
  return classifyStudyAudioEvents(events, { levelDeltaDb: 20, sensitivityDb: 10 });
}

async function main() {
  const service = new AudioEventService({
    workerPath: path.join(ROOT, 'audio-event-worker.js'),
    modelPath: path.join(ROOT, 'models', 'audio-tagging-ced-mini', 'model.int8.onnx'),
    labelsPath: path.join(ROOT, 'models', 'audio-tagging-ced-mini', 'class_labels_indices.csv'),
  });
  try {
    const state = await service.initialize();
    assert.equal(state.ready, true, state.error || 'audio event model did not initialize');

    const silence = await service.classify({ samples: new Float32Array(WINDOW_SAMPLES), sampleRate: SAMPLE_RATE });
    assert.ok(silence.events.length >= 500, `expected the full AudioSet label set, got ${silence.events.length}`);
    assert.equal(policyDecision(silence.events).mediaEvidence, false, 'silence became media evidence');

    const keyboard = syntheticKeyboard();
    const keyboardResult = await service.classify({ samples: keyboard, sampleRate: SAMPLE_RATE });
    assert.equal(policyDecision(keyboardResult.events).mediaEvidence, false, 'synthetic keyboard became media evidence');

    const report = {
      silenceTop: silence.events.slice(0, 5),
      returnedEventCount: silence.events.length,
      keyboardTop: keyboardResult.events.slice(0, 8),
      mediaFixtures: [],
      speechFixture: null,
      realKeyboardFixtures: [],
      failures: [],
    };

    const fixturesRoot = process.env.BEISHU_AUDIO_EVENT_FIXTURES;
    if (process.env.BEISHU_REQUIRE_AUDIO_EVENT_FIXTURES === '1') {
      assert.ok(fixturesRoot, 'BEISHU_AUDIO_EVENT_FIXTURES is required for the release smoke test');
      assert.ok(process.env.BEISHU_KEYBOARD_FIXTURES, 'BEISHU_KEYBOARD_FIXTURES is required for the release smoke test');
      assert.ok(process.env.BEISHU_SPEECH_FIXTURE, 'BEISHU_SPEECH_FIXTURE is required for the release smoke test');
    }
    if (fixturesRoot) {
      const musicPath = path.resolve(fixturesRoot, '3.wav');
      assert.equal(fs.statSync(musicPath).isFile(), true, `missing official music fixture: ${musicPath}`);
      const media = readWindow(musicPath);
      const speechFixturePath = process.env.BEISHU_SPEECH_FIXTURE;
      const speechMedia = speechFixturePath
        ? readWindow(path.resolve(speechFixturePath), Number(process.env.BEISHU_SPEECH_OFFSET_SECONDS) || 30)
        : null;
      if (speechMedia) {
        const speechResult = await service.classify({ samples: speechMedia, sampleRate: SAMPLE_RATE });
        const speechDecision = policyDecision(speechResult.events);
        assert.equal(
          speechDecision.mediaEvidence,
          true,
          `official speech was not detected: ${JSON.stringify(speechResult.events.slice(0, 10))}`,
        );
        report.speechFixture = {
          mediaLabel: speechDecision.mediaLabel,
          mediaScore: speechDecision.mediaScore,
          top: speechResult.events.slice(0, 8),
        };
      }
      for (const keyboardAboveMediaDb of [0, 6, 12, 18]) {
        const samples = keyboardAboveMediaDb === 0 ? media : mixWithPeakRatio(media, keyboard, keyboardAboveMediaDb);
        const classified = await service.classify({ samples, sampleRate: SAMPLE_RATE });
        const decision = policyDecision(classified.events);
        assert.equal(
          decision.mediaEvidence,
          true,
          `official music was masked by keyboard peaks at +${keyboardAboveMediaDb} dB: ${JSON.stringify(classified.events.slice(0, 10))}`,
        );
        report.mediaFixtures.push({
          keyboardAboveMediaDb,
          elapsedMs: classified.elapsedMs,
          mediaLabel: decision.mediaLabel,
          mediaScore: decision.mediaScore,
          top: classified.events.slice(0, 8),
        });
      }

      const keyboardFixturesRoot = process.env.BEISHU_KEYBOARD_FIXTURES;
      if (keyboardFixturesRoot) {
        const keyboardFiles = fs.readdirSync(keyboardFixturesRoot)
          .filter((name) => name.toLocaleLowerCase('en-US').endsWith('.wav'))
          .sort();
        assert.ok(keyboardFiles.length >= 3, 'expected at least three real keyboard fixtures');
        for (const fileName of keyboardFiles) {
          const realKeyboard = readWindow(path.resolve(keyboardFixturesRoot, fileName));
          const normalizedKeyboard = normalizeRms(realKeyboard, 0.10);
          const keyboardOnly = await service.classify({ samples: normalizedKeyboard, sampleRate: SAMPLE_RATE });
          const keyboardOnlyDecision = policyDecision(keyboardOnly.events);
          if (keyboardOnlyDecision.mediaEvidence) {
            report.failures.push({ kind: 'keyboard-only', fileName, top: keyboardOnly.events.slice(0, 10) });
          }

          const mixed = mixWithRmsRatio(media, realKeyboard, 12);
          const mixedResult = await service.classify({ samples: mixed, sampleRate: SAMPLE_RATE });
          const mixedDecision = policyDecision(mixedResult.events);
          if (!mixedDecision.mediaEvidence) {
            report.failures.push({ kind: 'keyboard-masked-media', fileName, top: mixedResult.events.slice(0, 10) });
          }
          let mixedSpeechResult = null;
          let mixedSpeechDecision = null;
          if (speechMedia) {
            const mixedSpeech = mixWithRmsRatio(speechMedia, realKeyboard, 12);
            mixedSpeechResult = await service.classify({ samples: mixedSpeech, sampleRate: SAMPLE_RATE });
            mixedSpeechDecision = policyDecision(mixedSpeechResult.events);
            if (!mixedSpeechDecision.mediaEvidence) {
              report.failures.push({
                kind: 'keyboard-masked-speech',
                fileName,
                top: mixedSpeechResult.events.slice(0, 10),
              });
            }
          }
          report.realKeyboardFixtures.push({
            fileName,
            keyboardOnlyTop: keyboardOnly.events.slice(0, 8),
            mixedMediaLabel: mixedDecision.mediaLabel,
            mixedMediaScore: mixedDecision.mediaScore,
            mixedTop: mixedResult.events.slice(0, 8),
            mixedSpeechLabel: mixedSpeechDecision?.mediaLabel || '',
            mixedSpeechScore: mixedSpeechDecision?.mediaScore || 0,
            mixedSpeechTop: mixedSpeechResult?.events.slice(0, 8) || [],
          });
        }
      }
    }

    console.log(JSON.stringify(report, null, 2));
    assert.deepEqual(report.failures, [], `audio event fixture failures: ${JSON.stringify(report.failures)}`);
  } finally {
    await service.dispose();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
