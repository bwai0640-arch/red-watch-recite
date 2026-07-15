(function exposeSpeakerAudio(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SpeakerAudio = api;
}(typeof globalThis === 'object' ? globalThis : this, (root) => {
  const TARGET_SAMPLE_RATE = 16_000;

  function concatChunks(chunks, totalLength = null) {
    const length = totalLength ?? chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const output = new Float32Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      if (offset >= length) break;
      const available = Math.min(chunk.length, length - offset);
      output.set(chunk.subarray(0, available), offset);
      offset += available;
    }
    return offset === length ? output : output.slice(0, offset);
  }

  function mixToMono(audioBuffer) {
    const output = new Float32Array(audioBuffer.length);
    const channels = Math.max(1, audioBuffer.numberOfChannels);
    for (let channel = 0; channel < channels; channel += 1) {
      const samples = audioBuffer.getChannelData(channel);
      for (let index = 0; index < output.length; index += 1) {
        output[index] += samples[index] / channels;
      }
    }
    return output;
  }

  function resampleLinear(samples, sourceRate, targetRate = TARGET_SAMPLE_RATE) {
    const fromRate = Number(sourceRate);
    const toRate = Number(targetRate);
    if (!Number.isFinite(fromRate) || !Number.isFinite(toRate) || fromRate <= 0 || toRate <= 0) {
      throw new Error('无效的音频采样率。');
    }
    if (fromRate === toRate) return samples.slice();
    const outputLength = Math.max(1, Math.round(samples.length * toRate / fromRate));
    const output = new Float32Array(outputLength);
    const scale = fromRate / toRate;
    for (let index = 0; index < outputLength; index += 1) {
      const position = index * scale;
      const left = Math.min(samples.length - 1, Math.floor(position));
      const right = Math.min(samples.length - 1, left + 1);
      const mix = position - left;
      output[index] = (samples[left] * (1 - mix)) + (samples[right] * mix);
    }
    return output;
  }

  function analyzeQuality(samples) {
    if (!(samples instanceof Float32Array) || samples.length === 0) {
      return { rms: 0, peak: 0, clippingRatio: 0 };
    }
    let sumSquares = 0;
    let peak = 0;
    let clipped = 0;
    for (const sample of samples) {
      const amplitude = Math.abs(sample);
      sumSquares += sample * sample;
      peak = Math.max(peak, amplitude);
      if (amplitude >= 0.995) clipped += 1;
    }
    return {
      rms: Math.sqrt(sumSquares / samples.length),
      peak,
      clippingRatio: clipped / samples.length,
    };
  }

  function analyzeDynamics(samples, sampleRate, frameSeconds = 0.05) {
    const frameLength = Math.max(1, Math.round(sampleRate * frameSeconds));
    const values = [];
    for (let start = 0; start + frameLength <= samples.length; start += frameLength) {
      let sumSquares = 0;
      for (let index = start; index < start + frameLength; index += 1) {
        sumSquares += samples[index] * samples[index];
      }
      const rms = Math.sqrt(sumSquares / frameLength);
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

  function selectVoiceWindows(samples, sampleRate, options = {}) {
    const count = Math.max(1, Math.floor(options.count || 6));
    const durationSeconds = Math.max(2, Number(options.durationSeconds) || 4);
    const minimumDurationSeconds = Math.max(
      durationSeconds * count,
      Number(options.minimumDurationSeconds) || 25,
    );
    const duration = samples.length / sampleRate;
    if (duration < minimumDurationSeconds) {
      throw new Error(`有效朗读时长至少需要 ${Math.ceil(minimumDurationSeconds)} 秒。`);
    }

    const windowLength = Math.round(durationSeconds * sampleRate);
    const step = Math.max(1, Math.round(sampleRate / 2));
    const prefixSquares = new Float64Array(samples.length + 1);
    for (let index = 0; index < samples.length; index += 1) {
      prefixSquares[index + 1] = prefixSquares[index] + (samples[index] * samples[index]);
    }
    const windowRms = (start) => Math.sqrt(
      (prefixSquares[start + windowLength] - prefixSquares[start]) / windowLength,
    );

    const windows = [];
    const partitionLength = Math.floor(samples.length / count);
    for (let partition = 0; partition < count; partition += 1) {
      const rangeStart = partition * partitionLength;
      const rangeEnd = partition === count - 1 ? samples.length : (partition + 1) * partitionLength;
      const latestStart = Math.max(rangeStart, rangeEnd - windowLength);
      let bestStart = rangeStart;
      let bestRms = -1;
      for (let start = rangeStart; start <= latestStart; start += step) {
        const value = windowRms(start);
        if (value > bestRms) {
          bestRms = value;
          bestStart = start;
        }
      }
      const segment = samples.slice(bestStart, bestStart + windowLength);
      const quality = analyzeQuality(segment);
      if (quality.rms < 0.004) throw new Error('麦克风中的人声太轻，请靠近一些再重试。');
      if (quality.clippingRatio > 0.03) throw new Error('麦克风爆音过多，请降低音量后重试。');
      windows.push(segment);
    }
    return windows;
  }

  class ContinuousPcmCapture {
    constructor(audioContext, source, onChunk) {
      this.audioContext = audioContext;
      this.source = source;
      this.onChunk = onChunk;
      this.node = null;
      this.sink = null;
      this.mode = '';
    }

    async start() {
      if (this.node) return this;
      this.sink = this.audioContext.createGain();
      this.sink.gain.value = 0;
      this.sink.connect(this.audioContext.destination);

      if (this.audioContext.audioWorklet && typeof root.AudioWorkletNode === 'function') {
        try {
          await this.audioContext.audioWorklet.addModule('rwt://renderer/speaker-capture-worklet.js');
          this.node = new root.AudioWorkletNode(this.audioContext, 'speaker-pcm-capture');
          this.node.port.onmessage = (event) => {
            const chunk = event.data instanceof Float32Array
              ? event.data
              : new Float32Array(event.data);
            this.onChunk(chunk);
          };
          this.source.connect(this.node);
          this.node.connect(this.sink);
          this.mode = 'audio-worklet';
          return this;
        } catch (error) {
          console.warn('AudioWorklet unavailable, using ScriptProcessor fallback.', error);
        }
      }

      const processor = this.audioContext.createScriptProcessor(4096, 1, 1);
      processor.onaudioprocess = (event) => {
        const input = event.inputBuffer.getChannelData(0);
        const chunk = new Float32Array(input.length);
        chunk.set(input);
        this.onChunk(chunk);
      };
      this.source.connect(processor);
      processor.connect(this.sink);
      this.node = processor;
      this.mode = 'script-processor';
      return this;
    }

    stop() {
      if (!this.node) return;
      if ('port' in this.node && this.node.port) this.node.port.onmessage = null;
      if ('onaudioprocess' in this.node) this.node.onaudioprocess = null;
      try { this.source.disconnect(this.node); } catch {}
      try { this.node.disconnect(); } catch {}
      try { this.sink?.disconnect(); } catch {}
      this.node = null;
      this.sink = null;
      this.mode = '';
    }
  }

  return {
    TARGET_SAMPLE_RATE,
    ContinuousPcmCapture,
    analyzeDynamics,
    analyzeQuality,
    concatChunks,
    mixToMono,
    resampleLinear,
    selectVoiceWindows,
  };
}));
