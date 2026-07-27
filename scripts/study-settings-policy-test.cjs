'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  DEFAULT_STUDY_SETTINGS,
  MAX_SETTINGS_FILE_BYTES,
  normalizeStudySettings,
  readStudySettings,
  validateStudySettingsPayload,
  writeStudySettings,
} = require('../study-settings-policy');

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rwt-study-settings-'));
const settingsPath = path.join(temporaryRoot, 'study-preferences.json');

(async () => {
  try {
    assert.deepEqual(readStudySettings(settingsPath), {
      exists: false,
      settings: { ...DEFAULT_STUDY_SETTINGS },
    });

    const normalized = normalizeStudySettings({
      mode: 'study',
      reciteSilenceSeconds: 999,
      studyVoiceSeconds: -10,
      microphoneDeviceId: 'device-a',
      microphoneDeviceLabel: 'USB 麦克风',
      reciteSensitivityDb: 18,
    });
    assert.deepEqual(normalized, {
      mode: 'study',
      reciteSilenceSeconds: 60,
      studyVoiceSeconds: 3,
      microphoneDeviceId: 'device-a',
      microphoneDeviceLabel: 'USB 麦克风',
    });

    const payload = {
      mode: 'recite',
      reciteSilenceSeconds: 37,
      studyVoiceSeconds: 8,
      microphoneDeviceId: 'exact-device-id',
      microphoneDeviceLabel: '桌面麦克风',
    };
    assert.deepEqual(validateStudySettingsPayload(payload), payload);
    assert.throws(
      () => validateStudySettingsPayload({ ...payload, reciteSensitivityDb: 8 }),
      /字段无效/,
    );
    assert.throws(
      () => validateStudySettingsPayload({ ...payload, reciteSilenceSeconds: 19 }),
      /内容无效/,
    );

    await writeStudySettings(settingsPath, payload);
    assert.deepEqual(readStudySettings(settingsPath), { exists: true, settings: payload });
    const disk = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    assert.deepEqual(Object.keys(disk).sort(), [
      'microphoneDeviceId',
      'microphoneDeviceLabel',
      'mode',
      'reciteSilenceSeconds',
      'schemaVersion',
      'studyVoiceSeconds',
    ]);
    assert.equal('reciteSensitivityDb' in disk, false);

    const replacement = {
      ...payload,
      mode: 'study',
      reciteSilenceSeconds: 45,
      studyVoiceSeconds: 12,
    };
    await writeStudySettings(settingsPath, replacement);
    assert.deepEqual(readStudySettings(settingsPath), { exists: true, settings: replacement });

    fs.writeFileSync(settingsPath, '{corrupt', 'utf8');
    assert.deepEqual(readStudySettings(settingsPath), {
      exists: true,
      settings: { ...DEFAULT_STUDY_SETTINGS },
    });

    fs.truncateSync(settingsPath, MAX_SETTINGS_FILE_BYTES + 1);
    assert.deepEqual(readStudySettings(settingsPath), {
      exists: true,
      settings: { ...DEFAULT_STUDY_SETTINGS },
    });

    console.log(JSON.stringify({
      durableSettings: true,
      exactMicrophoneStored: true,
      legacyNoiseControlRejected: true,
      realUserDataTouched: false,
    }, null, 2));
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
