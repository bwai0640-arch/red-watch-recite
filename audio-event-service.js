'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { Worker } = require('node:worker_threads');

const MIN_SAMPLE_RATE = 8_000;
const MAX_SAMPLE_RATE = 96_000;
const MIN_SAMPLE_SECONDS = 1.5;
const MAX_SAMPLE_SECONDS = 6;
const MAX_ABSOLUTE_SAMPLE = 1.25;
const WORKER_TIMEOUT_MS = 5_000;
const MAX_EVENTS = 600;

class AudioEventServiceError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = 'AudioEventServiceError';
    this.code = code;
    this.publicMessage = message;
  }
}

function copySamples(value) {
  if (value instanceof Float32Array) return Float32Array.from(value);
  if (value instanceof ArrayBuffer) {
    if (value.byteLength % Float32Array.BYTES_PER_ELEMENT !== 0) {
      throw new AudioEventServiceError('INVALID_AUDIO', '声音分类样本格式无效。');
    }
    return new Float32Array(value.slice(0));
  }
  if (Array.isArray(value)) return Float32Array.from(value);
  throw new AudioEventServiceError('INVALID_AUDIO', '声音分类样本格式无效。');
}

function sampleLength(value) {
  if (value instanceof Float32Array || Array.isArray(value)) return value.length;
  if (value instanceof ArrayBuffer && value.byteLength % Float32Array.BYTES_PER_ELEMENT === 0) {
    return value.byteLength / Float32Array.BYTES_PER_ELEMENT;
  }
  throw new AudioEventServiceError('INVALID_AUDIO', '声音分类样本格式无效。');
}

function validateAudioPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new AudioEventServiceError('INVALID_AUDIO', '没有收到声音分类样本。');
  }
  const sampleRate = Number(payload.sampleRate);
  if (!Number.isInteger(sampleRate) || sampleRate < MIN_SAMPLE_RATE || sampleRate > MAX_SAMPLE_RATE) {
    throw new AudioEventServiceError('INVALID_SAMPLE_RATE', '声音分类采样率无效。');
  }
  const minimumSamples = Math.ceil(sampleRate * MIN_SAMPLE_SECONDS);
  const maximumSamples = Math.floor(sampleRate * MAX_SAMPLE_SECONDS);
  const incomingLength = sampleLength(payload.samples);
  if (incomingLength < minimumSamples || incomingLength > maximumSamples) {
    throw new AudioEventServiceError('INVALID_AUDIO_LENGTH', '声音分类片段长度无效。');
  }
  const samples = copySamples(payload.samples);
  for (const value of samples) {
    if (!Number.isFinite(value) || Math.abs(value) > MAX_ABSOLUTE_SAMPLE) {
      throw new AudioEventServiceError('INVALID_AUDIO', '声音分类样本包含无效数值。');
    }
  }
  return { samples, sampleRate, durationSeconds: samples.length / sampleRate };
}

class WorkerRpc {
  constructor(workerPath, workerData, onFatal) {
    this.nextId = 1;
    this.pending = new Map();
    this.closed = false;
    this.onFatal = onFatal;
    this.worker = new Worker(workerPath, { workerData });
    this.worker.on('message', (message) => this.handleMessage(message));
    this.worker.on('error', (error) => this.fail(error));
    this.worker.on('exit', (code) => {
      if (!this.closed && code !== 0) this.fail(new Error(`audio event worker exited with code ${code}`));
    });
  }

  handleMessage(message) {
    const request = this.pending.get(message?.id);
    if (!request) return;
    this.pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.ok) {
      request.resolve(message.result);
      return;
    }
    request.reject(new AudioEventServiceError(
      message?.error?.code || 'AUDIO_EVENT_WORKER_ERROR',
      message?.error?.message || '声音分类失败。',
    ));
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

  request(method, payload = {}, transferList = []) {
    if (this.closed) {
      return Promise.reject(new AudioEventServiceError('WORKER_STOPPED', '声音分类服务已经停止。'));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const error = new AudioEventServiceError('WORKER_TIMEOUT', '声音分类处理超时。');
        this.fail(error);
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
      request.reject(new AudioEventServiceError('WORKER_STOPPED', '声音分类服务已经停止。'));
    }
    this.pending.clear();
    await this.worker.terminate();
  }
}

class AudioEventService {
  constructor(options = {}) {
    this.workerPath = path.resolve(String(options.workerPath || ''));
    this.modelPath = path.resolve(String(options.modelPath || ''));
    this.labelsPath = path.resolve(String(options.labelsPath || ''));
    this.worker = null;
    this.ready = false;
    this.error = '';
    this.initialization = null;
  }

  async initialize() {
    if (this.initialization) return this.initialization;
    this.initialization = (async () => {
      try {
        const stats = await Promise.all([
          fs.stat(this.workerPath),
          fs.stat(this.modelPath),
          fs.stat(this.labelsPath),
        ]);
        if (stats.some((entry) => !entry.isFile())) {
          throw new AudioEventServiceError('MODEL_MISSING', '本地声音分类模型缺失，请重新获取完整应用。');
        }
        this.worker = new WorkerRpc(this.workerPath, {
          modelPath: this.modelPath,
          labelsPath: this.labelsPath,
        }, (error) => {
          this.ready = false;
          this.error = error?.message || '声音分类服务异常停止。';
        });
        await this.worker.request('getInfo');
        this.ready = true;
        this.error = '';
      } catch (error) {
        this.ready = false;
        this.error = error?.publicMessage || error?.message || '声音分类服务启动失败。';
        await this.worker?.close().catch(() => {});
        this.worker = null;
      }
      return this.getState();
    })();
    return this.initialization;
  }

  getState() {
    return Object.freeze({ ready: this.ready, error: this.error });
  }

  assertOperational() {
    if (!this.ready || !this.worker || this.worker.closed) {
      throw new AudioEventServiceError('SERVICE_NOT_READY', this.error || '声音分类服务尚未就绪。');
    }
  }

  async classify(payload) {
    this.assertOperational();
    const audio = validateAudioPayload(payload);
    const result = await this.worker.request('classify', {
      samples: audio.samples,
      sampleRate: audio.sampleRate,
      topK: -1,
    }, [audio.samples.buffer]);
    const events = Array.isArray(result?.events)
      ? result.events.slice(0, MAX_EVENTS).map((event) => ({
        name: String(event?.name || '').slice(0, 120),
        index: Number.isInteger(event?.index) ? event.index : -1,
        prob: Math.max(0, Math.min(1, Number(event?.prob) || 0)),
      })).filter((event) => event.name)
      : [];
    return Object.freeze({
      events,
      durationSeconds: audio.durationSeconds,
      elapsedMs: Math.max(0, Number(result?.elapsedMs) || 0),
    });
  }

  async dispose() {
    await this.worker?.close().catch(() => {});
    this.worker = null;
    this.ready = false;
  }
}

module.exports = {
  AudioEventService,
  AudioEventServiceError,
  validateAudioPayload,
};
