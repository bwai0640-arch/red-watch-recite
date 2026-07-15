'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { Worker } = require('node:worker_threads');

const PROFILE_SCHEMA_VERSION = 2;
const PROFILE_FILE = 'speaker-profile.dat';
const MIN_ENROLLMENT_SAMPLES = 6;
const MAX_ENROLLMENT_SAMPLES = 8;
const MIN_SAMPLE_RATE = 8_000;
const MAX_SAMPLE_RATE = 96_000;
const MIN_SAMPLE_SECONDS = 0.75;
const MAX_SAMPLE_SECONDS = 15;
const MAX_ABSOLUTE_SAMPLE = 1.25;
const ALLOWED_AUDIO_SOURCES = new Set(['mic']);
const ENROLLMENT_CONSISTENCY_THRESHOLD = 0.50;
const VERIFICATION_THRESHOLD = 0.55;
const STRONG_MATCH_THRESHOLD = 0.70;
const WORKER_TIMEOUT_MS = 30_000;

class SpeakerServiceError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = 'SpeakerServiceError';
    this.code = code;
    this.publicMessage = message;
  }
}

function publicError(error, fallback = '声纹服务暂时不可用。') {
  if (error instanceof SpeakerServiceError) return error.publicMessage;
  const knownMessages = {
    MODEL_MISSING: '本地声纹模型缺失，请重新获取完整应用。',
    MODEL_LOAD_FAILED: '本地声纹模型无法启动，请重新获取完整应用。',
    AUDIO_TOO_QUIET: '没有采集到足够清晰的声音。',
    AUDIO_CLIPPED: '声音过大并出现削波，请离麦克风稍远后重试。',
    AUDIO_TOO_SHORT: '声音片段太短，请继续朗读后重试。',
  };
  return knownMessages[error?.code] || fallback;
}

function normalizeVector(vector) {
  let normSquared = 0;
  for (const value of vector) normSquared += value * value;
  const norm = Math.sqrt(normSquared);
  if (!Number.isFinite(norm) || norm < 1e-8) {
    throw new SpeakerServiceError('INVALID_EMBEDDING', '声纹向量无效，请重新录入。');
  }
  const normalized = new Float32Array(vector.length);
  for (let index = 0; index < vector.length; index += 1) normalized[index] = vector[index] / norm;
  return normalized;
}

function centroid(vectors) {
  if (!vectors.length) throw new SpeakerServiceError('INVALID_PROFILE', '声纹档案没有有效样本。');
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
  for (let index = 0; index < normalizedLeft.length; index += 1) score += normalizedLeft[index] * normalizedRight[index];
  return Math.max(-1, Math.min(1, score));
}

function selectConsistentEmbeddings(vectors) {
  if (!Array.isArray(vectors) || vectors.length < MIN_ENROLLMENT_SAMPLES) {
    throw new SpeakerServiceError(
      'NOT_ENOUGH_SAMPLES',
      `至少需要 ${MIN_ENROLLMENT_SAMPLES} 段清晰的本人声音。`,
    );
  }

  const ranked = vectors.map((vector, index) => {
    const others = vectors.filter((_item, otherIndex) => otherIndex !== index);
    const meanSimilarity = others.reduce(
      (sum, other) => sum + cosineSimilarity(vector, other),
      0,
    ) / others.length;
    return { index, meanSimilarity };
  }).sort((left, right) => right.meanSimilarity - left.meanSimilarity);

  const selected = ranked
    .slice(0, MIN_ENROLLMENT_SAMPLES)
    .map(({ index }) => Float32Array.from(vectors[index]));

  const consistencyScores = selected.map((vector, index) => {
    const others = selected.filter((_item, otherIndex) => otherIndex !== index);
    return cosineSimilarity(vector, centroid(others));
  });
  if (consistencyScores.some((score) => score < ENROLLMENT_CONSISTENCY_THRESHOLD)) {
    throw new SpeakerServiceError(
      'INCONSISTENT_ENROLLMENT',
      '录入内容差异过大，请确保全程只有本人连续朗读。',
    );
  }
  return selected;
}

function validateSource(source) {
  if (typeof source !== 'string' || !ALLOWED_AUDIO_SOURCES.has(source)) {
    throw new SpeakerServiceError('INVALID_SOURCE', '声音片段来源无效。');
  }
  return source;
}

function copySamples(value) {
  if (value instanceof Float32Array) return Float32Array.from(value);
  if (value instanceof ArrayBuffer) {
    if (value.byteLength % Float32Array.BYTES_PER_ELEMENT !== 0) {
      throw new SpeakerServiceError('INVALID_AUDIO', '麦克风样本格式无效。');
    }
    return new Float32Array(value.slice(0));
  }
  if (Array.isArray(value)) return Float32Array.from(value);
  throw new SpeakerServiceError('INVALID_AUDIO', '麦克风样本格式无效。');
}

function sampleLength(value) {
  if (value instanceof Float32Array || Array.isArray(value)) return value.length;
  if (value instanceof ArrayBuffer && value.byteLength % Float32Array.BYTES_PER_ELEMENT === 0) {
    return value.byteLength / Float32Array.BYTES_PER_ELEMENT;
  }
  throw new SpeakerServiceError('INVALID_AUDIO', '麦克风样本格式无效。');
}

function validateAudioPayload(payload, options = {}) {
  if (!payload || typeof payload !== 'object') {
    throw new SpeakerServiceError('INVALID_AUDIO', '没有收到麦克风声音片段。');
  }
  const sampleRate = Number(payload.sampleRate);
  if (!Number.isInteger(sampleRate) || sampleRate < MIN_SAMPLE_RATE || sampleRate > MAX_SAMPLE_RATE) {
    throw new SpeakerServiceError('INVALID_SAMPLE_RATE', '麦克风采样率无效。');
  }
  const minimumSamples = Math.ceil(sampleRate * MIN_SAMPLE_SECONDS);
  const maximumSamples = Math.floor(sampleRate * MAX_SAMPLE_SECONDS);
  const incomingLength = sampleLength(payload.samples);
  if (incomingLength < minimumSamples || incomingLength > maximumSamples) {
    throw new SpeakerServiceError('INVALID_AUDIO_LENGTH', '声音片段长度无效。');
  }
  const samples = copySamples(payload.samples);
  for (const value of samples) {
    if (!Number.isFinite(value) || Math.abs(value) > MAX_ABSOLUTE_SAMPLE) {
      throw new SpeakerServiceError('INVALID_AUDIO', '麦克风样本包含无效数值。');
    }
  }
  return {
    source: options.requireSource ? validateSource(payload.source) : undefined,
    sampleRate,
    samples,
  };
}

async function hashFile(filename) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filename);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

class WorkerRpc {
  constructor(workerPath, modelPath, onFatal) {
    this.nextId = 1;
    this.pending = new Map();
    this.closed = false;
    this.onFatal = onFatal;
    this.worker = new Worker(workerPath, { workerData: { modelPath } });
    this.worker.on('message', (message) => this.handleMessage(message));
    this.worker.on('error', (error) => this.fail(error));
    this.worker.on('exit', (code) => {
      if (!this.closed && code !== 0) this.fail(new Error(`speaker worker exited with code ${code}`));
    });
  }

  handleMessage(message) {
    const request = this.pending.get(Number(message?.id));
    if (!request) return;
    this.pending.delete(Number(message.id));
    clearTimeout(request.timer);
    if (message.ok) {
      request.resolve(message.result);
      return;
    }
    const error = new SpeakerServiceError(
      message?.error?.code || 'SPEAKER_WORKER_ERROR',
      message?.error?.message || '声纹处理失败。',
    );
    request.reject(error);
  }

  fail(error) {
    if (this.closed) return;
    this.closed = true;
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    this.pending.clear();
    this.onFatal?.(error);
  }

  request(method, payload = {}, transferList = []) {
    if (this.closed) return Promise.reject(new SpeakerServiceError('WORKER_STOPPED', '声纹服务已经停止。'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new SpeakerServiceError('WORKER_TIMEOUT', '声纹处理超时。'));
      }, WORKER_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.worker.postMessage({ id, method, payload }, transferList);
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(new SpeakerServiceError('WORKER_STOPPED', '声纹服务已经停止。'));
    }
    this.pending.clear();
    await this.worker.terminate();
  }
}

class SpeakerService {
  constructor(options = {}) {
    this.workerPath = path.resolve(String(options.workerPath || ''));
    this.modelPath = path.resolve(String(options.modelPath || ''));
    this.dataRoot = path.resolve(String(options.dataRoot || ''));
    this.profilePath = path.join(this.dataRoot, PROFILE_FILE);
    this.safeStorage = options.safeStorage;
    this.worker = null;
    this.modelHash = '';
    this.dimension = 0;
    this.modelReady = false;
    this.storageReady = false;
    this.fatalError = null;
    this.profileError = null;
    this.profile = null;
    this.enrollment = null;
    this.initialization = null;
    this.operationQueue = Promise.resolve();
  }

  getState() {
    return {
      ready: Boolean(this.modelReady && this.storageReady && this.worker && !this.worker.closed),
      profileExists: Boolean(this.profile),
      createdAt: this.profile?.createdAt || null,
      error: this.fatalError || this.profileError || null,
      enrolling: Boolean(this.enrollment),
      enrollmentCount: this.enrollment?.embeddings.length || 0,
      requiredSamples: MIN_ENROLLMENT_SAMPLES,
      threshold: VERIFICATION_THRESHOLD,
    };
  }

  runExclusive(operation) {
    const next = this.operationQueue.then(operation, operation);
    this.operationQueue = next.catch(() => {});
    return next;
  }

  async initialize() {
    if (this.initialization) return this.initialization;
    this.initialization = this.runExclusive(async () => {
      try {
        const [workerStat, modelStat] = await Promise.all([
          fsp.stat(this.workerPath),
          fsp.stat(this.modelPath),
        ]);
        if (!workerStat.isFile() || !modelStat.isFile()) {
          throw new SpeakerServiceError('MODEL_MISSING', '本地声纹模型缺失，请重新获取完整应用。');
        }
        this.modelHash = await hashFile(this.modelPath);
        this.worker = new WorkerRpc(this.workerPath, this.modelPath, (error) => {
          this.modelReady = false;
          this.fatalError = publicError(error);
        });
        const info = await this.worker.request('getInfo');
        this.dimension = Number(info?.dimension);
        if (!Number.isInteger(this.dimension) || this.dimension <= 0 || this.dimension > 4096) {
          throw new SpeakerServiceError('MODEL_INVALID', '本地声纹模型无效，请重新获取完整应用。');
        }
        this.modelReady = true;

        this.storageReady = Boolean(
          this.safeStorage
          && typeof this.safeStorage.isEncryptionAvailable === 'function'
          && this.safeStorage.isEncryptionAvailable(),
        );
        if (!this.storageReady) {
          throw new SpeakerServiceError('ENCRYPTION_UNAVAILABLE', '系统无法安全保存声纹，请检查 Windows 用户环境。');
        }
        await fsp.mkdir(this.dataRoot, { recursive: true });
        await this.loadProfile();
      } catch (error) {
        if (!this.modelReady || !this.storageReady) this.fatalError = publicError(error);
        else this.profileError = publicError(error, '声纹档案无法读取，请重新录入。');
      }
      return this.getState();
    });
    return this.initialization;
  }

  assertOperational() {
    if (!this.modelReady || !this.storageReady || !this.worker || this.worker.closed) {
      throw new SpeakerServiceError('SERVICE_NOT_READY', this.fatalError || '声纹服务尚未就绪。');
    }
  }

  validateProfile(value) {
    if (!value || typeof value !== 'object' || value.schemaVersion !== PROFILE_SCHEMA_VERSION) {
      throw new SpeakerServiceError('PROFILE_INVALID', '声纹档案版本无效，请重新录入。');
    }
    if (value.modelHash !== this.modelHash || value.dimension !== this.dimension) {
      throw new SpeakerServiceError('PROFILE_MODEL_MISMATCH', '声纹模型已经更新，请重新录入本人声音。');
    }
    if (!Array.isArray(value.embeddings)
      || value.embeddings.length < MIN_ENROLLMENT_SAMPLES
      || value.embeddings.length > MAX_ENROLLMENT_SAMPLES) {
      throw new SpeakerServiceError('PROFILE_INVALID', '声纹档案样本数量无效，请重新录入。');
    }
    const embeddings = value.embeddings.map((entry) => {
      if (!Array.isArray(entry) || entry.length !== this.dimension) {
        throw new SpeakerServiceError('PROFILE_INVALID', '声纹档案维度无效，请重新录入。');
      }
      const vector = Float32Array.from(entry);
      for (const item of vector) {
        if (!Number.isFinite(item)) throw new SpeakerServiceError('PROFILE_INVALID', '声纹档案损坏，请重新录入。');
      }
      normalizeVector(vector);
      return vector;
    });
    const createdAt = new Date(value.createdAt);
    if (!Number.isFinite(createdAt.getTime())) {
      throw new SpeakerServiceError('PROFILE_INVALID', '声纹档案日期无效，请重新录入。');
    }
    return {
      schemaVersion: PROFILE_SCHEMA_VERSION,
      modelHash: this.modelHash,
      dimension: this.dimension,
      createdAt: createdAt.toISOString(),
      threshold: VERIFICATION_THRESHOLD,
      strongThreshold: STRONG_MATCH_THRESHOLD,
      embeddings,
    };
  }

  async loadProfile() {
    this.profile = null;
    this.profileError = null;
    let encrypted;
    try {
      encrypted = await fsp.readFile(this.profilePath);
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw new SpeakerServiceError('PROFILE_READ_FAILED', '声纹档案无法读取，请重新录入。', { cause: error });
    }
    try {
      const plaintext = this.safeStorage.decryptString(encrypted);
      const profile = this.validateProfile(JSON.parse(plaintext));
      await this.worker.request('setProfile', {
        embeddings: profile.embeddings.map((entry) => Array.from(entry)),
      });
      this.profile = profile;
    } catch (error) {
      await this.worker.request('clearProfile').catch(() => {});
      throw new SpeakerServiceError('PROFILE_DECRYPT_FAILED', '声纹档案损坏或不属于当前 Windows 用户，请重新录入。', { cause: error });
    }
  }

  beginEnrollment() {
    return this.runExclusive(async () => {
      this.assertOperational();
      this.enrollment = { startedAt: new Date().toISOString(), embeddings: [], sources: [] };
      return this.getState();
    });
  }

  addEnrollmentSample(payload) {
    return this.runExclusive(async () => {
      this.assertOperational();
      if (!this.enrollment) throw new SpeakerServiceError('ENROLLMENT_NOT_STARTED', '请先开始录入本人声音。');
      if (this.enrollment.embeddings.length >= MAX_ENROLLMENT_SAMPLES) {
        throw new SpeakerServiceError('TOO_MANY_SAMPLES', '录入片段数量已达到上限。');
      }
      const audio = validateAudioPayload(payload, { requireSource: true });
      const result = await this.worker.request('extract', {
        samples: audio.samples,
        sampleRate: audio.sampleRate,
      }, [audio.samples.buffer]);
      const embedding = Float32Array.from(result.embedding || []);
      if (embedding.length !== this.dimension) {
        throw new SpeakerServiceError('INVALID_EMBEDDING', '无法从声音片段生成有效声纹。');
      }

      let score;
      if (this.enrollment.embeddings.length) {
        score = cosineSimilarity(embedding, centroid(this.enrollment.embeddings));
      }
      this.enrollment.embeddings.push(embedding);
      this.enrollment.sources.push(audio.source);
      return {
        source: audio.source,
        count: this.enrollment.embeddings.length,
        ...(Number.isFinite(score) ? { score } : {}),
      };
    });
  }

  finishEnrollment() {
    return this.runExclusive(async () => {
      this.assertOperational();
      if (!this.enrollment) throw new SpeakerServiceError('ENROLLMENT_NOT_STARTED', '尚未开始录入本人声音。');
      if (this.enrollment.embeddings.length < MIN_ENROLLMENT_SAMPLES) {
        throw new SpeakerServiceError('NOT_ENOUGH_SAMPLES', `至少需要 ${MIN_ENROLLMENT_SAMPLES} 段清晰的本人声音。`);
      }

      const selectedEmbeddings = selectConsistentEmbeddings(this.enrollment.embeddings);

      const previousProfile = this.profile;
      const profile = {
        schemaVersion: PROFILE_SCHEMA_VERSION,
        modelHash: this.modelHash,
        dimension: this.dimension,
        createdAt: new Date().toISOString(),
        threshold: VERIFICATION_THRESHOLD,
        strongThreshold: STRONG_MATCH_THRESHOLD,
        embeddings: selectedEmbeddings,
      };
      await this.worker.request('setProfile', {
        embeddings: profile.embeddings.map((entry) => Array.from(entry)),
      });

      try {
        await this.writeProfile(profile);
      } catch (error) {
        if (previousProfile) {
          await this.worker.request('setProfile', {
            embeddings: previousProfile.embeddings.map((entry) => Array.from(entry)),
          }).catch(() => {});
        } else {
          await this.worker.request('clearProfile').catch(() => {});
        }
        throw error;
      }

      this.profile = profile;
      this.profileError = null;
      this.enrollment = null;
      return this.getState();
    });
  }

  async writeProfile(profile) {
    const serialized = JSON.stringify({
      schemaVersion: profile.schemaVersion,
      modelHash: profile.modelHash,
      dimension: profile.dimension,
      createdAt: profile.createdAt,
      threshold: profile.threshold,
      strongThreshold: profile.strongThreshold,
      embeddings: profile.embeddings.map((entry) => Array.from(entry)),
    });
    let encrypted;
    try {
      encrypted = this.safeStorage.encryptString(serialized);
    } catch (error) {
      throw new SpeakerServiceError('PROFILE_ENCRYPT_FAILED', '声纹档案无法安全加密。', { cause: error });
    }
    const temporary = `${this.profilePath}.tmp-${process.pid}-${crypto.randomUUID()}`;
    let handle;
    try {
      handle = await fsp.open(temporary, 'wx', 0o600);
      await handle.writeFile(encrypted);
      await handle.sync();
      await handle.close();
      handle = null;
      await fsp.rename(temporary, this.profilePath);
    } catch (error) {
      await handle?.close().catch(() => {});
      await fsp.rm(temporary, { force: true }).catch(() => {});
      throw new SpeakerServiceError('PROFILE_WRITE_FAILED', '声纹档案无法保存到程序旁的数据目录。', { cause: error });
    }
  }

  cancelEnrollment() {
    return this.runExclusive(async () => {
      this.enrollment = null;
      return this.getState();
    });
  }

  verify(payload) {
    return this.runExclusive(async () => {
      const failClosed = (error, score = null) => ({
        matched: false,
        score,
        threshold: VERIFICATION_THRESHOLD,
        strongMatch: false,
        error: publicError(error),
      });
      try {
        this.assertOperational();
        if (!this.profile) return failClosed(new SpeakerServiceError('PROFILE_MISSING', '尚未录入本人声音。'));
        const audio = validateAudioPayload(payload);
        const result = await this.worker.request('verify', {
          samples: audio.samples,
          sampleRate: audio.sampleRate,
          threshold: VERIFICATION_THRESHOLD,
          strongThreshold: STRONG_MATCH_THRESHOLD,
        }, [audio.samples.buffer]);
        return {
          matched: Boolean(result.matched),
          score: Number(result.score),
          threshold: VERIFICATION_THRESHOLD,
          strongMatch: Boolean(result.strongMatch),
        };
      } catch (error) {
        if (error?.code === 'AUDIO_TOO_QUIET' || error?.code === 'AUDIO_TOO_SHORT') {
          return {
            matched: false,
            score: 0,
            threshold: VERIFICATION_THRESHOLD,
            strongMatch: false,
          };
        }
        return failClosed(error);
      }
    });
  }

  deleteProfile() {
    return this.runExclusive(async () => {
      this.assertOperational();
      this.enrollment = null;
      try {
        await fsp.rm(this.profilePath, { force: true });
      } catch (error) {
        throw new SpeakerServiceError('PROFILE_DELETE_FAILED', '声纹档案无法删除。', { cause: error });
      }
      this.profile = null;
      this.profileError = null;
      await this.worker.request('clearProfile');
      return this.getState();
    });
  }

  async dispose() {
    this.enrollment = null;
    await this.worker?.close().catch(() => {});
    this.worker = null;
    this.modelReady = false;
  }
}

module.exports = {
  SpeakerService,
  SpeakerServiceError,
  constants: Object.freeze({
    MIN_ENROLLMENT_SAMPLES,
    MAX_ENROLLMENT_SAMPLES,
    VERIFICATION_THRESHOLD,
    STRONG_MATCH_THRESHOLD,
  }),
};
