const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {
  MODE_RULES,
  QUIET_SENSITIVITY_DB,
  EffectiveStudyClock,
  MilestoneLedger,
  QuietModeDetector,
  normalizeViolationSeconds,
  normalizeQuietSensitivityDb,
} = require('../renderer/study-policy.js');

const browserContext = {};
vm.runInNewContext(
  fs.readFileSync(path.join(__dirname, '..', 'renderer', 'study-policy.js'), 'utf8'),
  browserContext,
  { filename: 'study-policy.js' },
);
assert.equal(typeof browserContext.StudyPolicy, 'object');
assert.equal(browserContext.StudyPolicy.MODE_RULES.study.violationSeconds.default, 8);
assert.equal(typeof browserContext.StudyPolicy.QuietModeDetector, 'function');

const SECOND = 1_000;
const MINUTE = 60 * SECOND;

assert.deepEqual(MODE_RULES.recite.violationSeconds, { minimum: 20, maximum: 60, default: 20 });
assert.equal(MODE_RULES.recite.breakEveryMinutes, 20);
assert.equal(MODE_RULES.recite.breakVoucherMinutes, 2);
assert.equal(MODE_RULES.recite.praiseEveryMinutes, 45);
assert.deepEqual(MODE_RULES.study.violationSeconds, { minimum: 3, maximum: 15, default: 8 });
assert.equal(MODE_RULES.study.breakEveryMinutes, 45);
assert.equal(MODE_RULES.study.breakVoucherMinutes, 2);
assert.equal(MODE_RULES.study.praiseEveryMinutes, 60);
assert.equal(Object.isFrozen(MODE_RULES), true);
assert.equal(Object.isFrozen(MODE_RULES.study), true);
assert.equal(normalizeViolationSeconds('recite', 1), 20);
assert.equal(normalizeViolationSeconds('recite', 90), 60);
assert.equal(normalizeViolationSeconds('recite', undefined), 20);
assert.equal(normalizeViolationSeconds('study', 1), 3);
assert.equal(normalizeViolationSeconds('study', 99), 15);
assert.equal(normalizeViolationSeconds('study', undefined), 8);
assert.throws(() => normalizeViolationSeconds('missing', 8), /Unknown study mode/);

let now = 1_000;
const clock = new EffectiveStudyClock({ now: () => now });
assert.equal(clock.elapsedMs(), 0);
clock.resume();
now += 5_000;
assert.equal(clock.elapsedMs(), 5_000);
clock.pause();
now += 20_000;
assert.equal(clock.elapsedMs(), 5_000, 'paused clock advanced');
clock.resume();
now += 4_000;
assert.equal(clock.pause(), 9_000);
assert.equal(clock.snapshot().running, false);
clock.resume();
clock.resume();
now += 1_000;
assert.equal(clock.pause(), 10_000, 'idempotent resume reset the active interval');

const reciteLedger = new MilestoneLedger('recite');
assert.deepEqual(reciteLedger.settle((20 * MINUTE) - 1), []);
let events = reciteLedger.settle(20 * MINUTE);
assert.deepEqual(events.map((event) => event.type), ['break-voucher-earned']);
assert.equal(reciteLedger.availableBreakMs(), 2 * MINUTE);
events = reciteLedger.settle(91 * MINUTE);
assert.deepEqual(
  events.map((event) => [event.type, event.atEffectiveMs / MINUTE]),
  [
    ['break-voucher-earned', 40],
    ['praise-earned', 45],
    ['break-voucher-earned', 60],
    ['break-voucher-earned', 80],
    ['praise-earned', 90],
  ],
);
assert.deepEqual(reciteLedger.settle(91 * MINUTE), [], 'settlement reissued milestones');
assert.equal(reciteLedger.availableBreakMs(), 8 * MINUTE);
let voucher = reciteLedger.consumeBreakVoucher();
assert.deepEqual(voucher, { consumed: true, durationMs: 2 * MINUTE, remainingVouchers: 3 });
assert.equal(reciteLedger.availableBreakMs(), 6 * MINUTE);
const restoredLedger = new MilestoneLedger('recite', reciteLedger.snapshot());
assert.deepEqual(restoredLedger.settle(91 * MINUTE), [], 'restored settlement reissued milestones');
restoredLedger.consumeBreakVoucher();
restoredLedger.consumeBreakVoucher();
restoredLedger.consumeBreakVoucher();
voucher = restoredLedger.consumeBreakVoucher();
assert.deepEqual(voucher, { consumed: false, durationMs: 0, remainingVouchers: 0 });

const studyLedger = new MilestoneLedger('study');
events = studyLedger.settle(60 * MINUTE);
assert.deepEqual(
  events.map((event) => [event.type, event.atEffectiveMs / MINUTE]),
  [
    ['break-voucher-earned', 45],
    ['praise-earned', 60],
  ],
);

assert.deepEqual(QUIET_SENSITIVITY_DB, { minimum: 6, maximum: 16, default: 10 });
assert.equal(normalizeQuietSensitivityDb(-10), 6);
assert.equal(normalizeQuietSensitivityDb(100), 16);
assert.equal(normalizeQuietSensitivityDb(undefined), 10);

const rawSpeech = {
  levelDb: -28,
  noiseFloorDb: -42,
  voiceRatio: 0.7,
  flux: 0.1,
  steadyNoise: false,
};
const rawQuiet = {
  levelDb: -42,
  noiseFloorDb: -42,
  voiceRatio: 0.5,
  flux: 0.005,
  steadyNoise: true,
};

const boundaryDetector = new QuietModeDetector({ violationSeconds: 3, frameMs: 100 });
for (let index = 0; index < 29; index += 1) {
  assert.equal(boundaryDetector.process({ speechEvidence: true }).violated, false);
}
assert.equal(boundaryDetector.process({ speechEvidence: true }).violated, true, '3-second boundary did not violate');
assert.equal(boundaryDetector.process({ speechEvidence: true }).violated, false, 'unarmed detector repeated violation');
for (let index = 0; index < 9; index += 1) {
  assert.equal(boundaryDetector.process({ speechEvidence: false }).rearmed, false);
}
assert.equal(boundaryDetector.process({ speechEvidence: false }).rearmed, true, 'detector did not rearm after 1 second quiet');

const keyboardDetector = new QuietModeDetector({ violationSeconds: 3, frameMs: 100 });
for (let index = 0; index < 9; index += 1) {
  assert.equal(keyboardDetector.process({ speechEvidence: true, isSpeech: true }).violated, false);
}
for (let index = 0; index < 25; index += 1) {
  const result = keyboardDetector.process({ speechEvidence: false, isSpeech: true });
  assert.equal(result.evidence, false, 'VAD hangover was treated as raw evidence');
  assert.equal(result.violated, false, 'short keyboard impulse plus hangover violated');
}
for (let index = 0; index < 100; index += 1) {
  const result = keyboardDetector.process({ speechEvidence: index % 2 === 0 });
  assert.equal(result.violated, false, 'isolated keyboard pulse train accumulated');
}

const defaultDetector = new QuietModeDetector({ frameMs: 100 });
for (let index = 0; index < 79; index += 1) {
  assert.equal(defaultDetector.process(rawSpeech).violated, false);
}
assert.equal(defaultDetector.process(rawSpeech).violated, true, 'default 8-second speech did not violate');

const sensitivityDetector = new QuietModeDetector({ violationSeconds: 3, sensitivityDb: 999 });
assert.equal(sensitivityDetector.sensitivityDb, 16);
assert.equal(sensitivityDetector.process({ ...rawSpeech, levelDb: -26.1 }).evidence, false);
assert.equal(sensitivityDetector.process({ ...rawSpeech, levelDb: -26 }).evidence, true, 'upper threshold boundary was exclusive');
assert.equal(sensitivityDetector.setSensitivityDb(-999), 6);
assert.equal(sensitivityDetector.process({ ...rawSpeech, levelDb: -36 }).evidence, true, 'lower threshold boundary was exclusive');
assert.equal(sensitivityDetector.process(rawQuiet).evidence, false);
assert.equal(sensitivityDetector.setViolationSeconds(1), 3);
assert.equal(sensitivityDetector.setViolationSeconds(99), 15);

console.log(JSON.stringify({
  modes: Object.keys(MODE_RULES),
  clockElapsedMs: clock.elapsedMs(),
  reciteMilestonesSettled: reciteLedger.snapshot(),
  studyMilestonesAt60Minutes: events.map((event) => event.type),
  quietDefaultViolationSeconds: defaultDetector.snapshot().violationSeconds,
  keyboardHangoverIgnored: true,
  thresholdsClamped: true,
}));
