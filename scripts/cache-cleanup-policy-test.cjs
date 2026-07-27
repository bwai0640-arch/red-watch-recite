'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { isValidCleanupTarget } = require('../cache-cleanup');
const source = fs.readFileSync(path.join(__dirname, '..', 'cache-cleanup.js'), 'utf8');

const pid = 43127;
const valid = path.resolve(
  path.parse(process.cwd()).root,
  'Users',
  'example',
  'AppData',
  'Roaming',
  '背书自习监督',
  'TransientElectronData',
  `run-${pid}`,
);

assert.equal(isValidCleanupTarget(valid, pid), true);
assert.equal(isValidCleanupTarget(path.dirname(valid), pid), false);
assert.equal(isValidCleanupTarget(path.resolve(valid, '..', '..'), pid), false);
assert.equal(isValidCleanupTarget(path.resolve(valid, '..', `run-${pid + 1}`), pid), false);
assert.equal(isValidCleanupTarget(path.resolve(path.parse(valid).root), pid), false);
assert.equal(isValidCleanupTarget('relative\\run-43127', pid), false);
assert.equal(isValidCleanupTarget(valid, 0), false);
assert.equal(isValidCleanupTarget(valid, Number.NaN), false);
assert.match(source, /stats\.isSymbolicLink\(\)/);
assert.match(source, /fs\.unlinkSync\(target\)/);

process.stdout.write('cache-cleanup-policy-test: ok\n');
