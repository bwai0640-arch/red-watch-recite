const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  clampFloatingBounds,
  floatingWindowBounds,
  readBackgroundPreference,
  resolveAlertReturnMode,
  validateBackgroundModePayload,
  validateFinishAlertPayload,
  validateWindowModeReadyPayload,
  writeBackgroundPreference,
} = require('../window-mode-policy');

function overlaps(first, second) {
  return first.x < second.x + second.width
    && first.x + first.width > second.x
    && first.y < second.y + second.height
    && first.y + first.height > second.y;
}

async function main() {
  assert.deepEqual(validateBackgroundModePayload({ mode: 'hidden' }), { mode: 'hidden' });
  assert.deepEqual(validateBackgroundModePayload({ mode: 'floating' }), { mode: 'floating' });
  assert.throws(() => validateBackgroundModePayload({ mode: 'floating', extra: true }), /参数/);
  assert.throws(() => validateBackgroundModePayload({ mode: 'alert' }), /参数/);
  assert.throws(() => validateBackgroundModePayload(null), /参数/);

  assert.deepEqual(
    validateFinishAlertPayload({ alertId: 7, disposition: 'return' }),
    { alertId: 7, disposition: 'return' },
  );
  assert.deepEqual(
    validateFinishAlertPayload({ disposition: 'scene', alertId: 8 }),
    { alertId: 8, disposition: 'scene' },
  );
  assert.throws(() => validateFinishAlertPayload({ alertId: 0, disposition: 'return' }), /字段/);
  assert.throws(() => validateFinishAlertPayload({ alertId: 1, disposition: 'floating' }), /字段/);
  assert.throws(
    () => validateFinishAlertPayload({ alertId: 1, disposition: 'return', returnMode: 'hidden' }),
    /字段/,
  );

  assert.deepEqual(
    validateWindowModeReadyPayload({ transitionId: 3, mode: 'floating' }),
    { transitionId: 3, mode: 'floating' },
  );
  assert.deepEqual(
    validateWindowModeReadyPayload({ mode: 'alert', transitionId: 4 }),
    { transitionId: 4, mode: 'alert' },
  );
  assert.throws(() => validateWindowModeReadyPayload({ transitionId: 0, mode: 'scene' }), /字段/);
  assert.throws(() => validateWindowModeReadyPayload({ transitionId: 1, mode: 'other' }), /字段/);
  assert.throws(
    () => validateWindowModeReadyPayload({ transitionId: 1, mode: 'scene', extra: true }),
    /字段/,
  );

  assert.equal(resolveAlertReturnMode('floating', true), 'floating');
  assert.equal(resolveAlertReturnMode('hidden', false), 'hidden');
  assert.equal(resolveAlertReturnMode('scene', false), 'hidden');
  assert.equal(resolveAlertReturnMode('scene', true), 'scene');

  const workArea = { x: 0, y: 0, width: 1920, height: 1040 };
  const prompt = { x: 1480, y: 800, width: 420, height: 220 };
  const ordinary = floatingWindowBounds(workArea);
  assert.deepEqual(ordinary, { x: 1584, y: 799, width: 320, height: 225 });
  const avoiding = floatingWindowBounds(workArea, { avoidBottomRight: prompt });
  assert.equal(overlaps(avoiding, prompt), false, 'floating window must not cover the break prompt');
  assert.equal(avoiding.y, 559);

  const shortArea = { x: 0, y: 0, width: 960, height: 460 };
  const shortPrompt = { x: 520, y: 220, width: 420, height: 220 };
  const fallback = floatingWindowBounds(shortArea, { avoidBottomRight: shortPrompt });
  assert.equal(fallback.x, 16, 'short displays should move the floating window to the left');
  assert.equal(overlaps(fallback, shortPrompt), false);

  const secondaryArea = { x: -1600, y: -200, width: 1600, height: 900 };
  assert.deepEqual(
    clampFloatingBounds({ x: 9000, y: -9000 }, secondaryArea, { width: 320, height: 225 }),
    { x: -320, y: -200, width: 320, height: 225 },
  );
  assert.deepEqual(
    clampFloatingBounds({ x: 0, y: 0 }, workArea, { width: 320, height: 225 }),
    { x: 0, y: 0, width: 320, height: 225 },
    'zero is a valid saved coordinate and must not be treated as missing',
  );

  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rwt-window-mode-'));
  const preferencePath = path.join(temporaryRoot, 'window-preferences.json');
  try {
    assert.equal(readBackgroundPreference(preferencePath), 'hidden');
    await writeBackgroundPreference(preferencePath, 'floating');
    assert.equal(readBackgroundPreference(preferencePath), 'floating');
    await writeBackgroundPreference(preferencePath, 'hidden');
    assert.equal(readBackgroundPreference(preferencePath), 'hidden');
    fs.writeFileSync(preferencePath, '{bad json', 'utf8');
    assert.equal(readBackgroundPreference(preferencePath), 'hidden');
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }

  console.log('window-mode-policy-test: ok');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
