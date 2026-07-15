(function exposeMediaPlayer(globalObject) {
  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`无法加载动画帧：${url}`));
      image.src = url;
    });
  }

  function hexToBytes(hex) {
    const bytes = new Uint8Array(hex.length / 2);
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
    }
    return bytes;
  }

  function decryptAudio(buffer, keyHex) {
    const source = new Uint8Array(buffer);
    const key = hexToBytes(keyHex);
    const output = new Uint8Array(source.length);
    for (let index = 0; index < source.length; index += 1) {
      output[index] = source[index] ^ key[index % key.length] ^ ((31 * index) & 255);
    }
    return output.buffer;
  }

  function locateFrame(manifest, frameIndex) {
    let start = 0;
    for (let sheetIndex = 0; sheetIndex < manifest.sheets.length; sheetIndex += 1) {
      const sheet = manifest.sheets[sheetIndex];
      if (frameIndex < start + sheet.count) {
        return { sheet, sheetIndex, localFrame: frameIndex - start };
      }
      start += sheet.count;
    }
    const sheetIndex = manifest.sheets.length - 1;
    const sheet = manifest.sheets[sheetIndex];
    return { sheet, sheetIndex, localFrame: Math.max(0, sheet.count - 1) };
  }

  function drawFrame(context, canvas, prepared, frameIndex) {
    const { manifest, sheets } = prepared;
    const { sheet, sheetIndex, localFrame } = locateFrame(manifest, frameIndex);
    const sourceX = (localFrame % sheet.cols) * manifest.width;
    const sourceY = Math.floor(localFrame / sheet.cols) * manifest.height;
    context.drawImage(
      sheets[sheetIndex],
      sourceX,
      sourceY,
      manifest.width,
      manifest.height,
      0,
      0,
      canvas.width,
      canvas.height,
    );
  }

  class MediaPlayer {
    constructor(canvas, options = {}) {
      this.canvas = canvas;
      this.context = canvas.getContext('2d', { alpha: false });
      this.statusElement = options.statusElement || null;
      this.animationFrame = 0;
      this.audioSource = null;
      this.audioContext = null;
      this.playToken = 0;
      this.manifest = null;
      this.currentClipId = '';
      this.finishCurrent = null;
    }

    async stop() {
      this.playToken += 1;
      this.finishCurrent?.({ interrupted: true });
      this.finishCurrent = null;
      if (this.animationFrame) cancelAnimationFrame(this.animationFrame);
      this.animationFrame = 0;
      try { this.audioSource?.stop(); } catch {}
      this.audioSource = null;
    }

    async ensureAudioContext() {
      if (!this.audioContext || this.audioContext.state === 'closed') {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        this.audioContext = new AudioContextClass();
      }
      await this.audioContext.resume();
      return this.audioContext;
    }

    async prepare(clipId, options = {}) {
      const clipBase = `rwt://renderer/media/${clipId}`;
      const response = await fetch(`${clipBase}/manifest.json`);
      if (!response.ok) throw new Error(`动画清单读取失败：${response.status}`);
      const manifest = await response.json();
      const sheetsPromise = Promise.all(
        manifest.sheets.map((sheet) => loadImage(`${clipBase}/${sheet.file}`)),
      );
      const audioPromise = options.audio && manifest.audio?.keyHex
        ? fetch(`${clipBase}/audio.rwa`).then(async (audioResponse) => {
          if (!audioResponse.ok) throw new Error(`音频读取失败：${audioResponse.status}`);
          const decrypted = decryptAudio(await audioResponse.arrayBuffer(), manifest.audio.keyHex);
          const audioContext = await this.ensureAudioContext();
          return audioContext.decodeAudioData(decrypted.slice(0));
        })
        : Promise.resolve(null);
      const [sheets, audioBuffer] = await Promise.all([sheetsPromise, audioPromise]);
      return { clipId, clipBase, manifest, sheets, audioBuffer };
    }

    async startAudio(prepared, options) {
      if (!prepared.audioBuffer) {
        options.onAudioStatus?.('none');
        return;
      }
      if (!options.isActive()) return;
      options.onAudioStatus?.('loading');
      const audioContext = await this.ensureAudioContext();
      if (!options.isActive()) return;
      this.audioSource = audioContext.createBufferSource();
      this.audioSource.buffer = prepared.audioBuffer;
      this.audioSource.loop = options.loop;
      this.audioSource.playbackRate.value = options.playbackRate;
      this.audioSource.connect(audioContext.destination);
      this.audioSource.start(0, Math.min(options.offset, prepared.audioBuffer.duration));
      options.onAudioStatus?.('ready');
    }

    async destroy() {
      await this.stop();
      if (this.audioContext && this.audioContext.state !== 'closed') {
        await this.audioContext.close().catch(() => {});
      }
      this.audioContext = null;
    }

    async showFrame(prepared, frameIndex = 0) {
      await this.stop();
      const { manifest, clipId } = prepared;
      if (this.canvas.width !== manifest.width || this.canvas.height !== manifest.height) {
        this.canvas.width = manifest.width;
        this.canvas.height = manifest.height;
      }
      drawFrame(this.context, this.canvas, prepared, frameIndex);
      this.manifest = manifest;
      this.currentClipId = clipId;
      this.canvas.dataset.clipId = clipId;
      this.canvas.dataset.animationReady = 'true';
      this.canvas.dataset.frameIndex = String(frameIndex);
      this.canvas.dataset.playbackState = 'held';
      this.statusElement && (this.statusElement.hidden = true);
      return manifest;
    }

    async playPrepared(prepared, options = {}) {
      await this.stop();
      const token = this.playToken;
      const { clipId, manifest } = prepared;
      if (this.canvas.width !== manifest.width || this.canvas.height !== manifest.height) {
        this.canvas.width = manifest.width;
        this.canvas.height = manifest.height;
      }

      const startAt = Math.min(0.1, manifest.duration / 3);
      const endAt = Math.max(startAt, manifest.duration - 0.03);
      const startFrame = Math.min(
        manifest.frameCount - 1,
        Math.floor(startAt * manifest.frameRate),
      );
      const playbackRate = Math.max(0.25, Math.min(16, Number(options.playbackRate) || 1));

      // Every next clip is fully decoded before this synchronous draw. Until this
      // line, the previous clip's final frame remains on the same canvas.
      drawFrame(this.context, this.canvas, prepared, startFrame);
      this.manifest = manifest;
      this.currentClipId = clipId;
      this.canvas.dataset.clipId = clipId;
      this.canvas.dataset.animationReady = 'true';
      this.canvas.dataset.frameIndex = String(startFrame);
      this.canvas.dataset.playbackState = 'playing';
      this.statusElement && (this.statusElement.hidden = true);

      const startedAt = performance.now();
      let ended = false;
      const loop = options.loop === true;
      const finish = (detail = { interrupted: false }) => {
        if (ended) return;
        ended = true;
        this.finishCurrent = null;
        try { this.audioSource?.stop(); } catch {}
        this.audioSource = null;
        options.onEnded?.(detail);
      };
      this.finishCurrent = loop ? null : finish;
      const render = (now) => {
        if (token !== this.playToken || ended) return;
        const elapsedSeconds = Math.max(0, (now - startedAt) / 1000) * playbackRate;
        const playableDuration = Math.max(0.001, endAt - startAt);
        const animationTime = loop
          ? startAt + (elapsedSeconds % playableDuration)
          : Math.min(startAt + elapsedSeconds, endAt);
        const frameIndex = Math.min(
          manifest.frameCount - 1,
          Math.floor(animationTime * manifest.frameRate),
        );
        drawFrame(this.context, this.canvas, prepared, frameIndex);
        this.canvas.dataset.frameIndex = String(frameIndex);
        if (!loop && animationTime >= endAt) {
          this.canvas.dataset.playbackState = 'held';
          finish();
          return;
        }
        this.animationFrame = requestAnimationFrame(render);
      };
      this.animationFrame = requestAnimationFrame(render);

      if (options.audio) {
        this.startAudio(prepared, {
          loop: options.audioLoop === true,
          offset: startAt,
          playbackRate,
          onAudioStatus: options.onAudioStatus,
          isActive: () => token === this.playToken && !ended,
        }).catch((error) => {
          options.onAudioStatus?.('error');
          console.warn(error);
        });
      } else {
        options.onAudioStatus?.('muted');
      }
      return manifest;
    }

    async play(clipId, options = {}) {
      this.statusElement && (this.statusElement.textContent = '正在调入督学官影像…');
      const prepared = await this.prepare(clipId, { audio: options.audio });
      return this.playPrepared(prepared, options);
    }
  }

  globalObject.DisciplineMediaPlayer = MediaPlayer;
}(window));
