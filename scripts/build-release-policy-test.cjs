'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const packageConfig = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
const source = fs.readFileSync(path.join(__dirname, 'build-release.cjs'), 'utf8');

assert.equal(packageConfig.scripts.dist, 'node scripts/build-release.cjs');
assert.equal(packageConfig.scripts['dist:installer'], 'node scripts/build-release.cjs');
assert.match(source, /work[\s\S]*release-candidate-\$\{packageConfig\.version\}/);
assert.match(source, /if \(fs\.existsSync\(candidateRoot\)\)[\s\S]*?will not be overwritten/);
assert.match(source, /\['dist', 'release-staging'\]/);
assert.match(source, /git[\s\S]*status[\s\S]*--porcelain=v1[\s\S]*--untracked-files=all/);
assert.match(source, /trackedInputHash\(\) !== inputHash/);
assert.match(source, /buildTarget\('nsis'\)/);
assert.match(source, /buildTarget\('portable'/);
assert.match(source, /portableArchiveHash !== installerArchiveHash/);
assert.match(source, /release-package-static-test\.cjs/);
assert.doesNotMatch(source, /rmSync|rm\(|rmdir|Remove-Item|del\s/i);

process.stdout.write('build-release-policy-test: ok\n');
