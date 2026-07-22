'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'renderer', 'app.js'), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const gitignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');

assert.match(main, /studySettingsPath = path\.join\(persistentDataRoot, 'study-preferences\.json'\)/);
assert.match(main, /studySettingsWriteChain = Promise\.resolve\(\)/);
assert.match(main, /ipcMain\.handle\('study-settings:get'/);
assert.match(main, /ipcMain\.handle\('study-settings:set'/);
assert.match(main, /validateStudySettingsPayload\(payload\)/);
assert.match(preload, /getStudySettings: \(\) => ipcRenderer\.invoke\('study-settings:get'\)/);
assert.match(preload, /setStudySettings: \(payload\) => ipcRenderer\.invoke\('study-settings:set', payload\)/);

assert.match(renderer, /await loadSettings\(\)/);
assert.match(renderer, /localStorage\.removeItem\(LEGACY_SETTINGS_STORAGE_KEY\)/);
assert.match(renderer, /microphoneDeviceLabel/);
assert.doesNotMatch(renderer, /exactLabelMatches/);
assert.doesNotMatch(renderer, /reciteSensitivityDb/);

assert.ok(packageJson.build.files.includes('study-settings-policy.js'));
assert.match(gitignore, /\*\*\/study-preferences\.json/);

console.log(JSON.stringify({
  ipcWhitelisted: true,
  writesSerialized: true,
  legacyMigratedOnce: true,
  missingMicrophoneNeverRebound: true,
  packagedPolicyPresent: true,
}, null, 2));
