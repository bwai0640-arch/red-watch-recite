const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const candidateRoot = path.resolve(process.argv[2] || '');
if (!process.argv[2] || !fs.existsSync(candidateRoot)) {
  throw new Error('Usage: node scripts/release-package-static-test.cjs <candidate-root>');
}

const pnpmRoot = path.join(projectRoot, 'node_modules', '.pnpm');
const asarPackageDirectory = fs.readdirSync(pnpmRoot)
  .filter((name) => name.startsWith('@electron+asar@'))
  .sort()
  .at(-1);
if (!asarPackageDirectory) throw new Error('Unable to locate the bundled @electron/asar package.');
const asar = require(path.join(
  pnpmRoot,
  asarPackageDirectory,
  'node_modules',
  '@electron',
  'asar',
));

const resourcesRoot = path.join(candidateRoot, 'win-unpacked', 'resources');
const archivePath = path.join(resourcesRoot, 'app.asar');
const unpackedRoot = path.join(resourcesRoot, 'app.asar.unpacked');
assert.ok(fs.existsSync(archivePath), `Missing app.asar: ${archivePath}`);
assert.ok(fs.existsSync(unpackedRoot), `Missing app.asar.unpacked: ${unpackedRoot}`);

const normalizeEntry = (entry) => entry.replace(/^[/\\]+/, '').replaceAll('\\', '/');
const entries = asar.listPackage(archivePath).map(normalizeEntry);
const entrySet = new Set(entries);
const archivePathFor = (...parts) => path.win32.join(...parts);
const extract = (...parts) => asar.extractFile(archivePath, archivePathFor(...parts));
const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

const requiredEntries = [
  'main.js',
  'preload.js',
  'window-mode-policy.js',
  'study-settings-policy.js',
  'renderer/app.js',
  'renderer/index.html',
  'renderer/styles.css',
  'renderer/media/catalog.json',
  'models/3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx',
  'models/audio-tagging-ced-mini/model.int8.onnx',
  'models/audio-tagging-ced-mini/class_labels_indices.csv',
  'models/audio-tagging-ced-mini/SOURCE_README.md',
  'THIRD_PARTY_NOTICES.md',
];
for (const entry of requiredEntries) {
  assert.ok(entrySet.has(entry), `Required package entry is missing: ${entry}`);
}

const prohibitedPatterns = [
  /(^|\/)speaker-profile\.dat(?:\.|$)/i,
  /(^|\/)window-preferences\.json$/i,
  /(^|\/)study-preferences\.json$/i,
  /(^|\/)RedWatchReciteData(\/|$)/i,
  /(^|\/)work(\/|$)/i,
  /(^|\/)release-staging(\/|$)/i,
  /(^|\/)scripts(\/|$)/i,
  /(^|\/)docs(\/|$)/i,
  /(^|\/)(?:speaker-)?fixtures?(\/|$)/i,
  /(^|\/)\.env(?:\.|$)/i,
  /(^|\/)(?:SessionData|Code Cache|GPUCache)(\/|$)/i,
];
for (const entry of entries) {
  assert.equal(
    prohibitedPatterns.some((pattern) => pattern.test(entry)),
    false,
    `Prohibited package entry: ${entry}`,
  );
}

const exactSourceFiles = [
  'main.js',
  'preload.js',
  'window-mode-policy.js',
  'study-settings-policy.js',
  'cache-cleanup.js',
  'profile-crypto.js',
  'break-prompt-preload.js',
  'speaker-service.js',
  'speaker-worker.js',
  'audio-event-service.js',
  'audio-event-worker.js',
  'renderer/adaptive-vad.js',
  'renderer/app.js',
  'renderer/break-prompt.css',
  'renderer/break-prompt.html',
  'renderer/break-prompt.js',
  'renderer/index.html',
  'renderer/media-player.js',
  'renderer/scene-rules.js',
  'renderer/speaker-capture-worklet.js',
  'renderer/speaker-audio.js',
  'renderer/study-policy.js',
  'renderer/styles.css',
];
for (const relativePath of exactSourceFiles) {
  const source = fs.readFileSync(path.join(projectRoot, relativePath));
  const packed = extract(...relativePath.split('/'));
  assert.equal(sha256(packed), sha256(source), `Packed source differs: ${relativePath}`);
}

const packedPackage = JSON.parse(extract('package.json').toString('utf8'));
const sourcePackage = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
assert.equal(packedPackage.version, sourcePackage.version);
assert.equal(packedPackage.name, 'red-watch-recite');
assert.equal(sourcePackage.build.appId, 'top.redwatch.study-supervisor');
assert.equal(sourcePackage.build.productName, '凛冬督学局');
assert.equal(sourcePackage.build.win.artifactName, '凛冬督学局-安装版-${version}.exe');
assert.equal(sourcePackage.build.nsis.shortcutName, '凛冬督学局');
const packedMainSource = extract('main.js').toString('utf8');
const packedPreloadSource = extract('preload.js').toString('utf8');
const packedRendererSource = extract('renderer', 'app.js').toString('utf8');
assert.match(
  packedMainSource,
  /const testHooksEnabled = !app\.isPackaged[\s\S]*SUPERVISION_TEST_HOOKS === '1'/,
  'Packaged test hooks must require both a development build and an explicit opt-in.',
);
assert.match(packedMainSource, /devTools: !app\.isPackaged/);
assert.match(
  packedMainSource,
  /if \(app\.isPackaged\)[\s\S]*?removeSwitch\('remote-debugging-port'\)[\s\S]*?removeSwitch\('remote-debugging-pipe'\)/,
);
assert.match(
  packedMainSource,
  /ipcMain\.on\('test-hooks-enabled'[\s\S]*?event\.returnValue = Boolean\([\s\S]*?testHooksEnabled/,
);
assert.match(packedPreloadSource, /ipcRenderer\.sendSync\('test-hooks-enabled'\) === true/);
assert.doesNotMatch(packedPreloadSource, /process\.argv\.includes\('--supervision-test-hooks'\)/);
assert.doesNotMatch(packedMainSource, /additionalArguments:[\s\S]*supervision-test-hooks/);
assert.match(
  packedRendererSource,
  /if \(window\.desktopAPI\.testHooksEnabled\) window\.__beishuTest = Object\.freeze/,
);

const expectedArtifacts = [
  path.join(candidateRoot, `凛冬督学局-安装版-${sourcePackage.version}.exe`),
  path.join(candidateRoot, `凛冬督学局-便携版-${sourcePackage.version}.exe`),
  path.join(candidateRoot, 'win-unpacked', '凛冬督学局.exe'),
];
for (const artifact of expectedArtifacts) {
  assert.ok(fs.existsSync(artifact), `Missing renamed release artifact: ${artifact}`);
}

const catalog = JSON.parse(extract('renderer', 'media', 'catalog.json').toString('utf8'));
assert.equal(catalog.length, 22, 'The package must contain all 22 catalog animations.');
const audioEntries = new Set();
for (const clip of catalog) {
  const base = `renderer/media/${clip.id}`;
  const manifestEntry = `${base}/manifest.json`;
  assert.ok(entrySet.has(manifestEntry), `Missing manifest: ${clip.id}`);
  const manifest = JSON.parse(extract('renderer', 'media', clip.id, 'manifest.json').toString('utf8'));
  assert.equal(manifest.id, clip.id, `Manifest id mismatch: ${clip.id}`);
  assert.ok(Array.isArray(manifest.sheets) && manifest.sheets.length > 0, `Missing sheets: ${clip.id}`);
  for (const sheet of manifest.sheets) {
    assert.ok(entrySet.has(`${base}/${sheet.file}`), `Missing sheet for ${clip.id}: ${sheet.file}`);
  }
  assert.ok(manifest.audio?.path, `Missing source audio declaration: ${clip.id}`);
  const audio = `${base}/audio.rwa`;
  assert.ok(entrySet.has(audio), `Missing source audio for ${clip.id}`);
  audioEntries.add(audio);
}
assert.equal(audioEntries.size, 22, 'Every animation must retain its own source-library audio entry.');

function listFiles(root) {
  const result = [];
  const visit = (directory) => {
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, item.name);
      if (item.isDirectory()) visit(absolute);
      else result.push(normalizeEntry(path.relative(root, absolute)));
    }
  };
  visit(root);
  return result;
}

const unpackedFiles = listFiles(unpackedRoot);
for (const entry of unpackedFiles) {
  assert.equal(
    prohibitedPatterns.some((pattern) => pattern.test(entry)),
    false,
    `Prohibited unpacked entry: ${entry}`,
  );
}
for (const entry of [
  'models/3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx',
  'models/audio-tagging-ced-mini/model.int8.onnx',
  'models/audio-tagging-ced-mini/class_labels_indices.csv',
  'models/audio-tagging-ced-mini/SOURCE_README.md',
  'speaker-worker.js',
  'audio-event-worker.js',
  'node_modules/sherpa-onnx-win-x64/sherpa-onnx.node',
]) {
  assert.ok(unpackedFiles.includes(entry), `Required unpacked runtime file is missing: ${entry}`);
}

console.log(JSON.stringify({
  version: packedPackage.version,
  archiveEntries: entries.length,
  unpackedFiles: unpackedFiles.length,
  animations: catalog.length,
  sourceAudioEntries: audioEntries.size,
  coreSourceHashesMatched: exactSourceFiles.length,
  prohibitedEntries: 0,
}, null, 2));
