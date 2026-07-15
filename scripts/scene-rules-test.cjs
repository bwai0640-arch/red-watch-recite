const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'renderer', 'scene-rules.js'), 'utf8');
const context = { window: {} };
vm.createContext(context);
vm.runInContext(source, context, { filename: 'scene-rules.js' });
const rules = context.window.DisciplineSceneRules;
const C = rules.CLIPS;

assert.deepEqual([...rules.introPlan().clips], [C.E1, C.S1, C.X1]);
assert.deepEqual([...rules.clockoffPlan().clips], [C.E1, C.R_SALUTE, C.X1]);
assert.deepEqual([...rules.NORMAL_REACTION_POOL], [C.R_PACE, C.R_NOTE, C.R_NOD, C.R_CLOSE_CHECK]);
assert.deepEqual([...rules.EXIT_POOL], [C.X1, C.X3, C.X4]);
assert.equal(rules.EXIT_POOL.includes(C.X6), false);
assert.equal(rules.NORMAL_REACTION_POOL.includes(C.R_FATIGUE), false);
assert.equal(rules.INDEPENDENT_POOL.includes(C.R_FATIGUE), false);
assert.equal(rules.NORMAL_REACTION_POOL.includes(C.R_SALUTE), false);
assert.deepEqual([...rules.INDEPENDENT_POOL], [C.L_LEAN, C.P_PASS_RED, C.P_PASS_BLUE]);

const values = (...items) => {
  let index = 0;
  return () => items[index++] ?? 0;
};

const independent = rules.scheduledPlan({ random: values(0.249, 0.999) });
assert.equal(independent.kind, 'independent');
assert.deepEqual([...independent.clips], [C.P_PASS_BLUE]);

const patrol = rules.scheduledPlan({ random: values(0.25, 0.999, 0.999, 0.999) });
assert.equal(patrol.kind, 'patrol');
assert.deepEqual([...patrol.clips], [C.E4, C.R_CLOSE_CHECK, C.X4]);

const MINUTE_MS = 60_000;
const completedMark = (elapsedMs, intervalMs) => Math.floor(elapsedMs / intervalMs);
const recitePraiseInterval = 45 * MINUTE_MS;
const selfStudyPraiseInterval = 60 * MINUTE_MS;

assert.equal(completedMark(recitePraiseInterval - 1, recitePraiseInterval), 0);
assert.equal(completedMark(recitePraiseInterval, recitePraiseInterval), 1);
assert.equal(completedMark(selfStudyPraiseInterval - 1, selfStudyPraiseInterval), 0);
assert.equal(completedMark(selfStudyPraiseInterval, selfStudyPraiseInterval), 1);

const recitePraise = rules.normalPatrolPlan({
  random: values(0, 0.5),
  completedPraiseMarks: completedMark(recitePraiseInterval, recitePraiseInterval),
  praisedMark: 0,
});
assert.equal(recitePraise.kind, 'milestonePraise');
assert.equal(recitePraise.milestonePraise, true);
assert.equal(recitePraise.praiseMark, 1);
assert.equal(recitePraise.reaction, C.R_SALUTE);
assert.equal(recitePraise.reaction, 'R_pass_react_salute');
assert.deepEqual([...recitePraise.clips], [C.E1, C.R_SALUTE, C.X3]);

const recitePraiseConsumed = rules.normalPatrolPlan({
  random: values(0, 0, 0),
  completedPraiseMarks: 1,
  praisedMark: recitePraise.praiseMark,
});
assert.equal(recitePraiseConsumed.kind, 'patrol');
assert.equal(recitePraiseConsumed.milestonePraise, false);
assert.equal(recitePraiseConsumed.praiseMark, 1);
assert.equal(recitePraiseConsumed.reaction, C.R_PACE);

const selfStudyPraise = rules.normalPatrolPlan({
  random: values(0.999, 0.999),
  completedPraiseMarks: completedMark(selfStudyPraiseInterval, selfStudyPraiseInterval),
  praisedMark: 0,
});
assert.equal(selfStudyPraise.kind, 'milestonePraise');
assert.equal(selfStudyPraise.praiseMark, 1);
assert.deepEqual([...selfStudyPraise.clips], [C.E4, C.R_SALUTE, C.X4]);

const selfStudyPraiseConsumed = rules.normalPatrolPlan({
  random: values(0, 0, 0),
  completedPraiseMarks: 1,
  praisedMark: selfStudyPraise.praiseMark,
});
assert.equal(selfStudyPraiseConsumed.kind, 'patrol');
assert.equal(selfStudyPraiseConsumed.reaction, C.R_PACE);

const scheduledPraise = rules.scheduledPlan({
  random: values(0.25, 0, 0.5),
  completedPraiseMarks: 1,
  praisedMark: 0,
});
assert.equal(scheduledPraise.kind, 'milestonePraise');
assert.equal(scheduledPraise.praiseMark, 1);
assert.deepEqual([...scheduledPraise.clips], [C.E1, C.R_SALUTE, C.X3]);

const legacyPraise = rules.normalPatrolPlan({
  random: values(0, 0.5), completedHours: 2, salutedHourMark: 1,
});
assert.equal(legacyPraise.kind, 'milestonePraise');
assert.equal(legacyPraise.praiseMark, 2);
assert.equal(legacyPraise.hourlySalute, true);
assert.equal(legacyPraise.salutedHourMark, 2);
assert.deepEqual([...legacyPraise.clips], [C.E1, C.R_SALUTE, C.X3]);

const first = rules.violationPlan({ livesRemaining: 3, random: values(0, 0) });
assert.deepEqual([...first.clips], [C.E1, C.R_YELL, C.X1]);
assert.equal(first.strike, 1);
assert.equal(first.fatal, false);

const second = rules.violationPlan({ livesRemaining: 2, random: values(0.3, 0.6) });
assert.deepEqual([...second.clips], [C.E2, C.R_GUN, C.X3]);
assert.equal(second.strike, 2);
assert.equal(second.fatal, false);

const shoot = rules.violationPlan({ livesRemaining: 1, random: values(0.1, 0.499) });
assert.deepEqual([...shoot.clips], [C.E1, C.R_SHOOT]);
assert.equal(shoot.fatal, true);
assert.equal(shoot.exit, null);

const whip = rules.violationPlan({ livesRemaining: 1, random: values(0.9, 0.5) });
assert.deepEqual([...whip.clips], [C.E4, C.R_WHIP]);
assert.equal(whip.fatal, true);
assert.equal(whip.exit, null);

assert.equal(rules.nextPatrolDelay(values(0)), 30_000);
assert.ok(rules.nextPatrolDelay(values(0.999999)) < 120_000);

console.log(JSON.stringify({
  intro: first.kind && rules.introPlan().clips,
  normalPool: rules.NORMAL_REACTION_POOL,
  independentProbability: rules.INDEPENDENT_EVENT_PROBABILITY,
  intervalMs: rules.PATROL_INTERVAL_MS,
  recitePraise: { kind: recitePraise.kind, mark: recitePraise.praiseMark, clip: recitePraise.reaction },
  selfStudyPraise: { kind: selfStudyPraise.kind, mark: selfStudyPraise.praiseMark, clip: selfStudyPraise.reaction },
  escalation: [first.reaction, second.reaction, [shoot.reaction, whip.reaction]],
  fatalHasExit: shoot.clips.some((clip) => rules.EXIT_POOL.includes(clip)),
  x6Scheduled: rules.EXIT_POOL.includes(C.X6),
}));
