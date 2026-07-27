(function exposeStudyPolicy(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.StudyPolicy = api;
}(typeof globalThis === 'object' ? globalThis : this, () => {
  'use strict';

  const SECOND_MS = 1_000;
  const MINUTE_MS = 60 * SECOND_MS;

  const MODE_RULES = Object.freeze({
    recite: Object.freeze({
      violationKind: 'silence',
      violationSeconds: Object.freeze({ minimum: 20, maximum: 60, default: 20 }),
      breakEveryMinutes: 20,
      breakVoucherMinutes: 2,
      praiseEveryMinutes: 45,
    }),
    study: Object.freeze({
      violationKind: 'suspected-speech',
      violationSeconds: Object.freeze({ minimum: 3, maximum: 15, default: 8 }),
      breakEveryMinutes: 45,
      breakVoucherMinutes: 2,
      praiseEveryMinutes: 60,
    }),
  });

  const QUIET_SENSITIVITY_DB = Object.freeze({ minimum: 6, maximum: 16, default: 10 });
  const DEFAULT_FRAME_MS = 100;
  const DEFAULT_REARM_QUIET_SECONDS = 1;
  const DEFAULT_TRANSIENT_ESCALATION_SECONDS = 2;
  const STUDY_AUDIO_EVENT_THRESHOLDS = Object.freeze({
    media: 0.20,
    speech: 0.12,
    broadcast: 0.12,
    keyboard: 0.18,
    strongNonStudySound: 0.35,
    keyboardMaskedMusic: 0.12,
    keyboardMaskedMusicCompanion: 0.02,
  });
  const KEYBOARD_EVENT_NAMES = new Set([
    'typing',
    'typewriter',
    'computer keyboard',
    'clicking',
    'clickety-clack',
  ]);
  const SPEECH_EVENT_NAMES = new Set([
    'speech',
    'male speech, man speaking',
    'female speech, woman speaking',
    'child speech, kid speaking',
    'conversation',
    'narration, monologue',
    'babbling',
    'speech synthesizer',
    'shout',
    'bellow',
    'whoop',
    'yell',
    'battle cry',
    'children shouting',
    'screaming',
    'whispering',
    'laughter',
    'baby laughter',
    'giggle',
    'snicker',
    'belly laugh',
    'chuckle, chortle',
    'crying, sobbing',
    'baby cry, infant cry',
    'whimper',
    'wail, moan',
    'singing',
    'choir',
    'yodeling',
    'chant',
    'mantra',
    'male singing',
    'female singing',
    'child singing',
    'synthetic singing',
    'rapping',
    'chatter',
    'hubbub, speech noise, speech babble',
    'a capella',
  ]);
  const BROADCAST_EVENT_NAMES = new Set(['television', 'radio']);
  const MUSIC_EVENT_NAMES = new Set(['musical instrument', 'keyboard (musical)']);
  const MEDIA_EFFECT_EVENT_NAMES = new Set([
    'crowd',
    'vehicle',
    'engine',
    'telephone',
    'ringtone',
    'alarm',
    'siren',
    'explosion',
    'gunshot, gunfire',
    'machine gun',
    'fireworks',
  ]);
  const STUDY_ALLOWED_EVENT_NAMES = new Set([
    ...KEYBOARD_EVENT_NAMES,
    'writing',
    'printer',
    'mechanical fan',
    'air conditioning',
    'clock',
    'tick',
    'tick-tock',
    'wind noise (microphone)',
    'silence',
    'noise',
    'environmental noise',
    'static',
    'mains hum',
    'white noise',
    'pink noise',
    'hum',
    'inside, small room',
    'inside, large room or hall',
    'breathing',
  ]);
  const STUDY_TRANSIENT_EVENT_NAMES = new Set([
    'cough',
    'throat clearing',
    'sneeze',
    'sniff',
    'rustle',
    'tap',
  ]);
  const MUSIC_EVENT_PATTERN = /(?:^|[^a-z])music(?:$|[^a-z])/u;
  const MUSIC_CORROBORATION_PATTERN = /(?:music|singing|choir|song|a capella|instrument|piano|organ|guitar|violin|cello|drum|saxophone|trumpet|flute|harp|accordion|harmonica|synthesizer)/u;

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function nonNegativeFinite(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, number) : fallback;
  }

  function nonNegativeInteger(value, fallback = 0) {
    return Math.floor(nonNegativeFinite(value, fallback));
  }

  function getModeRules(mode) {
    const rules = MODE_RULES[mode];
    if (!rules) throw new RangeError(`Unknown study mode: ${mode}`);
    return rules;
  }

  function normalizeViolationSeconds(mode, value) {
    const rules = getModeRules(mode).violationSeconds;
    const number = Number(value);
    if (!Number.isFinite(number)) return rules.default;
    return clamp(Math.round(number), rules.minimum, rules.maximum);
  }

  function normalizeQuietSensitivityDb(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return QUIET_SENSITIVITY_DB.default;
    return clamp(number, QUIET_SENSITIVITY_DB.minimum, QUIET_SENSITIVITY_DB.maximum);
  }

  function normalizeAudioEvent(event) {
    const name = String(event?.name || '').trim();
    const probability = clamp(Number(event?.prob) || 0, 0, 1);
    return { name, normalizedName: name.toLocaleLowerCase('en-US'), probability };
  }

  function classifyStudyAudioEvents(events, options = {}) {
    const mediaThreshold = clamp(
      Number(options.mediaThreshold) || STUDY_AUDIO_EVENT_THRESHOLDS.media,
      0,
      1,
    );
    const speechThreshold = clamp(
      Number(options.speechThreshold) || STUDY_AUDIO_EVENT_THRESHOLDS.speech,
      0,
      1,
    );
    const broadcastThreshold = clamp(
      Number(options.broadcastThreshold) || STUDY_AUDIO_EVENT_THRESHOLDS.broadcast,
      0,
      1,
    );
    const keyboardThreshold = clamp(
      Number(options.keyboardThreshold) || STUDY_AUDIO_EVENT_THRESHOLDS.keyboard,
      0,
      1,
    );
    const strongNonStudySoundThreshold = clamp(
      Number(options.strongNonStudySoundThreshold)
        || STUDY_AUDIO_EVENT_THRESHOLDS.strongNonStudySound,
      0,
      1,
    );
    const keyboardMaskedMusicThreshold = clamp(
      Number(options.keyboardMaskedMusicThreshold)
        || STUDY_AUDIO_EVENT_THRESHOLDS.keyboardMaskedMusic,
      0,
      1,
    );
    const keyboardMaskedMusicCompanionThreshold = clamp(
      Number(options.keyboardMaskedMusicCompanionThreshold)
        || STUDY_AUDIO_EVENT_THRESHOLDS.keyboardMaskedMusicCompanion,
      0,
      1,
    );
    let topMedia = { name: '', probability: 0 };
    let secondaryMedia = { name: '', probability: 0 };
    let topSpeech = { name: '', probability: 0 };
    let topBroadcast = { name: '', probability: 0 };
    let topKeyboard = { name: '', probability: 0 };
    let topStrongNonStudySound = { name: '', probability: 0 };
    let topTransientSound = { name: '', probability: 0 };
    let topMusicSignal = { name: '', probability: 0 };
    let secondaryMusicSignal = { name: '', probability: 0 };
    let tertiaryMusicSignal = { name: '', probability: 0 };
    for (const rawEvent of Array.isArray(events) ? events : []) {
      const event = normalizeAudioEvent(rawEvent);
      if (!event.name) continue;
      if (
        STUDY_TRANSIENT_EVENT_NAMES.has(event.normalizedName)
        && event.probability > topTransientSound.probability
      ) {
        topTransientSound = { name: event.name, probability: event.probability };
      }
      if (
        !STUDY_ALLOWED_EVENT_NAMES.has(event.normalizedName)
        && !STUDY_TRANSIENT_EVENT_NAMES.has(event.normalizedName)
        && event.probability > topStrongNonStudySound.probability
      ) {
        topStrongNonStudySound = { name: event.name, probability: event.probability };
      }
      if (KEYBOARD_EVENT_NAMES.has(event.normalizedName) && event.probability > topKeyboard.probability) {
        topKeyboard = { name: event.name, probability: event.probability };
      }
      if (BROADCAST_EVENT_NAMES.has(event.normalizedName) && event.probability > topBroadcast.probability) {
        topBroadcast = { name: event.name, probability: event.probability };
      }
      const speechEvent = SPEECH_EVENT_NAMES.has(event.normalizedName);
      if (speechEvent && event.probability > topSpeech.probability) {
        topSpeech = { name: event.name, probability: event.probability };
      }
      if (
        speechEvent
        || BROADCAST_EVENT_NAMES.has(event.normalizedName)
        || MUSIC_EVENT_NAMES.has(event.normalizedName)
        || MEDIA_EFFECT_EVENT_NAMES.has(event.normalizedName)
        || MUSIC_EVENT_PATTERN.test(event.normalizedName)
      ) {
        if (event.probability > topMedia.probability) {
          secondaryMedia = topMedia;
          topMedia = { name: event.name, probability: event.probability };
        } else if (event.probability > secondaryMedia.probability) {
          secondaryMedia = { name: event.name, probability: event.probability };
        }
      }
      if (
        MUSIC_EVENT_NAMES.has(event.normalizedName)
        || MUSIC_CORROBORATION_PATTERN.test(event.normalizedName)
      ) {
        if (event.probability > topMusicSignal.probability) {
          tertiaryMusicSignal = secondaryMusicSignal;
          secondaryMusicSignal = topMusicSignal;
          topMusicSignal = { name: event.name, probability: event.probability };
        } else if (event.probability > secondaryMusicSignal.probability) {
          tertiaryMusicSignal = secondaryMusicSignal;
          secondaryMusicSignal = { name: event.name, probability: event.probability };
        } else if (event.probability > tertiaryMusicSignal.probability) {
          tertiaryMusicSignal = { name: event.name, probability: event.probability };
        }
      }
    }

    const keyboardEvidence = topKeyboard.probability >= keyboardThreshold;
    const speechEvidence = topSpeech.probability >= speechThreshold;
    const strongNonStudySoundEvidence = (
      topStrongNonStudySound.probability >= strongNonStudySoundThreshold
    );
    const transientEvidence = topTransientSound.probability >= strongNonStudySoundThreshold;
    const keyboardMaskedMusicEvidence = keyboardEvidence
      && topMusicSignal.probability >= keyboardMaskedMusicThreshold
      && secondaryMusicSignal.probability >= keyboardMaskedMusicCompanionThreshold
      && tertiaryMusicSignal.probability >= keyboardMaskedMusicCompanionThreshold;
    const mediaEvidence = (
      topMedia.probability >= mediaThreshold
      || speechEvidence
      || topBroadcast.probability >= broadcastThreshold
      || strongNonStudySoundEvidence
      || keyboardMaskedMusicEvidence
    );
    const keyboardMixedMediaEvidence = keyboardEvidence && mediaEvidence;
    return Object.freeze({
      mediaEvidence,
      speechEvidence,
      transientEvidence,
      strongNonStudySoundEvidence,
      keyboardEvidence,
      keyboardMaskedMusicEvidence,
      keyboardOnly: keyboardEvidence && !mediaEvidence,
      keyboardMixedMediaEvidence,
      mediaScore: topMedia.probability,
      mediaLabel: topMedia.name,
      secondaryMediaScore: secondaryMedia.probability,
      secondaryMediaLabel: secondaryMedia.name,
      speechScore: topSpeech.probability,
      speechLabel: topSpeech.name,
      broadcastScore: topBroadcast.probability,
      broadcastLabel: topBroadcast.name,
      strongNonStudySoundScore: topStrongNonStudySound.probability,
      strongNonStudySoundLabel: topStrongNonStudySound.name,
      transientScore: topTransientSound.probability,
      transientLabel: topTransientSound.name,
      keyboardScore: topKeyboard.probability,
      keyboardLabel: topKeyboard.name,
      musicSignalScore: topMusicSignal.probability,
      musicSignalLabel: topMusicSignal.name,
      secondaryMusicSignalScore: secondaryMusicSignal.probability,
      secondaryMusicSignalLabel: secondaryMusicSignal.name,
      tertiaryMusicSignalScore: tertiaryMusicSignal.probability,
      tertiaryMusicSignalLabel: tertiaryMusicSignal.name,
    });
  }

  class EffectiveStudyClock {
    constructor(options = {}) {
      this.now = typeof options.now === 'function' ? options.now : Date.now;
      this.accumulatedMs = nonNegativeFinite(options.elapsedMs);
      this.running = false;
      this.resumedAt = null;
      if (options.running) this.resume(options.at);
    }

    timestamp(value) {
      const candidate = value === undefined ? Number(this.now()) : Number(value);
      if (!Number.isFinite(candidate)) throw new TypeError('Clock timestamp must be finite.');
      return candidate;
    }

    resume(at) {
      if (this.running) return this.elapsedMs(at);
      this.running = true;
      this.resumedAt = this.timestamp(at);
      return this.accumulatedMs;
    }

    pause(at) {
      if (!this.running) return this.accumulatedMs;
      const timestamp = this.timestamp(at);
      this.accumulatedMs += Math.max(0, timestamp - this.resumedAt);
      this.running = false;
      this.resumedAt = null;
      return this.accumulatedMs;
    }

    elapsedMs(at) {
      if (!this.running) return this.accumulatedMs;
      const timestamp = this.timestamp(at);
      return this.accumulatedMs + Math.max(0, timestamp - this.resumedAt);
    }

    snapshot(at) {
      return Object.freeze({
        elapsedMs: this.elapsedMs(at),
        running: this.running,
      });
    }
  }

  class MilestoneLedger {
    constructor(mode, state = {}) {
      this.mode = mode;
      this.rules = getModeRules(mode);
      if (state.mode !== undefined && state.mode !== mode) {
        throw new RangeError('Milestone state belongs to another study mode.');
      }
      this.settledBreakMilestones = nonNegativeInteger(state.settledBreakMilestones);
      this.settledPraiseMilestones = nonNegativeInteger(state.settledPraiseMilestones);
      this.availableBreakVouchers = nonNegativeInteger(state.availableBreakVouchers);
    }

    settle(effectiveElapsedMs) {
      const elapsedMs = nonNegativeFinite(effectiveElapsedMs);
      const breakEveryMs = this.rules.breakEveryMinutes * MINUTE_MS;
      const praiseEveryMs = this.rules.praiseEveryMinutes * MINUTE_MS;
      const dueBreakMilestones = Math.floor(elapsedMs / breakEveryMs);
      const duePraiseMilestones = Math.floor(elapsedMs / praiseEveryMs);
      const events = [];

      for (let index = this.settledBreakMilestones + 1; index <= dueBreakMilestones; index += 1) {
        events.push({
          type: 'break-voucher-earned',
          mode: this.mode,
          milestoneIndex: index,
          atEffectiveMs: index * breakEveryMs,
          voucherDurationMs: this.rules.breakVoucherMinutes * MINUTE_MS,
        });
        this.availableBreakVouchers += 1;
      }
      this.settledBreakMilestones = Math.max(this.settledBreakMilestones, dueBreakMilestones);

      for (let index = this.settledPraiseMilestones + 1; index <= duePraiseMilestones; index += 1) {
        events.push({
          type: 'praise-earned',
          mode: this.mode,
          milestoneIndex: index,
          atEffectiveMs: index * praiseEveryMs,
        });
      }
      this.settledPraiseMilestones = Math.max(this.settledPraiseMilestones, duePraiseMilestones);

      events.sort((left, right) => (
        left.atEffectiveMs - right.atEffectiveMs
        || left.type.localeCompare(right.type)
      ));
      return events;
    }

    consumeBreakVoucher() {
      if (this.availableBreakVouchers < 1) {
        return Object.freeze({ consumed: false, durationMs: 0, remainingVouchers: 0 });
      }
      this.availableBreakVouchers -= 1;
      return Object.freeze({
        consumed: true,
        durationMs: this.rules.breakVoucherMinutes * MINUTE_MS,
        remainingVouchers: this.availableBreakVouchers,
      });
    }

    availableBreakMs() {
      return this.availableBreakVouchers * this.rules.breakVoucherMinutes * MINUTE_MS;
    }

    snapshot() {
      return Object.freeze({
        mode: this.mode,
        settledBreakMilestones: this.settledBreakMilestones,
        settledPraiseMilestones: this.settledPraiseMilestones,
        availableBreakVouchers: this.availableBreakVouchers,
      });
    }
  }

  class QuietModeDetector {
    constructor(options = {}) {
      this.violationSeconds = normalizeViolationSeconds('study', options.violationSeconds);
      this.sensitivityDb = normalizeQuietSensitivityDb(options.sensitivityDb);
      this.rearmQuietMs = Math.max(
        SECOND_MS,
        nonNegativeFinite(options.rearmQuietSeconds, DEFAULT_REARM_QUIET_SECONDS) * SECOND_MS,
      );
      this.evidenceGapToleranceMs = Math.max(
        0,
        nonNegativeFinite(options.evidenceGapSeconds, 0) * SECOND_MS,
      );
      this.evidenceOverlapMs = Math.max(
        0,
        nonNegativeFinite(options.evidenceOverlapSeconds, 0) * SECOND_MS,
      );
      this.transientEscalationMs = Math.max(
        SECOND_MS,
        nonNegativeFinite(
          options.transientEscalationSeconds,
          DEFAULT_TRANSIENT_ESCALATION_SECONDS,
        ) * SECOND_MS,
      );
      this.defaultFrameMs = Math.max(1, nonNegativeFinite(options.frameMs, DEFAULT_FRAME_MS));
      this.reset();
    }

    reset() {
      this.armed = true;
      this.rawEvidenceMs = 0;
      this.suspectedSpeechMs = 0;
      this.quietMs = 0;
      this.evidenceGapMs = 0;
      this.transientEvidenceMs = 0;
    }

    setViolationSeconds(value) {
      this.violationSeconds = normalizeViolationSeconds('study', value);
      this.rawEvidenceMs = Math.min(
        this.rawEvidenceMs,
        this.violationThresholdMs() + this.evidenceOverlapMs,
      );
      this.suspectedSpeechMs = Math.min(
        Math.max(0, this.rawEvidenceMs - this.evidenceOverlapMs),
        this.violationThresholdMs(),
      );
      return this.violationSeconds;
    }

    setSensitivityDb(value) {
      this.sensitivityDb = normalizeQuietSensitivityDb(value);
      return this.sensitivityDb;
    }

    violationThresholdMs() {
      return this.violationSeconds * SECOND_MS;
    }

    rawSpeechEvidence(feature = {}) {
      if (typeof feature.mediaEvidence === 'boolean') return feature.mediaEvidence;
      if (typeof feature.speechEvidence === 'boolean') return feature.speechEvidence;
      if (typeof feature.suspectedSpeech === 'boolean') return feature.suspectedSpeech;

      const levelDb = Number(feature.levelDb ?? feature.db);
      const noiseFloorDb = Number(feature.noiseFloorDb);
      const levelDeltaDb = Number.isFinite(Number(feature.levelDeltaDb))
        ? Number(feature.levelDeltaDb)
        : levelDb - noiseFloorDb;
      const voiceRatio = Number(feature.voiceRatio);
      const flux = Number(feature.flux);
      const amplitudeChangeDb = Number(feature.amplitudeChangeDb);
      const hasMovement = (Number.isFinite(flux) && flux >= 0.035)
        || (Number.isFinite(amplitudeChangeDb) && amplitudeChangeDb >= 1.6);

      return feature.steadyNoise !== true
        && Number.isFinite(levelDeltaDb)
        && levelDeltaDb >= this.sensitivityDb
        && Number.isFinite(voiceRatio)
        && voiceRatio >= 0.42
        && hasMovement;
    }

    process(feature = {}, frameMs = this.defaultFrameMs) {
      const durationMs = Math.max(0, nonNegativeFinite(frameMs, this.defaultFrameMs));
      const rawEvidence = this.rawSpeechEvidence(feature);
      const transientEvidence = feature.transientEvidence === true;
      if (rawEvidence || !transientEvidence) this.transientEvidenceMs = 0;
      else this.transientEvidenceMs += durationMs;
      const transientEscalated = !rawEvidence
        && transientEvidence
        && this.transientEvidenceMs >= this.transientEscalationMs;
      const evidence = rawEvidence || transientEscalated;
      const neutralTransient = transientEvidence && !evidence;
      let violated = false;
      let rearmed = false;

      if (!this.armed) {
        this.rawEvidenceMs = 0;
        this.suspectedSpeechMs = 0;
        this.evidenceGapMs = 0;
        if (evidence) {
          this.quietMs = 0;
        } else if (neutralTransient) {
          // One isolated cough/page turn does not rearm a warned detector.
        } else {
          this.quietMs += durationMs;
          if (this.quietMs >= this.rearmQuietMs) {
            this.armed = true;
            this.quietMs = 0;
            rearmed = true;
          }
        }
      } else if (evidence) {
        this.quietMs = 0;
        this.evidenceGapMs = 0;
        this.rawEvidenceMs += durationMs;
        this.suspectedSpeechMs = Math.max(0, this.rawEvidenceMs - this.evidenceOverlapMs);
        if (this.suspectedSpeechMs >= this.violationThresholdMs()) {
          violated = true;
          this.armed = false;
          this.rawEvidenceMs = 0;
          this.suspectedSpeechMs = 0;
          this.quietMs = 0;
          this.evidenceGapMs = 0;
        }
      } else if (!neutralTransient) {
        // Preserve a candidate through one short classification gap, but reset
        // both raw and overlap-adjusted evidence once the tolerance expires.
        if (this.rawEvidenceMs > 0 && this.evidenceGapToleranceMs > 0) {
          this.evidenceGapMs += durationMs;
          if (this.evidenceGapMs >= this.evidenceGapToleranceMs) {
            this.rawEvidenceMs = 0;
            this.suspectedSpeechMs = 0;
            this.evidenceGapMs = 0;
          }
        } else {
          this.rawEvidenceMs = 0;
          this.suspectedSpeechMs = 0;
          this.evidenceGapMs = 0;
        }
      }

      return Object.freeze({
        rawEvidence,
        evidence,
        transientEvidence,
        transientEscalated,
        neutralTransient,
        violated,
        rearmed,
        armed: this.armed,
        rawEvidenceMs: this.rawEvidenceMs,
        suspectedSpeechMs: this.suspectedSpeechMs,
        quietMs: this.quietMs,
        evidenceGapMs: this.evidenceGapMs,
        violationThresholdMs: this.violationThresholdMs(),
        rearmQuietMs: this.rearmQuietMs,
        evidenceGapToleranceMs: this.evidenceGapToleranceMs,
        evidenceOverlapMs: this.evidenceOverlapMs,
        transientEvidenceMs: this.transientEvidenceMs,
        transientEscalationMs: this.transientEscalationMs,
      });
    }

    snapshot() {
      return Object.freeze({
        armed: this.armed,
        rawEvidenceMs: this.rawEvidenceMs,
        suspectedSpeechMs: this.suspectedSpeechMs,
        quietMs: this.quietMs,
        evidenceGapMs: this.evidenceGapMs,
        violationSeconds: this.violationSeconds,
        sensitivityDb: this.sensitivityDb,
        rearmQuietMs: this.rearmQuietMs,
        evidenceGapToleranceMs: this.evidenceGapToleranceMs,
        evidenceOverlapMs: this.evidenceOverlapMs,
        transientEvidenceMs: this.transientEvidenceMs,
        transientEscalationMs: this.transientEscalationMs,
      });
    }
  }

  return Object.freeze({
    MODE_RULES,
    QUIET_SENSITIVITY_DB,
    STUDY_AUDIO_EVENT_THRESHOLDS,
    EffectiveStudyClock,
    MilestoneLedger,
    QuietModeDetector,
    getModeRules,
    normalizeViolationSeconds,
    normalizeQuietSensitivityDb,
    classifyStudyAudioEvents,
  });
}));
