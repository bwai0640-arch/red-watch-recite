(function exposeAdaptiveVad(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AdaptiveVad = api;
}(typeof globalThis === 'object' ? globalThis : this, () => {
  const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));

  function median(values) {
    if (!values.length) return -100;
    const sorted = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function standardDeviation(values) {
    if (!values.length) return 0;
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    return Math.sqrt(values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / values.length);
  }

  class AdaptiveVoiceDetector {
    constructor(options = {}) {
      this.calibrationFrames = options.calibrationFrames || 30;
      this.sensitivityDb = options.sensitivityDb || 8;
      this.freezeNoiseFloor = Boolean(options.freezeNoiseFloor);
      this.reset();
    }

    reset() {
      this.calibration = [];
      this.noiseFloorDb = -65;
      this.calibrated = false;
      this.levelHistory = [];
      this.fluxHistory = [];
      this.previousDb = -100;
      this.speechScore = 0;
      this.hangoverFrames = 0;
    }

    setSensitivity(value) {
      this.sensitivityDb = clamp(Number(value) || 8, 4, 18);
    }

    process(feature) {
      const db = clamp(Number(feature.db), -100, 0);
      const voiceRatio = clamp(Number(feature.voiceRatio) || 0, 0, 1);
      const flux = clamp(Number(feature.flux) || 0, 0, 1);
      const flatness = clamp(Number(feature.flatness) || 0, 0, 1);

      if (!this.calibrated) {
        this.calibration.push(db);
        if (this.calibration.length >= this.calibrationFrames) {
          this.noiseFloorDb = median(this.calibration);
          this.calibrated = true;
          this.levelHistory = this.calibration.slice(-12);
          this.fluxHistory = Array(this.levelHistory.length).fill(0);
        }
        this.previousDb = db;
        return {
          calibrated: this.calibrated,
          calibrationProgress: Math.min(1, this.calibration.length / this.calibrationFrames),
          isSpeech: false,
          levelDb: db,
          levelPercent: clamp(Math.round(db + 100), 0, 100),
          noiseFloorDb: this.noiseFloorDb,
          thresholdDb: this.noiseFloorDb + this.sensitivityDb,
          steadyNoise: true,
          speechEvidence: false,
          amplitudeChangeDb: Math.abs(db - this.previousDb),
          speechScore: 0,
          voiceRatio,
          flatness,
          flux,
        };
      }

      this.levelHistory.push(db);
      this.fluxHistory.push(flux);
      if (this.levelHistory.length > 20) this.levelHistory.shift();
      if (this.fluxHistory.length > 20) this.fluxHistory.shift();
      const recentLevels = this.levelHistory.slice(-12);
      const recentFlux = this.fluxHistory.slice(-12);
      const meanFlux = recentFlux.reduce((sum, value) => sum + value, 0) / recentFlux.length;
      const steadyNoise = recentLevels.length >= 12
        && standardDeviation(recentLevels) < 0.9
        && meanFlux < 0.028;
      const thresholdDb = this.noiseFloorDb + this.sensitivityDb;
      const levelDelta = db - this.noiseFloorDb;
      const amplitudeChange = Math.abs(db - this.previousDb);
      const hasVoiceBandEnergy = voiceRatio >= 0.42;
      const hasSpeechMovement = flux >= 0.035 || amplitudeChange >= 1.6;
      const evidence = !steadyNoise
        && levelDelta >= this.sensitivityDb
        && hasVoiceBandEnergy
        && hasSpeechMovement;

      if (evidence) this.speechScore = Math.min(8, this.speechScore + 2);
      else this.speechScore = Math.max(0, this.speechScore - 1);

      if (this.speechScore >= 3) this.hangoverFrames = 7;
      else if (this.hangoverFrames > 0) this.hangoverFrames -= 1;
      const isSpeech = this.speechScore >= 3 || this.hangoverFrames > 0;

      if (!isSpeech && !this.freezeNoiseFloor) {
        if (steadyNoise) {
          const steadyLevel = median(recentLevels);
          this.noiseFloorDb += clamp(steadyLevel - this.noiseFloorDb, -0.5, 0.5);
        } else if (db <= thresholdDb) {
          this.noiseFloorDb = (this.noiseFloorDb * 0.995) + (db * 0.005);
        }
      }

      this.previousDb = db;
      return {
        calibrated: true,
        calibrationProgress: 1,
        isSpeech,
        levelDb: db,
        levelPercent: clamp(Math.round(db + 100), 0, 100),
        noiseFloorDb: this.noiseFloorDb,
        thresholdDb: this.noiseFloorDb + this.sensitivityDb,
        steadyNoise,
        speechEvidence: evidence,
        amplitudeChangeDb: amplitudeChange,
        speechScore: this.speechScore,
        voiceRatio,
        flatness,
        flux,
      };
    }
  }

  return { AdaptiveVoiceDetector, median, standardDeviation };
}));
