'use strict';

const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const path = require('node:path');

const SETTINGS_SCHEMA_VERSION = 1;
const STUDY_MODES = Object.freeze(['recite', 'study']);
const DEFAULT_STUDY_SETTINGS = Object.freeze({
  mode: 'recite',
  reciteSilenceSeconds: 20,
  studyVoiceSeconds: 8,
  microphoneDeviceId: '',
  microphoneDeviceLabel: '',
});

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function boundedInteger(value, minimum, maximum, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.round(number)));
}

function boundedString(value, maximumLength) {
  return typeof value === 'string' ? value.slice(0, maximumLength) : '';
}

function normalizeStudySettings(value) {
  const source = isPlainObject(value) ? value : {};
  return {
    mode: STUDY_MODES.includes(source.mode) ? source.mode : DEFAULT_STUDY_SETTINGS.mode,
    reciteSilenceSeconds: boundedInteger(
      source.reciteSilenceSeconds,
      20,
      60,
      DEFAULT_STUDY_SETTINGS.reciteSilenceSeconds,
    ),
    studyVoiceSeconds: boundedInteger(
      source.studyVoiceSeconds,
      3,
      15,
      DEFAULT_STUDY_SETTINGS.studyVoiceSeconds,
    ),
    microphoneDeviceId: boundedString(source.microphoneDeviceId, 512),
    microphoneDeviceLabel: boundedString(source.microphoneDeviceLabel, 160),
  };
}

function validateStudySettingsPayload(payload) {
  if (!isPlainObject(payload)) throw new Error('学习设置参数无效。');
  const allowedKeys = new Set(Object.keys(DEFAULT_STUDY_SETTINGS));
  const keys = Reflect.ownKeys(payload);
  if (keys.length !== allowedKeys.size || keys.some((key) => !allowedKeys.has(key))) {
    throw new Error('学习设置字段无效。');
  }
  const normalized = normalizeStudySettings(payload);
  if (
    normalized.mode !== payload.mode
    || normalized.reciteSilenceSeconds !== payload.reciteSilenceSeconds
    || normalized.studyVoiceSeconds !== payload.studyVoiceSeconds
    || normalized.microphoneDeviceId !== payload.microphoneDeviceId
    || normalized.microphoneDeviceLabel !== payload.microphoneDeviceLabel
  ) {
    throw new Error('学习设置内容无效。');
  }
  return normalized;
}

function readStudySettings(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return { exists: true, settings: normalizeStudySettings(parsed) };
  } catch (error) {
    return {
      exists: error?.code !== 'ENOENT',
      settings: { ...DEFAULT_STUDY_SETTINGS },
    };
  }
}

async function writeStudySettings(filePath, payload) {
  const settings = validateStudySettingsPayload(payload);
  const directory = path.dirname(filePath);
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fsPromises.mkdir(directory, { recursive: true });
  try {
    await fsPromises.writeFile(
      temporaryPath,
      `${JSON.stringify({ schemaVersion: SETTINGS_SCHEMA_VERSION, ...settings }, null, 2)}\n`,
      { encoding: 'utf8', mode: 0o600 },
    );
    await fsPromises.rename(temporaryPath, filePath);
  } finally {
    await fsPromises.rm(temporaryPath, { force: true }).catch(() => {});
  }
  return { ...settings };
}

module.exports = {
  DEFAULT_STUDY_SETTINGS,
  SETTINGS_SCHEMA_VERSION,
  normalizeStudySettings,
  readStudySettings,
  validateStudySettingsPayload,
  writeStudySettings,
};
