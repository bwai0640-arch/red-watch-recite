'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { parentPort, workerData } = require('node:worker_threads');

const MIN_SAMPLE_RATE = 8_000;
const MAX_SAMPLE_RATE = 96_000;
const MIN_SAMPLE_SECONDS = 1.5;
const MAX_SAMPLE_SECONDS = 6;
const MAX_ABSOLUTE_SAMPLE = 1.25;

let tagger = null;
let initializationError = null;

function serviceError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function validateSamples(payload) {
  const sampleRate = Number(payload?.sampleRate);
  if (!Number.isInteger(sampleRate) || sampleRate < MIN_SAMPLE_RATE || sampleRate > MAX_SAMPLE_RATE) {
    throw serviceError('INVALID_SAMPLE_RATE', '声音分类采样率无效。');
  }
  if (!(payload?.samples instanceof Float32Array)) {
    throw serviceError('INVALID_AUDIO', '声音分类样本格式无效。');
  }
  const samples = payload.samples;
  const durationSeconds = samples.length / sampleRate;
  if (durationSeconds < MIN_SAMPLE_SECONDS || durationSeconds > MAX_SAMPLE_SECONDS) {
    throw serviceError('INVALID_AUDIO_LENGTH', '声音分类片段长度无效。');
  }
  for (const value of samples) {
    if (!Number.isFinite(value) || Math.abs(value) > MAX_ABSOLUTE_SAMPLE) {
      throw serviceError('INVALID_AUDIO', '声音分类样本包含无效数值。');
    }
  }
  return { samples, sampleRate };
}

function ensureInitialized() {
  if (initializationError) throw initializationError;
  if (!tagger) throw serviceError('MODEL_NOT_READY', '声音分类模型尚未就绪。');
}

function classify(payload) {
  ensureInitialized();
  const { samples, sampleRate } = validateSamples(payload);
  const requestedTopK = Number(payload?.topK);
  const topK = requestedTopK === -1
    ? -1
    : Math.max(1, Math.min(600, Math.round(requestedTopK || 20)));
  const stream = tagger.createStream();
  stream.acceptWaveform({ samples, sampleRate });
  const startedAt = Date.now();
  const events = tagger.compute(stream, topK).map((event) => ({
    name: String(event?.name || ''),
    index: Number(event?.index),
    prob: Number(event?.prob),
  }));
  return { events, elapsedMs: Date.now() - startedAt };
}

try {
  const modelPath = path.resolve(String(workerData?.modelPath || ''));
  const labelsPath = path.resolve(String(workerData?.labelsPath || ''));
  if (!modelPath || !fs.statSync(modelPath).isFile()
    || !labelsPath || !fs.statSync(labelsPath).isFile()) {
    throw serviceError('MODEL_MISSING', '本地声音分类模型不完整。');
  }
  const sherpa = require('sherpa-onnx-node');
  tagger = new sherpa.AudioTagging({
    model: {
      ced: modelPath,
      numThreads: 1,
      debug: false,
      provider: 'cpu',
    },
    labels: labelsPath,
    topK: 600,
  });
} catch (error) {
  initializationError = serviceError(
    error.code || 'MODEL_LOAD_FAILED',
    error.message || '声音分类模型加载失败。',
  );
}

const handlers = {
  getInfo() {
    ensureInitialized();
    return { ready: true };
  },
  classify,
};

parentPort.on('message', (message) => {
  const id = Number(message?.id);
  const method = String(message?.method || '');
  try {
    const handler = handlers[method];
    if (!handler) throw serviceError('UNKNOWN_METHOD', '未知的声音分类操作。');
    parentPort.postMessage({ id, ok: true, result: handler(message.payload || {}) });
  } catch (error) {
    parentPort.postMessage({
      id,
      ok: false,
      error: {
        code: error.code || 'AUDIO_EVENT_WORKER_ERROR',
        message: error.message || '声音分类失败。',
      },
    });
  }
});
