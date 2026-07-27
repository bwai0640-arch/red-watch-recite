const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Pure Node source test: no Electron, windows, microphone, user data, or network.
const source = fs.readFileSync(
  path.join(__dirname, '..', 'renderer', 'media-player.js'),
  'utf8',
);
assert.match(source, /MAX_RESIDENT_SHEETS\s*=\s*3/, 'missing hard global sheet-cache limit');
assert.doesNotMatch(
  source,
  /manifest\.sheets\.map\([^)]*loadImage/s,
  'media player regressed to loading every sheet in a clip at once',
);

const blockedClips = new Set();
const blockedImages = new Map();
const createdSheets = [];
const warnings = [];
let decodedImages = 0;
let peakDecodedImages = 0;
let nextAnimationFrame = 1;
const animationFrames = new Map();

function clipIdFromUrl(url) {
  return /\/media\/([^/]+)\//.exec(url)?.[1] || '';
}

function sheetKeyFromUrl(url) {
  const clipId = clipIdFromUrl(url);
  const sheetIndex = /sheet-(\d+)\.webp$/.exec(url)?.[1];
  return `${clipId}/${sheetIndex}`;
}

class FakeImage {
  constructor() {
    this.onload = null;
    this.onerror = null;
    this._src = '';
    this.clipId = '';
    this.decoded = false;
  }

  set src(value) {
    if (!value) {
      if (this.decoded) decodedImages -= 1;
      this.decoded = false;
      this._src = '';
      return;
    }
    this._src = value;
    this.clipId = clipIdFromUrl(value);
    createdSheets.push(sheetKeyFromUrl(value));
    if (blockedClips.has(this.clipId)) {
      const images = blockedImages.get(this.clipId) || [];
      images.push(this);
      blockedImages.set(this.clipId, images);
      return;
    }
    queueMicrotask(() => this.finishLoad());
  }

  get src() {
    return this._src;
  }

  finishLoad() {
    if (!this._src || typeof this.onload !== 'function') return;
    if (!this.decoded) {
      this.decoded = true;
      decodedImages += 1;
      peakDecodedImages = Math.max(peakDecodedImages, decodedImages);
    }
    this.onload();
  }
}

function blockClip(clipId) {
  blockedClips.add(clipId);
}

function unblockClip(clipId) {
  blockedClips.delete(clipId);
  const images = blockedImages.get(clipId) || [];
  blockedImages.delete(clipId);
  images.forEach((image) => image.finishLoad());
}

function manifestFor(clipId) {
  return {
    clipId,
    width: 16,
    height: 9,
    duration: 4,
    frameRate: 1,
    frameCount: 4,
    sheets: Array.from({ length: 4 }, (_, index) => ({
      file: `sheet-${index}.webp`,
      count: 1,
      cols: 1,
    })),
  };
}

const drawLog = [];
const canvas = {
  width: 16,
  height: 9,
  dataset: {},
  getContext() {
    return {
      drawImage(image) {
        drawLog.push(image.clipId);
        canvas.dataset.visibleClip = image.clipId;
      },
    };
  },
};

const sandbox = {
  window: {},
  Image: FakeImage,
  fetch: async (url) => {
    const clipId = clipIdFromUrl(url);
    assert.match(url, /manifest\.json$/, 'this test must not fetch audio or other assets eagerly');
    return { ok: true, status: 200, json: async () => manifestFor(clipId) };
  },
  requestAnimationFrame(callback) {
    const id = nextAnimationFrame;
    nextAnimationFrame += 1;
    animationFrames.set(id, callback);
    return id;
  },
  cancelAnimationFrame(id) {
    animationFrames.delete(id);
  },
  performance: { now: () => 0 },
  console: { warn: (...args) => warnings.push(args) },
  queueMicrotask,
};

vm.runInNewContext(source, sandbox, { filename: 'renderer/media-player.js' });
const MediaPlayer = sandbox.window.DisciplineMediaPlayer;

async function flush() {
  await new Promise((resolve) => setImmediate(resolve));
}

async function runNextFrame(now) {
  const entry = animationFrames.entries().next().value;
  assert.ok(entry, 'expected a pending animation frame');
  const [id, callback] = entry;
  animationFrames.delete(id);
  callback(now);
  await flush();
}

async function run() {
  const player = new MediaPlayer(canvas);
  blockClip('B');

  const [clipA, clipB, clipC] = await Promise.all([
    player.prepare('A', { audio: false }),
    player.prepare('B', { audio: false }),
    player.prepare('C', { audio: false }),
  ]);

  assert.deepEqual(createdSheets, [], 'prepare() eagerly decoded large sprite sheets');

  await player.playPrepared(clipA, { audio: false });
  await flush();
  assert.equal(canvas.dataset.visibleClip, 'A', 'first clip did not become visible');
  assert.deepEqual(
    createdSheets,
    ['A/0', 'B/0', 'A/1'],
    'player must keep only current/next sheet plus the next clip entry sheet',
  );
  assert.equal(clipC.sheetCache.size, 0, 'third clip was hydrated before it became next');

  const switchToB = player.playPrepared(clipB, { audio: false });
  await flush();
  assert.equal(canvas.dataset.visibleClip, 'A', 'slow next load cleared the held previous frame');
  assert.ok(clipA.sheetCache.size > 0, 'previous clip was released before the next first frame was ready');

  unblockClip('B');
  await switchToB;
  await flush();
  assert.equal(canvas.dataset.visibleClip, 'B', 'next clip did not replace the previous frame');
  assert.equal(clipA.sheetCache.size, 0, 'previous clip sprite sheets were retained after switching');
  assert.deepEqual([...clipB.sheetCache.keys()].sort(), [0, 1], 'active clip must retain current + next only');
  assert.deepEqual([...clipC.sheetCache.keys()], [0], 'third clip entry sheet was not prefetched');
  assert.ok(peakDecodedImages <= 3, `decoded image peak exceeded hard sheet cap: ${peakDecodedImages}`);

  await player.playPrepared(clipC, { audio: false });
  await flush();
  assert.equal(clipB.sheetCache.size, 0, 'second clip was retained after the third clip became active');
  assert.equal(canvas.dataset.visibleClip, 'C');
  await runNextFrame(1_100);
  assert.deepEqual(
    [...clipC.sheetCache.keys()].sort(),
    [1, 2],
    'playback did not release the previous sheet and preload exactly one following sheet',
  );
  await runNextFrame(2_100);
  assert.deepEqual([...clipC.sheetCache.keys()].sort(), [2, 3]);
  assert.ok(peakDecodedImages <= 3, `intra-clip playback exceeded hard sheet cap: ${peakDecodedImages}`);

  // Hostile interruption: abandon a blocked prefetched clip, jump to a newer plan,
  // and prove the abandoned Image load is cancelled before the new clip hydrates.
  blockClip('E');
  const [clipD, clipE] = await Promise.all([
    player.prepare('D', { audio: false }),
    player.prepare('E', { audio: false }),
  ]);
  await player.playPrepared(clipD, { audio: false });
  await flush();
  assert.equal(createdSheets.at(-2), 'E/0', 'expected E to be the blocked next prefetch');

  const clipX = await player.prepare('X', { audio: false });
  await player.playPrepared(clipX, { audio: false });
  await flush();
  assert.equal(clipE.sheetCache.size, 0, 'abandoned prefetched clip retained decoded resources');
  assert.equal(clipE.sheetLoads.size, 0, 'abandoned Image requests were not cancelled');
  assert.equal(canvas.dataset.visibleClip, 'X');
  assert.ok(peakDecodedImages <= 3, `interrupted plan exceeded hard sheet cap: ${peakDecodedImages}`);

  unblockClip('E');
  await flush();
  assert.equal(clipE.sheetCache.size, 0, 'cancelled prefetch revived after its delayed image completed');
  assert.equal(warnings.length, 0, 'intentional prefetch cancellation produced a noisy warning');

  assert.deepEqual(
    drawLog.filter((clipId, index) => index === 0 || drawLog[index - 1] !== clipId),
    ['A', 'B', 'C', 'D', 'X'],
    'clip transitions were not direct and ordered',
  );

  await player.destroy();
  assert.equal(decodedImages, 0, 'destroy() retained decoded sprite sheets');
  console.log('media preload policy tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
