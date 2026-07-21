'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { parentPort, workerData } = require('node:worker_threads');

const OWNER_NAME = 'owner';
const MIN_SAMPLE_RATE = 8_000;
const MAX_SAMPLE_RATE = 96_000;
const MIN_SAMPLE_SECONDS = 0.75;
const MAX_SAMPLE_SECONDS = 15;
const MAX_ABSOLUTE_SAMPLE = 1.25;
const MIN_RMS = 0.0025;
const MIN_PEAK = 0.01;
const MAX_CLIPPED_RATIO = 0.08;
const ENROLLMENT_FRAME_SECONDS = 0.05;
const MIN_ENROLLMENT_DB_STD = 2;
const MIN_ENROLLMENT_DB_SPREAD = 6;

let extractor = null;
let manager = null;
let enrolledProfiles = [];
let initializationError = null;

function serviceError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeVector(vector) {
  let normSquared = 0;
  for (const value of vector) normSquared += value * value;
  const norm = Math.sqrt(normSquared);
  if (!Number.isFinite(norm) || norm < 1e-8) {
    throw serviceError('INVALID_EMBEDDING', '声纹向量无效。');
  }
  const normalized = new Float32Array(vector.length);
  for (let index = 0; index < vector.length; index += 1) {
    normalized[index] = vector[index] / norm;
  }
  return normalized;
}

function centroid(vectors) {
  if (!vectors.length) throw serviceError('PROFILE_MISSING', '尚未录入本人声音。');
  const output = new Float32Array(vectors[0].length);
  for (const vector of vectors) {
    const normalized = normalizeVector(vector);
    for (let index = 0; index < output.length; index += 1) output[index] += normalized[index];
  }
  return normalizeVector(output);
}

function cosineSimilarity(left, right) {
  const normalizedLeft = normalizeVector(left);
  const normalizedRight = normalizeVector(right);
  let score = 0;
  for (let index = 0; index < normalizedLeft.length; index += 1) {
    score += normalizedLeft[index] * normalizedRight[index];
  }
  return Math.max(-1, Math.min(1, score));
}

function validateSamples(payload) {
  const sampleRate = Number(payload?.sampleRate);
  if (!Number.isInteger(sampleRate) || sampleRate < MIN_SAMPLE_RATE || sampleRate > MAX_SAMPLE_RATE) {
    throw serviceError('INVALID_SAMPLE_RATE', '麦克风采样率无效。');
  }
  if (!(payload?.samples instanceof Float32Array)) {
    throw serviceError('INVALID_AUDIO', '麦克风样本格式无效。');
  }

  const samples = payload.samples;
  const minimumSamples = Math.ceil(sampleRate * MIN_SAMPLE_SECONDS);
  const maximumSamples = Math.floor(sampleRate * MAX_SAMPLE_SECONDS);
  if (samples.length < minimumSamples || samples.length > maximumSamples) {
    throw serviceError('INVALID_AUDIO_LENGTH', '声音片段长度无效。');
  }

  let sumSquared = 0;
  let peak = 0;
  let clipped = 0;
  for (const value of samples) {
    if (!Number.isFinite(value) || Math.abs(value) > MAX_ABSOLUTE_SAMPLE) {
      throw serviceError('INVALID_AUDIO', '麦克风样本包含无效数值。');
    }
    const absolute = Math.abs(value);
    sumSquared += value * value;
    peak = Math.max(peak, absolute);
    if (absolute >= 0.99) clipped += 1;
  }

  const rms = Math.sqrt(sumSquared / samples.length);
  const clippedRatio = clipped / samples.length;
  const quality = {
    durationSeconds: samples.length / sampleRate,
    rms,
    peak,
    clippedRatio,
  };
  if (rms < MIN_RMS || peak < MIN_PEAK) {
    throw serviceError('AUDIO_TOO_QUIET', '没有采集到足够清晰的声音。');
  }
  if (clippedRatio > MAX_CLIPPED_RATIO) {
    throw serviceError('AUDIO_CLIPPED', '声音过大并出现削波，请离麦克风稍远后重试。');
  }
  return { samples, sampleRate, quality };
}

function analyzeDynamics(samples, sampleRate) {
  const frameLength = Math.max(1, Math.round(sampleRate * ENROLLMENT_FRAME_SECONDS));
  const values = [];
  for (let start = 0; start + frameLength <= samples.length; start += frameLength) {
    let sumSquared = 0;
    for (let index = start; index < start + frameLength; index += 1) {
      sumSquared += samples[index] * samples[index];
    }
    const rms = Math.sqrt(sumSquared / frameLength);
    values.push(20 * Math.log10(Math.max(rms, 1e-6)));
  }
  if (values.length < 10) return { standardDeviationDb: 0, spreadDb: 0 };
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / values.length;
  const sorted = [...values].sort((left, right) => left - right);
  const percentile = (ratio) => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio))];
  return {
    standardDeviationDb: Math.sqrt(variance),
    spreadDb: percentile(0.9) - percentile(0.1),
  };
}

function validateEmbedding(value) {
  const vector = value instanceof Float32Array ? value : Float32Array.from(value || []);
  if (!extractor || vector.length !== extractor.dim) {
    throw serviceError('INVALID_EMBEDDING', '声纹维度与当前模型不匹配。');
  }
  for (const item of vector) {
    if (!Number.isFinite(item)) throw serviceError('INVALID_EMBEDDING', '声纹向量包含无效数值。');
  }
  normalizeVector(vector);
  return vector;
}

function ensureInitialized() {
  if (initializationError) throw initializationError;
  if (!extractor) throw serviceError('MODEL_NOT_READY', '声纹模型尚未就绪。');
}

function extractEmbedding(payload, options = {}) {
  ensureInitialized();
  const { samples, sampleRate, quality } = validateSamples(payload);
  if (options.requireSpeechDynamics) {
    const dynamics = analyzeDynamics(samples, sampleRate);
    if (dynamics.standardDeviationDb < MIN_ENROLLMENT_DB_STD
      || dynamics.spreadDb < MIN_ENROLLMENT_DB_SPREAD) {
      throw serviceError('AUDIO_NOT_SPEECH', '没有检测到足够清晰的连续朗读，请重新录入。');
    }
    quality.dynamics = dynamics;
  }
  const stream = extractor.createStream();
  stream.acceptWaveform({ samples, sampleRate });
  if (!extractor.isReady(stream)) {
    throw serviceError('AUDIO_TOO_SHORT', '声音片段不足以生成声纹。');
  }

  // Electron 21+ disallows the native addon's external buffers. Sherpa's
  // documented Electron-compatible call explicitly passes false here.
  const computed = extractor.compute(stream, false);
  const embedding = validateEmbedding(computed);
  return { embedding: Float32Array.from(embedding), quality };
}

function setProfiles(payload) {
  ensureInitialized();
  if (!Array.isArray(payload?.profiles) || payload.profiles.length < 1 || payload.profiles.length > 5) {
    throw serviceError('INVALID_PROFILE', '声纹档案数量无效。');
  }
  const profiles = payload.profiles.map((profile) => {
    if (!profile || typeof profile.id !== 'string'
      || !Array.isArray(profile.embeddings)
      || profile.embeddings.length < 1
      || profile.embeddings.length > 8) {
      throw serviceError('INVALID_PROFILE', '声纹档案中的样本数量无效。');
    }
    const embeddings = profile.embeddings.map(validateEmbedding);
    return { id: profile.id, embeddings, centroid: centroid(embeddings) };
  });
  const nextManager = new (require('sherpa-onnx-node').SpeakerEmbeddingManager)(extractor.dim);
  const allEmbeddings = profiles.flatMap((profile) => profile.embeddings);
  if (!nextManager.addMulti({ name: OWNER_NAME, v: allEmbeddings })) {
    throw serviceError('PROFILE_LOAD_FAILED', '无法载入本人声纹。');
  }
  manager = nextManager;
  enrolledProfiles = profiles;
  return { count: profiles.length, samples: allEmbeddings.length };
}

function clearProfile() {
  manager = null;
  enrolledProfiles = [];
  return { cleared: true };
}

function verify(payload) {
  ensureInitialized();
  if (!manager || !enrolledProfiles.length) throw serviceError('PROFILE_MISSING', '尚未录入本人声音。');
  const threshold = Number(payload?.threshold);
  const strongThreshold = Number(payload?.strongThreshold);
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1
    || !Number.isFinite(strongThreshold) || strongThreshold < threshold || strongThreshold > 1) {
    throw serviceError('INVALID_THRESHOLD', '声纹验证阈值无效。');
  }

  const { embedding, quality } = extractEmbedding(payload);
  const scoredProfiles = enrolledProfiles.map((profile) => ({
    id: profile.id,
    score: cosineSimilarity(embedding, profile.centroid),
  })).sort((left, right) => right.score - left.score);
  const bestProfile = scoredProfiles[0];
  const score = bestProfile.score;
  const managerMatched = manager.verify({ name: OWNER_NAME, v: embedding, threshold });
  const matched = Boolean(managerMatched && score >= threshold);
  return {
    matched,
    score,
    profileId: bestProfile.id,
    strongMatch: Boolean(matched && score >= strongThreshold),
    quality,
  };
}

try {
  const modelPath = path.resolve(String(workerData?.modelPath || ''));
  if (!modelPath || !fs.statSync(modelPath).isFile()) {
    throw serviceError('MODEL_MISSING', '本地声纹模型不存在。');
  }
  const sherpa = require('sherpa-onnx-node');
  extractor = new sherpa.SpeakerEmbeddingExtractor({
    model: modelPath,
    numThreads: 1,
    debug: false,
    provider: 'cpu',
  });
  if (!Number.isInteger(extractor.dim) || extractor.dim <= 0 || extractor.dim > 4096) {
    throw serviceError('MODEL_INVALID', '本地声纹模型返回了无效维度。');
  }
} catch (error) {
  initializationError = serviceError(error.code || 'MODEL_LOAD_FAILED', error.message || '声纹模型加载失败。');
}

const handlers = {
  getInfo() {
    ensureInitialized();
    return { dimension: extractor.dim };
  },
  extract(payload) {
    return extractEmbedding(payload, { requireSpeechDynamics: true });
  },
  setProfiles,
  clearProfile,
  verify,
};

parentPort.on('message', (message) => {
  const id = Number(message?.id);
  const method = String(message?.method || '');
  try {
    const handler = handlers[method];
    if (!handler) throw serviceError('UNKNOWN_METHOD', '未知的声纹服务操作。');
    const result = handler(message.payload || {});
    parentPort.postMessage({ id, ok: true, result });
  } catch (error) {
    parentPort.postMessage({
      id,
      ok: false,
      error: {
        code: error.code || 'SPEAKER_WORKER_ERROR',
        message: error.message || '声纹处理失败。',
      },
    });
  }
});
