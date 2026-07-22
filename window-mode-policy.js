const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const path = require('node:path');

const BACKGROUND_MODES = Object.freeze(['hidden', 'floating']);
const WINDOW_MODES = Object.freeze(['scene', 'hidden', 'floating', 'alert']);
const RETURN_DISPOSITIONS = Object.freeze(['return', 'scene']);
const DEFAULT_BACKGROUND_MODE = 'hidden';

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validateExactModePayload(payload, key, allowedValues, message) {
  if (!isPlainObject(payload)) throw new Error(message);
  const keys = Reflect.ownKeys(payload);
  if (keys.length !== 1 || keys[0] !== key || !allowedValues.includes(payload[key])) {
    throw new Error(message);
  }
  return payload[key];
}

function validateBackgroundModePayload(payload) {
  return {
    mode: validateExactModePayload(
      payload,
      'mode',
      BACKGROUND_MODES,
      '后台显示参数无效。',
    ),
  };
}

function validateFinishAlertPayload(payload) {
  if (!isPlainObject(payload)) throw new Error('提醒结束参数无效。');
  const keys = Reflect.ownKeys(payload);
  const allowedKeys = new Set(['alertId', 'disposition']);
  if (
    keys.length !== allowedKeys.size
    || keys.some((key) => !allowedKeys.has(key))
    || !Number.isSafeInteger(payload.alertId)
    || payload.alertId <= 0
    || !RETURN_DISPOSITIONS.includes(payload.disposition)
  ) {
    throw new Error('提醒结束参数字段无效。');
  }
  return { alertId: payload.alertId, disposition: payload.disposition };
}

function validateWindowModeReadyPayload(payload) {
  if (!isPlainObject(payload)) throw new Error('窗口模式回执无效。');
  const keys = Reflect.ownKeys(payload);
  const allowedKeys = new Set(['transitionId', 'mode']);
  if (
    keys.length !== allowedKeys.size
    || keys.some((key) => !allowedKeys.has(key))
    || !Number.isSafeInteger(payload.transitionId)
    || payload.transitionId <= 0
    || !WINDOW_MODES.includes(payload.mode)
  ) {
    throw new Error('窗口模式回执字段无效。');
  }
  return { transitionId: payload.transitionId, mode: payload.mode };
}

function normalizeBackgroundMode(value) {
  return BACKGROUND_MODES.includes(value) ? value : DEFAULT_BACKGROUND_MODE;
}

function resolveAlertReturnMode(windowMode, visible) {
  if (windowMode === 'floating') return 'floating';
  if (windowMode === 'hidden' || !visible) return 'hidden';
  return 'scene';
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function clampFloatingBounds(bounds, workArea, size) {
  const width = Math.min(size.width, workArea.width);
  const height = Math.min(size.height, workArea.height);
  const rawX = Number(bounds?.x);
  const rawY = Number(bounds?.y);
  return {
    x: clamp(
      Math.round(Number.isFinite(rawX) ? rawX : workArea.x),
      workArea.x,
      workArea.x + workArea.width - width,
    ),
    y: clamp(
      Math.round(Number.isFinite(rawY) ? rawY : workArea.y),
      workArea.y,
      workArea.y + workArea.height - height,
    ),
    width,
    height,
  };
}

function floatingWindowBounds(workArea, {
  size = { width: 320, height: 225 },
  margin = 16,
  avoidBottomRight = null,
} = {}) {
  const width = Math.min(size.width, workArea.width);
  const height = Math.min(size.height, workArea.height);
  const bottomRight = {
    x: Math.max(workArea.x, workArea.x + workArea.width - width - margin),
    y: Math.max(workArea.y, workArea.y + workArea.height - height - margin),
    width,
    height,
  };
  if (!avoidBottomRight) return bottomRight;

  const aboveY = avoidBottomRight.y - height - margin;
  if (aboveY >= workArea.y) return { ...bottomRight, y: aboveY };

  return {
    x: Math.min(
      workArea.x + workArea.width - width,
      Math.max(workArea.x, workArea.x + margin),
    ),
    y: bottomRight.y,
    width,
    height,
  };
}

function readBackgroundPreference(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return normalizeBackgroundMode(parsed?.backgroundMode);
  } catch {
    return DEFAULT_BACKGROUND_MODE;
  }
}

async function writeBackgroundPreference(filePath, mode) {
  const backgroundMode = normalizeBackgroundMode(mode);
  const directory = path.dirname(filePath);
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fsPromises.mkdir(directory, { recursive: true });
  try {
    await fsPromises.writeFile(
      temporaryPath,
      `${JSON.stringify({ backgroundMode }, null, 2)}\n`,
      { encoding: 'utf8', mode: 0o600 },
    );
    await fsPromises.rename(temporaryPath, filePath);
  } finally {
    await fsPromises.rm(temporaryPath, { force: true }).catch(() => {});
  }
  return { backgroundMode };
}

module.exports = {
  BACKGROUND_MODES,
  DEFAULT_BACKGROUND_MODE,
  WINDOW_MODES,
  clampFloatingBounds,
  floatingWindowBounds,
  normalizeBackgroundMode,
  readBackgroundPreference,
  resolveAlertReturnMode,
  validateBackgroundModePayload,
  validateFinishAlertPayload,
  validateWindowModeReadyPayload,
  writeBackgroundPreference,
};
