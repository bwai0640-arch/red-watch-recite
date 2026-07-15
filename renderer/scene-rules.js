(function attachDisciplineSceneRules(globalObject) {
  const CLIPS = Object.freeze({
    E1: 'E1_enter_walk',
    E2: 'E2_enter_sneak',
    E3: 'E3_enter_rush',
    E4: 'E4_enter_prowl',
    R_YELL: 'R1_react_yell',
    R_PACE: 'R2_react_doubt',
    R_GUN: 'R_aim_react_gun',
    R_SHOOT: 'R_aim_shoot',
    R_WHIP: 'R_whip_react_lash',
    R_FATIGUE: 'R_fatigue_warning',
    R_NOTE: 'R_note_logbook',
    R_SALUTE: 'R_pass_react_salute',
    R_NOD: 'R_nod',
    R_CLOSE_CHECK: 'R_close_check',
    L_LEAN: 'L_lean',
    P_PASS_RED: 'P_pass_corridor_red',
    P_PASS_BLUE: 'P_pass_corridor_blue',
    S1: 'S1_intro_speech',
    X1: 'X1_exit',
    X3: 'X3_exit_backaway',
    X4: 'X4_exit_sideglance',
    X6: 'X6_exit_abrupt',
  });

  const ENTRY_POOL = Object.freeze([CLIPS.E1, CLIPS.E2, CLIPS.E3, CLIPS.E4]);
  const NORMAL_REACTION_POOL = Object.freeze([
    CLIPS.R_PACE,
    CLIPS.R_NOTE,
    CLIPS.R_NOD,
    CLIPS.R_CLOSE_CHECK,
  ]);
  const EXIT_POOL = Object.freeze([CLIPS.X1, CLIPS.X3, CLIPS.X4]);
  const INDEPENDENT_POOL = Object.freeze([
    CLIPS.L_LEAN,
    CLIPS.P_PASS_RED,
    CLIPS.P_PASS_BLUE,
  ]);

  const MAX_LIVES = 3;
  const PATROL_INTERVAL_MS = Object.freeze([30_000, 120_000]);
  const INDEPENDENT_EVENT_PROBABILITY = 0.25;

  function normalizedRandom(random = Math.random) {
    const value = Number(random());
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(0.999999999, value));
  }

  function pick(pool, random = Math.random) {
    return pool[Math.floor(normalizedRandom(random) * pool.length)] || pool[0];
  }

  function introPlan() {
    return {
      kind: 'intro',
      clips: [CLIPS.E1, CLIPS.S1, CLIPS.X1],
      fatal: false,
    };
  }

  function clockoffPlan() {
    return {
      kind: 'clockoff',
      clips: [CLIPS.E1, CLIPS.R_SALUTE, CLIPS.X1],
      fatal: false,
    };
  }

  function normalPatrolPlan(options = {}) {
    const random = options.random || Math.random;
    const completedPraiseMarks = Math.max(0, Math.floor(Number(
      options.completedPraiseMarks ?? options.completedHours,
    ) || 0));
    const praisedMark = Math.max(0, Math.floor(Number(
      options.praisedMark ?? options.salutedHourMark,
    ) || 0));
    const milestonePraise = completedPraiseMarks >= 1 && completedPraiseMarks > praisedMark;
    const praiseMark = milestonePraise ? completedPraiseMarks : praisedMark;
    const entry = pick(ENTRY_POOL, random);
    const reaction = milestonePraise ? CLIPS.R_SALUTE : pick(NORMAL_REACTION_POOL, random);
    const exit = pick(EXIT_POOL, random);
    return {
      kind: milestonePraise ? 'milestonePraise' : 'patrol',
      clips: [entry, reaction, exit],
      entry,
      reaction,
      exit,
      milestonePraise,
      praiseMark,
      completedPraiseMarks,
      praisedMark,
      // Temporary output aliases keep the previous caller readable while it
      // migrates from hour-specific names to generic praise milestones.
      hourlySalute: milestonePraise,
      salutedHourMark: praiseMark,
      fatal: false,
    };
  }

  function independentPlan(options = {}) {
    const event = pick(INDEPENDENT_POOL, options.random || Math.random);
    return {
      kind: 'independent',
      clips: [event],
      event,
      fatal: false,
    };
  }

  function scheduledPlan(options = {}) {
    const random = options.random || Math.random;
    return normalizedRandom(random) < INDEPENDENT_EVENT_PROBABILITY
      ? independentPlan({ random })
      : normalPatrolPlan({ ...options, random });
  }

  function violationPlan(options = {}) {
    const random = options.random || Math.random;
    const livesRemaining = Math.max(1, Math.min(MAX_LIVES, Math.floor(Number(options.livesRemaining) || MAX_LIVES)));
    const entry = pick(ENTRY_POOL, random);
    let reaction;
    let fatal = false;

    if (livesRemaining > 2) {
      reaction = CLIPS.R_YELL;
    } else if (livesRemaining === 2) {
      reaction = CLIPS.R_GUN;
    } else {
      reaction = normalizedRandom(random) < 0.5 ? CLIPS.R_SHOOT : CLIPS.R_WHIP;
      fatal = true;
    }

    const exit = fatal ? null : pick(EXIT_POOL, random);
    return {
      kind: 'violation',
      clips: fatal ? [entry, reaction] : [entry, reaction, exit],
      entry,
      reaction,
      exit,
      fatal,
      livesRemaining,
      strike: MAX_LIVES - livesRemaining + 1,
    };
  }

  function nextPatrolDelay(random = Math.random) {
    const [minimum, maximum] = PATROL_INTERVAL_MS;
    return minimum + normalizedRandom(random) * (maximum - minimum);
  }

  globalObject.DisciplineSceneRules = Object.freeze({
    CLIPS,
    ENTRY_POOL,
    NORMAL_REACTION_POOL,
    EXIT_POOL,
    INDEPENDENT_POOL,
    MAX_LIVES,
    PATROL_INTERVAL_MS,
    INDEPENDENT_EVENT_PROBABILITY,
    introPlan,
    clockoffPlan,
    normalPatrolPlan,
    independentPlan,
    scheduledPlan,
    violationPlan,
    nextPatrolDelay,
  });
}(window));
