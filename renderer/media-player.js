(function exposeMediaPlayer(globalObject) {
  const MAX_RESIDENT_SHEETS = 3;

  function loadImage(url, onCreate) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        image.onload = null;
        image.onerror = null;
        callback(value);
      };
      const cancel = () => {
        const error = new Error(`动画预加载已取消：${url}`);
        error.code = 'MEDIA_PRELOAD_CANCELLED';
        finish(reject, error);
        try { image.src = ''; } catch {}
      };
      onCreate?.({ image, cancel });
      image.onload = () => finish(resolve, image);
      image.onerror = () => finish(reject, new Error(`无法加载动画帧：${url}`));
      image.src = url;
    });
  }

  function releaseImage(image) {
    if (!image) return;
    image.onload = null;
    image.onerror = null;
    try { image.src = ''; } catch {}
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

  function drawFrame(context, canvas, prepared, frameIndex, image) {
    const { manifest } = prepared;
    const { sheet, localFrame } = locateFrame(manifest, frameIndex);
    const sourceX = (localFrame % sheet.cols) * manifest.width;
    const sourceY = Math.floor(localFrame / sheet.cols) * manifest.height;
    context.drawImage(
      image,
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
      this.pendingPrepared = [];
      this.activePrepared = null;
      this.knownPrepared = new Set();
      this.destroyed = false;
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
      const prepared = {
        clipId,
        clipBase,
        manifest: null,
        manifestPromise: null,
        audioRequested: options.audio === true,
        sheetCache: new Map(),
        sheetPromises: new Map(),
        sheetLoads: new Map(),
        sheetVersions: new Map(),
        sheetLastUsed: new Map(),
        lastDrawnSheetIndex: null,
        requiredSheetIndex: null,
        audioBuffer: null,
        audioPromise: null,
        resourceGeneration: 0,
      };
      this.pendingPrepared.push(prepared);
      this.knownPrepared.add(prepared);
      prepared.manifestPromise = fetch(`${clipBase}/manifest.json`).then(async (response) => {
        if (!response.ok) throw new Error(`动画清单读取失败：${response.status}`);
        prepared.manifest = await response.json();
        return prepared.manifest;
      });
      try {
        await prepared.manifestPromise;
        return prepared;
      } catch (error) {
        this.removePendingPrepared(prepared);
        this.knownPrepared.delete(prepared);
        throw error;
      }
    }

    removePendingPrepared(prepared) {
      const index = this.pendingPrepared.indexOf(prepared);
      if (index >= 0) this.pendingPrepared.splice(index, 1);
    }

    consumePrepared(prepared) {
      const index = this.pendingPrepared.indexOf(prepared);
      const discarded = index >= 0
        ? this.pendingPrepared.splice(0, index + 1)
        : this.pendingPrepared.splice(0);
      discarded.forEach((candidate) => {
        if (candidate !== prepared && candidate !== this.activePrepared) {
          this.releasePrepared(candidate);
        }
      });
    }

    sheetSlotCount() {
      let count = 0;
      this.knownPrepared.forEach((prepared) => {
        const indices = new Set([
          ...prepared.sheetCache.keys(),
          ...prepared.sheetPromises.keys(),
        ]);
        count += indices.size;
      });
      return count;
    }

    releaseSheet(prepared, sheetIndex) {
      prepared.sheetVersions.set(sheetIndex, (prepared.sheetVersions.get(sheetIndex) || 0) + 1);
      prepared.sheetLoads.get(sheetIndex)?.cancel();
      prepared.sheetLoads.delete(sheetIndex);
      prepared.sheetPromises.delete(sheetIndex);
      releaseImage(prepared.sheetCache.get(sheetIndex));
      prepared.sheetCache.delete(sheetIndex);
      prepared.sheetLastUsed.delete(sheetIndex);
      if (prepared.lastDrawnSheetIndex === sheetIndex) prepared.lastDrawnSheetIndex = null;
    }

    makeRoomForSheet(targetPrepared, targetSheetIndex) {
      while (this.sheetSlotCount() >= MAX_RESIDENT_SHEETS) {
        const candidates = [];
        this.knownPrepared.forEach((prepared) => {
          const indices = new Set([
            ...prepared.sheetCache.keys(),
            ...prepared.sheetPromises.keys(),
          ]);
          indices.forEach((sheetIndex) => {
            if (prepared === targetPrepared && sheetIndex === targetSheetIndex) return;
            if (prepared.requiredSheetIndex === sheetIndex) return;
            if (prepared === this.activePrepared && prepared.lastDrawnSheetIndex === sheetIndex) return;
            candidates.push({
              prepared,
              sheetIndex,
              lastUsed: prepared.sheetLastUsed.get(sheetIndex) || 0,
              active: prepared === this.activePrepared ? 1 : 0,
            });
          });
        });
        candidates.sort((left, right) => left.active - right.active || left.lastUsed - right.lastUsed);
        const candidate = candidates[0];
        if (!candidate) throw new Error('动画帧缓存已达到安全上限');
        this.releaseSheet(candidate.prepared, candidate.sheetIndex);
      }
    }

    async ensurePreparedSheet(prepared, sheetIndex) {
      const manifest = prepared.manifest || await prepared.manifestPromise;
      const sheet = manifest.sheets[sheetIndex];
      if (!sheet) return null;
      if (prepared.sheetCache.has(sheetIndex)) {
        prepared.sheetLastUsed.set(sheetIndex, performance.now());
        return prepared.sheetCache.get(sheetIndex);
      }
      if (prepared.sheetPromises.has(sheetIndex)) {
        return prepared.sheetPromises.get(sheetIndex);
      }

      this.makeRoomForSheet(prepared, sheetIndex);
      const resourceGeneration = prepared.resourceGeneration;
      const sheetVersion = prepared.sheetVersions.get(sheetIndex) || 0;
      let loadHandle = null;
      const imagePromise = loadImage(
        `${prepared.clipBase}/${sheet.file}`,
        (load) => {
          loadHandle = load;
          prepared.sheetLoads.set(sheetIndex, load);
        },
      );
      const promise = imagePromise.then((image) => {
        const stale = this.destroyed
          || resourceGeneration !== prepared.resourceGeneration
          || sheetVersion !== (prepared.sheetVersions.get(sheetIndex) || 0);
        if (stale) {
          releaseImage(image);
          return null;
        }
        prepared.sheetCache.set(sheetIndex, image);
        prepared.sheetLastUsed.set(sheetIndex, performance.now());
        return image;
      }).finally(() => {
        if (prepared.sheetLoads.get(sheetIndex) === loadHandle) {
          prepared.sheetLoads.delete(sheetIndex);
        }
        if (prepared.sheetPromises.get(sheetIndex) === promise) {
          prepared.sheetPromises.delete(sheetIndex);
        }
      });
      prepared.sheetPromises.set(sheetIndex, promise);
      return promise;
    }

    trimPreparedSheets(prepared, keepIndices) {
      const retained = new Set(keepIndices.filter((index) => Number.isInteger(index)));
      const existing = new Set([
        ...prepared.sheetCache.keys(),
        ...prepared.sheetPromises.keys(),
      ]);
      existing.forEach((sheetIndex) => {
        if (!retained.has(sheetIndex)) this.releaseSheet(prepared, sheetIndex);
      });
    }

    followingSheetIndex(prepared, sheetIndex, loop) {
      const sheetCount = prepared.manifest.sheets.length;
      if (sheetIndex + 1 < sheetCount) return sheetIndex + 1;
      return loop && sheetCount > 1 ? 0 : null;
    }

    prefetchSheet(prepared, sheetIndex) {
      if (!Number.isInteger(sheetIndex)
        || prepared.sheetCache.has(sheetIndex)
        || prepared.sheetPromises.has(sheetIndex)) return;
      this.ensurePreparedSheet(prepared, sheetIndex).catch((error) => {
        if (error?.code === 'MEDIA_PRELOAD_CANCELLED') return;
        console.warn(`动画分片预加载失败：${prepared.clipId}/${sheetIndex}`, error);
      });
    }

    maintainPreparedSheets(prepared, currentSheetIndex, loop) {
      const nextSheetIndex = this.followingSheetIndex(prepared, currentSheetIndex, loop);
      this.trimPreparedSheets(prepared, [currentSheetIndex, nextSheetIndex]);
      this.prefetchSheet(prepared, nextSheetIndex);
    }

    drawPreparedFrame(prepared, frameIndex) {
      const { sheetIndex } = locateFrame(prepared.manifest, frameIndex);
      const image = prepared.sheetCache.get(sheetIndex);
      if (!image) return null;
      drawFrame(this.context, this.canvas, prepared, frameIndex, image);
      prepared.lastDrawnSheetIndex = sheetIndex;
      prepared.sheetLastUsed.set(sheetIndex, performance.now());
      return sheetIndex;
    }

    async ensurePreparedAudio(prepared) {
      if (prepared.audioBuffer) return prepared.audioBuffer;
      if (prepared.audioPromise) return prepared.audioPromise;
      const manifest = prepared.manifest || await prepared.manifestPromise;
      if (!manifest.audio?.keyHex) return null;
      const generation = prepared.resourceGeneration;
      const promise = fetch(`${prepared.clipBase}/audio.rwa`).then(async (audioResponse) => {
        if (!audioResponse.ok) throw new Error(`音频读取失败：${audioResponse.status}`);
        const decrypted = decryptAudio(await audioResponse.arrayBuffer(), manifest.audio.keyHex);
        const audioContext = await this.ensureAudioContext();
        const audioBuffer = await audioContext.decodeAudioData(decrypted.slice(0));
        if (generation !== prepared.resourceGeneration || this.destroyed) return null;
        prepared.audioBuffer = audioBuffer;
        return audioBuffer;
      });
      prepared.audioPromise = promise;
      try {
        return await promise;
      } catch (error) {
        if (prepared.audioPromise === promise) prepared.audioPromise = null;
        throw error;
      }
    }

    async hydratePrepared(prepared, options = {}) {
      if (this.destroyed) throw new Error('动画播放器已关闭');
      this.knownPrepared.add(prepared);
      const manifest = prepared.manifest || await prepared.manifestPromise;
      const frameIndex = Math.max(0, Math.min(
        manifest.frameCount - 1,
        Number.isInteger(options.frameIndex) ? options.frameIndex : 0,
      ));
      const { sheetIndex } = locateFrame(manifest, frameIndex);
      if (options.required === true) prepared.requiredSheetIndex = sheetIndex;
      try {
        const image = await this.ensurePreparedSheet(prepared, sheetIndex);
        if (!image) throw new Error(`动画分片准备失败：${prepared.clipId}/${sheetIndex}`);
        if (options.audio === true) await this.ensurePreparedAudio(prepared);
        return { manifest, sheetIndex };
      } finally {
        if (options.required === true && prepared.requiredSheetIndex === sheetIndex) {
          prepared.requiredSheetIndex = null;
        }
      }
    }

    releasePrepared(prepared) {
      if (!prepared) return;
      prepared.resourceGeneration += 1;
      const sheetIndices = new Set([
        ...prepared.sheetCache.keys(),
        ...prepared.sheetPromises.keys(),
      ]);
      sheetIndices.forEach((sheetIndex) => this.releaseSheet(prepared, sheetIndex));
      prepared.requiredSheetIndex = null;
      prepared.lastDrawnSheetIndex = null;
      prepared.audioBuffer = null;
      prepared.audioPromise = null;
      this.knownPrepared.delete(prepared);
    }

    prefetchNextPrepared() {
      const next = this.pendingPrepared[0];
      if (!next || next === this.activePrepared) return;
      this.hydratePrepared(next, {
        audio: next.audioRequested,
        frameIndex: 0,
        required: false,
      }).catch((error) => {
        if (error?.code === 'MEDIA_PRELOAD_CANCELLED') return;
        console.warn(`动画预加载失败：${next.clipId}`, error);
      });
    }

    activatePrepared(prepared) {
      const previous = this.activePrepared;
      this.activePrepared = prepared;
      if (previous && previous !== prepared) this.releasePrepared(previous);
      this.prefetchNextPrepared();
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
      this.destroyed = true;
      await this.stop();
      const preparedClips = new Set([
        ...this.knownPrepared,
        ...this.pendingPrepared,
        this.activePrepared,
      ]);
      preparedClips.forEach((prepared) => this.releasePrepared(prepared));
      this.pendingPrepared = [];
      this.activePrepared = null;
      if (this.audioContext && this.audioContext.state !== 'closed') {
        await this.audioContext.close().catch(() => {});
      }
      this.audioContext = null;
    }

    async showFrame(prepared, frameIndex = 0) {
      this.consumePrepared(prepared);
      await this.hydratePrepared(prepared, {
        audio: false,
        frameIndex,
        required: true,
      });
      await this.stop();
      const { manifest, clipId } = prepared;
      if (this.canvas.width !== manifest.width || this.canvas.height !== manifest.height) {
        this.canvas.width = manifest.width;
        this.canvas.height = manifest.height;
      }
      const sheetIndex = this.drawPreparedFrame(prepared, frameIndex);
      if (!Number.isInteger(sheetIndex)) throw new Error(`动画首帧未就绪：${clipId}`);
      this.manifest = manifest;
      this.currentClipId = clipId;
      this.canvas.dataset.clipId = clipId;
      this.canvas.dataset.animationReady = 'true';
      this.canvas.dataset.frameIndex = String(frameIndex);
      this.canvas.dataset.playbackState = 'held';
      this.statusElement && (this.statusElement.hidden = true);
      this.activatePrepared(prepared);
      this.maintainPreparedSheets(prepared, sheetIndex, false);
      return manifest;
    }

    async playPrepared(prepared, options = {}) {
      this.consumePrepared(prepared);
      const { clipId, manifest } = prepared;
      const startAt = Math.min(0.1, manifest.duration / 3);
      const endAt = Math.max(startAt, manifest.duration - 0.03);
      const startFrame = Math.min(
        manifest.frameCount - 1,
        Math.floor(startAt * manifest.frameRate),
      );
      const playbackRate = Math.max(0.25, Math.min(16, Number(options.playbackRate) || 1));
      const loop = options.loop === true;

      await this.hydratePrepared(prepared, {
        audio: options.audio === true || prepared.audioRequested,
        frameIndex: startFrame,
        required: true,
      });
      await this.stop();
      const token = this.playToken;
      if (this.canvas.width !== manifest.width || this.canvas.height !== manifest.height) {
        this.canvas.width = manifest.width;
        this.canvas.height = manifest.height;
      }

      // Only the first required sheet is decoded before this synchronous draw.
      // Until this line, the previous clip's final frame remains on the canvas.
      const startingSheetIndex = this.drawPreparedFrame(prepared, startFrame);
      if (!Number.isInteger(startingSheetIndex)) throw new Error(`动画首帧未就绪：${clipId}`);
      this.manifest = manifest;
      this.currentClipId = clipId;
      this.canvas.dataset.clipId = clipId;
      this.canvas.dataset.animationReady = 'true';
      this.canvas.dataset.frameIndex = String(startFrame);
      this.canvas.dataset.playbackState = 'playing';
      this.statusElement && (this.statusElement.hidden = true);
      this.activatePrepared(prepared);
      this.maintainPreparedSheets(prepared, startingSheetIndex, loop);

      const startedAt = performance.now();
      let ended = false;
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
        const sheetIndex = this.drawPreparedFrame(prepared, frameIndex);
        if (!Number.isInteger(sheetIndex)) {
          this.prefetchSheet(prepared, locateFrame(manifest, frameIndex).sheetIndex);
          this.animationFrame = requestAnimationFrame(render);
          return;
        }
        this.maintainPreparedSheets(prepared, sheetIndex, loop);
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
