'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { Worker } = require('node:worker_threads');

const PROFILE_SCHEMA_VERSION = 3;
const PROFILE_FILE = 'speaker-profile.dat';
const MIN_ENROLLMENT_SAMPLES = 6;
const MAX_ENROLLMENT_SAMPLES = 8;
const MAX_SAVED_PROFILES = 5;
const MIN_SAMPLE_RATE = 8_000;
const MAX_SAMPLE_RATE = 96_000;
const MIN_SAMPLE_SECONDS = 0.75;
const MAX_SAMPLE_SECONDS = 15;
const MAX_ABSOLUTE_SAMPLE = 1.25;
const MAX_PROFILE_FILE_BYTES = 4 * 1024 * 1024;
const ALLOWED_AUDIO_SOURCES = new Set(['mic']);
const ENROLLMENT_CONSISTENCY_THRESHOLD = 0.50;
const VERIFICATION_THRESHOLD = 0.55;
const STRONG_MATCH_THRESHOLD = 0.70;
const WORKER_TIMEOUT_MS = 30_000;
const INFERENCE_TIMEOUT_MS = 4_500;

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
    this.worker.terminate().catch(() => {});
  }

  request(method, payload = {}, transferList = [], timeoutMs = WORKER_TIMEOUT_MS) {
    if (this.closed) return Promise.reject(new SpeakerServiceError('WORKER_STOPPED', '声纹服务已经停止。'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.fail(new SpeakerServiceError('WORKER_TIMEOUT', '声纹处理超时。'));
      }, timeoutMs);
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
    this.profileCrypto = options.profileCrypto;
    this.worker = null;
    this.modelHash = '';
    this.dimension = 0;
    this.modelReady = false;
    this.storageReady = false;
    this.fatalError = null;
    this.profileError = null;
    this.profile = null;
    this.profileArtifactExists = fs.existsSync(this.profilePath);
    this.enrollment = null;
    this.initialization = null;
    this.operationQueue = Promise.resolve();
  }

  getState() {
    const profiles = this.profile?.profiles || [];
    return {
      ready: Boolean(this.modelReady && this.storageReady && this.worker && !this.worker.closed),
      profileExists: profiles.length > 0,
      profileArtifactExists: this.profileArtifactExists,
      createdAt: profiles[0]?.createdAt || null,
      profileCount: profiles.length,
      profiles: profiles.map(({ id, label, createdAt }) => ({ id, label, createdAt })),
      error: this.fatalError || this.profileError || null,
      enrolling: Boolean(this.enrollment),
      enrollmentId: this.enrollment?.id || null,
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
          this.enrollment = null;
          this.fatalError = publicError(error);
        });
        const info = await this.worker.request('getInfo');
        this.dimension = Number(info?.dimension);
        if (!Number.isInteger(this.dimension) || this.dimension <= 0 || this.dimension > 4096) {
          throw new SpeakerServiceError('MODEL_INVALID', '本地声纹模型无效，请重新获取完整应用。');
        }
        this.modelReady = true;

        this.storageReady = Boolean(
          this.profileCrypto
          && typeof this.profileCrypto.isAvailable === 'function'
          && await this.profileCrypto.isAvailable(),
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

  requireEnrollment(payload = {}) {
    const enrollmentId = String(payload?.enrollmentId || '');
    if (!this.enrollment || !enrollmentId || this.enrollment.id !== enrollmentId) {
      throw new SpeakerServiceError('ENROLLMENT_CANCELLED', '声纹录入已取消。');
    }
    return this.enrollment;
  }

  assertEnrollmentCurrent(enrollment) {
    if (!enrollment || this.enrollment !== enrollment) {
      throw new SpeakerServiceError('ENROLLMENT_CANCELLED', '声纹录入已取消。');
    }
  }

  validateProfile(value) {
    if (!value || typeof value !== 'object') {
      throw new SpeakerServiceError('PROFILE_INVALID', '声纹档案版本无效，请重新录入。');
    }
    if (value.schemaVersion === 2) return this.migrateLegacyProfile(value);
    if (value.schemaVersion !== PROFILE_SCHEMA_VERSION) {
      throw new SpeakerServiceError('PROFILE_INVALID', '声纹档案版本无效，请重新录入。');
    }
    if (value.modelHash !== this.modelHash || value.dimension !== this.dimension) {
      throw new SpeakerServiceError('PROFILE_MODEL_MISMATCH', '声纹模型已经更新，请重新录入本人声音。');
    }
    if (!Array.isArray(value.profiles) || value.profiles.length < 1 || value.profiles.length > MAX_SAVED_PROFILES) {
      throw new SpeakerServiceError('PROFILE_INVALID', '声纹档案数量无效，请重新录入。');
    }
    const ids = new Set();
    const profiles = value.profiles.map((item, index) => this.validateProfileItem(item, index, ids));
    return {
      schemaVersion: PROFILE_SCHEMA_VERSION,
      modelHash: this.modelHash,
      dimension: this.dimension,
      threshold: VERIFICATION_THRESHOLD,
      strongThreshold: STRONG_MATCH_THRESHOLD,
      profiles,
    };
  }

  validateProfileItem(value, index, ids) {
    if (!value || typeof value !== 'object' || typeof value.id !== 'string' || !/^[a-f0-9-]{8,64}$/iu.test(value.id) || ids.has(value.id)) {
      throw new SpeakerServiceError('PROFILE_INVALID', '声纹档案标识无效，请重新录入。');
    }
    ids.add(value.id);
    const label = String(value.label || '').trim().slice(0, 80);
    if (!label) throw new SpeakerServiceError('PROFILE_INVALID', '声纹档案名称无效，请重新录入。');
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
    return { id: value.id, label: label || `声纹 ${index + 1}`, createdAt: createdAt.toISOString(), embeddings };
  }

  migrateLegacyProfile(value) {
    if (value.modelHash !== this.modelHash || value.dimension !== this.dimension) {
      throw new SpeakerServiceError('PROFILE_MODEL_MISMATCH', '声纹模型已经更新，请重新录入本人声音。');
    }
    const legacy = this.validateProfileItem({
      id: '00000000-0000-4000-8000-000000000001',
      label: '原有声纹',
      createdAt: value.createdAt,
      embeddings: value.embeddings,
    }, 0, new Set());
    return {
      schemaVersion: PROFILE_SCHEMA_VERSION,
      modelHash: this.modelHash,
      dimension: this.dimension,
      threshold: VERIFICATION_THRESHOLD,
      strongThreshold: STRONG_MATCH_THRESHOLD,
      profiles: [legacy],
    };
  }

  workerProfiles(profile) {
    return profile.profiles.map((item) => ({
      id: item.id,
      embeddings: item.embeddings.map((entry) => Array.from(entry)),
    }));
  }

  async loadProfile() {
    this.profile = null;
    this.profileError = null;
    let encrypted;
    try {
      const profileStat = await fsp.lstat(this.profilePath);
      if (
        !profileStat.isFile()
        || profileStat.size < 1
        || profileStat.size > MAX_PROFILE_FILE_BYTES
      ) {
        throw new SpeakerServiceError(
          'PROFILE_SIZE_INVALID',
          '声纹档案大小异常，请删除后重新录入。',
        );
      }
      encrypted = await fsp.readFile(this.profilePath);
      this.profileArtifactExists = true;
    } catch (error) {
      if (error.code === 'ENOENT') {
        this.profileArtifactExists = false;
        return;
      }
      this.profileArtifactExists = true;
      if (error instanceof SpeakerServiceError) throw error;
      throw new SpeakerServiceError('PROFILE_READ_FAILED', '声纹档案无法读取，请重新录入。', { cause: error });
    }
    try {
      const plaintext = await this.profileCrypto.decryptString(encrypted);
      const profile = this.validateProfile(JSON.parse(plaintext));
      await this.worker.request('setProfiles', { profiles: this.workerProfiles(profile) });
      this.profile = profile;
    } catch (error) {
      await this.worker.request('clearProfile').catch(() => {});
      throw new SpeakerServiceError('PROFILE_DECRYPT_FAILED', '声纹档案损坏或不属于当前 Windows 用户，请重新录入。', { cause: error });
    }
  }

  beginEnrollment(payload = {}) {
    return this.runExclusive(async () => {
      this.assertOperational();
      if ((this.profile?.profiles.length || 0) >= MAX_SAVED_PROFILES) {
        throw new SpeakerServiceError('PROFILE_LIMIT_REACHED', `最多可保存 ${MAX_SAVED_PROFILES} 份声纹，请先删除不再使用的声纹。`);
      }
      const requestedLabel = String(payload?.label || '').trim().replace(/\s+/gu, ' ').slice(0, 80);
      const number = (this.profile?.profiles.length || 0) + 1;
      this.enrollment = {
        id: crypto.randomUUID(),
        startedAt: new Date().toISOString(),
        label: requestedLabel || `声纹 ${number}`,
        embeddings: [],
        sources: [],
      };
      return this.getState();
    });
  }

  addEnrollmentSample(payload) {
    return this.runExclusive(async () => {
      this.assertOperational();
      const enrollment = this.requireEnrollment(payload);
      if (enrollment.embeddings.length >= MAX_ENROLLMENT_SAMPLES) {
        throw new SpeakerServiceError('TOO_MANY_SAMPLES', '录入片段数量已达到上限。');
      }
      const audio = validateAudioPayload(payload, { requireSource: true });
      const result = await this.worker.request('extract', {
        samples: audio.samples,
        sampleRate: audio.sampleRate,
      }, [audio.samples.buffer], INFERENCE_TIMEOUT_MS);
      this.assertEnrollmentCurrent(enrollment);
      const embedding = Float32Array.from(result.embedding || []);
      if (embedding.length !== this.dimension) {
        throw new SpeakerServiceError('INVALID_EMBEDDING', '无法从声音片段生成有效声纹。');
      }

      let score;
      if (enrollment.embeddings.length) {
        score = cosineSimilarity(embedding, centroid(enrollment.embeddings));
      }
      enrollment.embeddings.push(embedding);
      enrollment.sources.push(audio.source);
      return {
        source: audio.source,
        count: enrollment.embeddings.length,
        ...(Number.isFinite(score) ? { score } : {}),
      };
    });
  }

  finishEnrollment(payload = {}) {
    return this.runExclusive(async () => {
      this.assertOperational();
      const enrollment = this.requireEnrollment(payload);
      if (enrollment.embeddings.length < MIN_ENROLLMENT_SAMPLES) {
        throw new SpeakerServiceError('NOT_ENOUGH_SAMPLES', `至少需要 ${MIN_ENROLLMENT_SAMPLES} 段清晰的本人声音。`);
      }

      const selectedEmbeddings = selectConsistentEmbeddings(enrollment.embeddings);

      const previousProfile = this.profile;
      const profile = {
        schemaVersion: PROFILE_SCHEMA_VERSION,
        modelHash: this.modelHash,
        dimension: this.dimension,
        threshold: VERIFICATION_THRESHOLD,
        strongThreshold: STRONG_MATCH_THRESHOLD,
        profiles: [
          ...(previousProfile?.profiles || []),
          {
            id: crypto.randomUUID(),
            label: enrollment.label,
            createdAt: new Date().toISOString(),
            embeddings: selectedEmbeddings,
          },
        ],
      };
      try {
        await this.worker.request('setProfiles', { profiles: this.workerProfiles(profile) });
        this.assertEnrollmentCurrent(enrollment);
        await this.writeProfile(profile, () => this.assertEnrollmentCurrent(enrollment));
        this.assertEnrollmentCurrent(enrollment);
      } catch (error) {
        let rollbackFailure = null;
        try {
          if (previousProfile) {
            await this.worker.request('setProfiles', { profiles: this.workerProfiles(previousProfile) });
          } else {
            await this.worker.request('clearProfile');
          }
        } catch (rollbackError) {
          rollbackFailure = rollbackError;
          this.worker.fail(rollbackError);
        }
        if (error?.code === 'ENROLLMENT_CANCELLED') {
          try {
            if (previousProfile) await this.writeProfile(previousProfile);
            else {
              await fsp.rm(this.profilePath, { force: true });
              this.profileArtifactExists = false;
            }
          } catch (diskRollbackError) {
            rollbackFailure = rollbackFailure || diskRollbackError;
            this.worker.fail(diskRollbackError);
          }
        }
        if (rollbackFailure) {
          throw new SpeakerServiceError(
            'ENROLLMENT_ROLLBACK_FAILED',
            '声纹录入取消后的安全回滚失败，声纹服务已停止。',
            { cause: rollbackFailure },
          );
        }
        throw error;
      }

      this.profile = profile;
      this.profileError = null;
      if (this.enrollment === enrollment) this.enrollment = null;
      return this.getState();
    });
  }

  async writeProfile(profile, assertCurrent = null) {
    const serialized = JSON.stringify({
      schemaVersion: profile.schemaVersion,
      modelHash: profile.modelHash,
      dimension: profile.dimension,
      threshold: profile.threshold,
      strongThreshold: profile.strongThreshold,
      profiles: profile.profiles.map((item) => ({
        id: item.id,
        label: item.label,
        createdAt: item.createdAt,
        embeddings: item.embeddings.map((entry) => Array.from(entry)),
      })),
    });
    let encrypted;
    try {
      encrypted = await this.profileCrypto.encryptString(serialized);
      assertCurrent?.();
    } catch (error) {
      if (error?.code === 'ENROLLMENT_CANCELLED') throw error;
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
      assertCurrent?.();
      await fsp.rename(temporary, this.profilePath);
      assertCurrent?.();
      this.profileArtifactExists = true;
    } catch (error) {
      await handle?.close().catch(() => {});
      await fsp.rm(temporary, { force: true }).catch(() => {});
      if (error?.code === 'ENROLLMENT_CANCELLED') throw error;
      throw new SpeakerServiceError('PROFILE_WRITE_FAILED', '声纹档案无法保存到程序旁的数据目录。', { cause: error });
    }
  }

  cancelEnrollment(payload = {}) {
    const enrollmentId = String(payload?.enrollmentId || '');
    if (this.enrollment?.id === enrollmentId) this.enrollment = null;
    return this.runExclusive(async () => {
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
        }, [audio.samples.buffer], INFERENCE_TIMEOUT_MS);
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

  deleteProfile(profileId) {
    return this.runExclusive(async () => {
      this.assertOperational();
      this.enrollment = null;
      if (typeof profileId !== 'string' || !/^[a-f0-9-]{8,64}$/iu.test(profileId)) {
        throw new SpeakerServiceError('PROFILE_ID_INVALID', '请选择要删除的有效声纹。');
      }
      if (!this.profile) {
        throw new SpeakerServiceError('PROFILE_NOT_FOUND', '未找到要删除的声纹。');
      }
      const remaining = this.profile.profiles.filter((item) => item.id !== profileId);
      if (remaining.length === this.profile.profiles.length) {
        throw new SpeakerServiceError('PROFILE_NOT_FOUND', '未找到要删除的声纹。');
      }
      const previousProfile = this.profile;
      const nextProfile = remaining.length ? { ...previousProfile, profiles: remaining } : null;
      if (nextProfile) {
        await this.worker.request('setProfiles', { profiles: this.workerProfiles(nextProfile) });
      } else {
        await this.worker.request('clearProfile');
      }
      try {
        if (nextProfile) await this.writeProfile(nextProfile);
        else await fsp.rm(this.profilePath, { force: true });
      } catch (error) {
        try {
          await this.worker.request('setProfiles', {
            profiles: this.workerProfiles(previousProfile),
          });
        } catch (rollbackError) {
          this.worker.fail(rollbackError);
        }
        throw new SpeakerServiceError('PROFILE_DELETE_FAILED', '声纹档案无法删除。', { cause: error });
      }
      this.profile = nextProfile;
      this.profileArtifactExists = Boolean(nextProfile);
      this.profileError = null;
      return this.getState();
    });
  }

  deleteProfileArtifact() {
    return this.runExclusive(async () => {
      this.enrollment = null;
      if (this.profile) {
        throw new SpeakerServiceError(
          'PROFILE_USABLE',
          '声纹档案仍可正常使用，请通过声纹列表删除。',
        );
      }
      try {
        if (this.worker && !this.worker.closed) await this.worker.request('clearProfile');
      } catch (error) {
        this.worker?.fail(error);
      }
      try {
        await fsp.rm(this.profilePath, { force: true });
        const entries = await fsp.readdir(this.dataRoot).catch(() => []);
        await Promise.all(entries
          .filter((name) => /^speaker-profile\.dat\.tmp-\d+-[a-f0-9-]{8,64}$/iu.test(name))
          .map((name) => fsp.rm(path.join(this.dataRoot, name), { force: true })));
      } catch (error) {
        throw new SpeakerServiceError(
          'PROFILE_DELETE_FAILED',
          '本地声纹档案无法删除。',
          { cause: error },
        );
      }
      this.profile = null;
      this.profileArtifactExists = false;
      this.profileError = null;
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
    MAX_PROFILE_FILE_BYTES,
    VERIFICATION_THRESHOLD,
    STRONG_MATCH_THRESHOLD,
  }),
};
