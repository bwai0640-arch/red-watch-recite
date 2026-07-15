/* global AdaptiveVad, DisciplineMediaPlayer, DisciplineSceneRules, SpeakerAudio, StudyPolicy */

const UI = {
  startButton: document.querySelector('#start-button'),
  stopButton: document.querySelector('#stop-button'),
  breakButton: document.querySelector('#break-button'),
  backgroundButton: document.querySelector('#background-button'),
  controlsButton: document.querySelector('#controls-button'),
  exitButton: document.querySelector('#exit-button'),
  windowTitlebar: document.querySelector('#window-titlebar'),
  windowMinimizeButton: document.querySelector('#window-minimize-button'),
  windowMaximizeButton: document.querySelector('#window-maximize-button'),
  windowCloseButton: document.querySelector('#window-close-button'),
  timer: document.querySelector('#timer'),
  sessionState: document.querySelector('#session-state'),
  voiceState: document.querySelector('#voice-state'),
  voiceStatus: document.querySelector('#voice-status'),
  volumeBar: document.querySelector('#volume-bar'),
  meter: document.querySelector('.meter-wrap .meter'),
  thresholdMarker: document.querySelector('#volume-threshold'),
  voiceThreshold: document.querySelector('#voice-threshold-input'),
  voiceThresholdValue: document.querySelector('#voice-threshold-value'),
  voiceThresholdLabel: document.querySelector('#voice-threshold-label'),
  preflightTestButton: document.querySelector('#preflight-test-button'),
  preflightTestStatus: document.querySelector('#preflight-test-status'),
  silenceLimit: document.querySelector('#silence-limit-input'),
  silenceLimitValue: document.querySelector('#silence-limit-value'),
  studyVoiceLimit: document.querySelector('#study-voice-limit-input'),
  studyVoiceLimitValue: document.querySelector('#study-voice-limit-value'),
  reciteModeButton: document.querySelector('#recite-mode-button'),
  studyModeButton: document.querySelector('#study-mode-button'),
  modeTitle: document.querySelector('#mode-title'),
  sessionLabel: document.querySelector('#session-label'),
  voicePanelTitle: document.querySelector('#voice-panel-title'),
  liveVoiceState: document.querySelector('#live-voice-state'),
  liveVoiceTitle: document.querySelector('#live-voice-title'),
  liveVoiceDuration: document.querySelector('#live-voice-duration'),
  liveVolumeBar: document.querySelector('#live-volume-bar'),
  liveMeter: document.querySelector('#live-meter'),
  liveThresholdMarker: document.querySelector('#live-volume-threshold'),
  eventLog: document.querySelector('#event-log'),
  alertCount: document.querySelector('#alert-count'),
  mediaCount: document.querySelector('#media-count'),
  clipSelect: document.querySelector('#clip-select'),
  previewClipButton: document.querySelector('#preview-clip-button'),
  recalibrateButton: document.querySelector('#recalibrate-button'),
  speakerProfileState: document.querySelector('#speaker-profile-state'),
  speakerEnrollButton: document.querySelector('#speaker-enroll-button'),
  speakerDeleteButton: document.querySelector('#speaker-delete-button'),
  speakerEnrollment: document.querySelector('#speaker-enrollment'),
  enrollmentStatus: document.querySelector('#speaker-enrollment-status'),
  enrollmentMicState: document.querySelector('#enrollment-mic-state'),
  enrollmentMicButton: document.querySelector('#enrollment-mic-button'),
  enrollmentCancelButton: document.querySelector('#enrollment-cancel-button'),
  praiseCaption: document.querySelector('#praise-caption'),
  sceneCanvas: document.querySelector('#study-scene-canvas'),
  sceneStatus: document.querySelector('#study-scene-status'),
  inlineAlert: document.querySelector('#inline-alert'),
  inlineAlertTitle: document.querySelector('#inline-alert-title'),
  inlineAlertMessage: document.querySelector('#inline-alert-message'),
  inlineAlertBottom: document.querySelector('.inline-alert-bottom'),
  inlineAlertDismiss: document.querySelector('#inline-alert-dismiss'),
  inlineAlertStop: document.querySelector('#inline-alert-stop'),
};

const RULES = DisciplineSceneRules;
const POLICY = StudyPolicy;
const MEDIA_CATALOG_URL = 'rwt://renderer/media/catalog.json';
const SETTINGS_STORAGE_KEY = 'red-watch-study-settings-v1';
const MICROPHONE_POLL_MS = 100;
const CALIBRATION_SECONDS = 3;
const SPEAKER_WINDOW_SECONDS = 2.4;
const SPEAKER_OVERLAP_SECONDS = 0.6;
const SPEAKER_VERIFY_INTERVAL_MS = 1_200;
const SPEAKER_CONFIRM_HOLD_MS = 2_500;
const SPEAKER_DEADLINE_GRACE_MS = 3_000;
const ENROLLMENT_DURATION_SECONDS = 24;
const ENROLLMENT_SAMPLE_COUNT = 8;
const ENROLLMENT_WINDOW_SECONDS = 2.4;
const METER_MIN_DB = -100;
const METER_MAX_DB = 0;
const DEFAULT_NOISE_FLOOR_DB = -50;

const state = {
  active: false,
  startPending: false,
  previewPending: false,
  speakerProfileMutationPending: false,
  sessionPhase: 'idle',
  mode: 'recite',
  sessionEnded: false,
  introComplete: false,
  stopRequested: false,
  finalizingStop: false,
  sessionFailureCleanupPending: false,
  studyClock: new POLICY.EffectiveStudyClock(),
  milestoneLedger: new POLICY.MilestoneLedger('recite'),
  earnedPraiseMarks: 0,
  praisedMark: 0,
  restDeadline: 0,
  restTimer: null,
  restGeneration: 0,
  breakPromptPending: false,
  quietDetector: null,
  latestQuietResult: null,
  elapsedTimer: null,
  audioTimer: null,
  patrolTimer: null,
  nextPatrolAt: 0,
  audioStream: null,
  microphoneGeneration: 0,
  preflightTesting: false,
  preflightStarting: false,
  preflightStopping: false,
  preflightStopPromise: null,
  preflightGeneration: 0,
  preflightThresholdReached: false,
  preflightSpeakerError: '',
  audioContext: null,
  analyser: null,
  samples: null,
  frequencySamples: null,
  previousSpectrum: null,
  latestNoiseFloorDb: DEFAULT_NOISE_FLOOR_DB,
  pcmCapture: null,
  vad: null,
  calibrating: false,
  latestVadSpeech: false,
  speakerReady: false,
  speakerProfileExists: false,
  speakerProfileCreatedAt: '',
  speakerModelError: '',
  speakerChunks: [],
  speakerSampleCount: 0,
  speakerVerificationPending: false,
  speakerVerificationGeneration: 0,
  lastSpeakerVerificationAt: 0,
  lastSpeakerDecisionAt: 0,
  lastSpeakerMatched: false,
  lastSpeakerNearMatch: false,
  lastSpeakerRejected: false,
  lastSpeakerScore: 0,
  speakerMatchHistory: [],
  lastSpeechChunkAt: 0,
  ownerCandidateAt: 0,
  ownerConfirmedUntil: 0,
  speakerGraceDeadline: 0,
  enrollmentOpen: false,
  enrollmentPending: false,
  enrollmentBusy: false,
  silenceArmed: false,
  silentSince: 0,
  silencePausedAt: 0,
  pendingViolation: false,
  alertOpen: false,
  alerts: 0,
  lives: RULES.MAX_LIVES,
  settings: {
    reciteSilenceSeconds: POLICY.MODE_RULES.recite.violationSeconds.default,
    studyVoiceSeconds: POLICY.MODE_RULES.study.violationSeconds.default,
    reciteSensitivityDb: 8,
    studySensitivityDb: POLICY.QUIET_SENSITIVITY_DB.default,
  },
  mediaCatalog: [],
  scenePlayer: null,
  sceneToken: 0,
  sceneRunning: false,
  scenePhase: 'loading',
  eventBusy: false,
  eventPromise: null,
  idleEntryPrepared: null,
  presentation: null,
  windowMode: 'scene',
  trace: [],
  audioTrace: [],
  randomValues: [],
  playbackRate: 1,
};

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function modeRules() {
  return POLICY.getModeRules(state.mode);
}

function loadSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) || '{}');
    if (stored.mode === 'recite' || stored.mode === 'study') state.mode = stored.mode;
    state.settings.reciteSilenceSeconds = POLICY.normalizeViolationSeconds(
      'recite',
      stored.reciteSilenceSeconds,
    );
    state.settings.studyVoiceSeconds = POLICY.normalizeViolationSeconds(
      'study',
      stored.studyVoiceSeconds,
    );
    state.settings.reciteSensitivityDb = clamp(
      Math.round(Number(stored.reciteSensitivityDb) || 8),
      4,
      18,
    );
    state.settings.studySensitivityDb = POLICY.normalizeQuietSensitivityDb(
      stored.studySensitivityDb,
    );
  } catch {
    // Invalid local preferences fall back to the safe defaults above.
  }
}

function saveSettings() {
  localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({
    mode: state.mode,
    ...state.settings,
  }));
}

function violationLimitSeconds() {
  return state.mode === 'recite'
    ? state.settings.reciteSilenceSeconds
    : state.settings.studyVoiceSeconds;
}

function violationLimitMs() {
  return violationLimitSeconds() * 1_000;
}

function voiceThreshold() {
  return Number(UI.voiceThreshold.value);
}

function thresholdRange() {
  const minimum = Number(UI.voiceThreshold.min);
  const maximum = Number(UI.voiceThreshold.max);
  const step = Number(UI.voiceThreshold.step) || 1;
  return {
    minimum: Number.isFinite(minimum) ? minimum : 0,
    maximum: Number.isFinite(maximum) ? maximum : 100,
    step: step > 0 ? step : 1,
  };
}

function normalizeThreshold(value) {
  const { minimum, maximum, step } = thresholdRange();
  const numeric = Number(value);
  const bounded = clamp(Number.isFinite(numeric) ? numeric : minimum, minimum, maximum);
  const precision = (String(step).split('.')[1] || '').length;
  return Number((minimum + Math.round((bounded - minimum) / step) * step).toFixed(precision));
}

function thresholdMarkerPercent() {
  const noiseFloorDb = Number.isFinite(state.latestNoiseFloorDb)
    ? state.latestNoiseFloorDb
    : DEFAULT_NOISE_FLOOR_DB;
  const absoluteThresholdDb = clamp(noiseFloorDb + voiceThreshold(), METER_MIN_DB, METER_MAX_DB);
  return ((absoluteThresholdDb - METER_MIN_DB) / (METER_MAX_DB - METER_MIN_DB)) * 100;
}

function renderThresholdMarkers() {
  const { minimum, maximum } = thresholdRange();
  const value = normalizeThreshold(voiceThreshold());
  const position = thresholdMarkerPercent();
  const settingName = state.mode === 'study' ? '出声门槛' : '抗噪幅度';
  const valueText = `底噪 + ${value} dB`;
  [UI.thresholdMarker, UI.liveThresholdMarker].forEach((marker, index) => {
    marker.style.left = `${position}%`;
    marker.setAttribute('aria-valuemin', String(minimum));
    marker.setAttribute('aria-valuemax', String(maximum));
    marker.setAttribute('aria-valuenow', String(value));
    marker.setAttribute('aria-valuetext', valueText);
    marker.setAttribute('aria-label', `${index ? '粗调' : '调整'}${settingName}`);
    marker.title = `${settingName}：${valueText}；拖动或使用方向键调整`;
  });
}

function resetPreflightDetectionAfterSettingChange() {
  if (!isPreflightAudioActive()) return;
  state.preflightThresholdReached = false;
  state.latestQuietResult = null;
  document.body.dataset.voiceDetected = 'false';
  if (state.mode === 'study') {
    state.quietDetector?.reset();
  } else {
    state.silentSince = state.calibrating ? 0 : Date.now();
    state.silenceArmed = !state.calibrating;
  }
  if (state.calibrating) {
    updatePreflightUi('设置已更新，校准完成后继续测试。');
    return;
  }
  setChip(UI.voiceState, state.mode === 'study' ? '等待安静检测' : '等待本人声音');
  UI.voiceStatus.textContent = '设置已更新，请继续测试';
  updatePreflightUi('设置已更新，请继续测试。');
}

function updateThreshold({ persist = true } = {}) {
  const previousThreshold = state.mode === 'recite'
    ? state.settings.reciteSensitivityDb
    : state.settings.studySensitivityDb;
  const threshold = normalizeThreshold(voiceThreshold());
  UI.voiceThreshold.value = String(threshold);
  if (state.mode === 'recite') state.settings.reciteSensitivityDb = threshold;
  else state.settings.studySensitivityDb = POLICY.normalizeQuietSensitivityDb(threshold);
  const currentThreshold = state.mode === 'recite'
    ? state.settings.reciteSensitivityDb
    : state.settings.studySensitivityDb;
  UI.voiceThreshold.value = String(currentThreshold);
  UI.voiceThresholdValue.textContent = `底噪 + ${currentThreshold} dB`;
  state.vad?.setSensitivity(currentThreshold);
  state.quietDetector?.setSensitivityDb(currentThreshold);
  renderThresholdMarkers();
  if (currentThreshold !== previousThreshold) resetPreflightDetectionAfterSettingChange();
  if (persist) saveSettings();
}

function setThresholdFromMarker(value) {
  UI.voiceThreshold.value = String(normalizeThreshold(value));
  updateThreshold();
}

function thresholdFromClientX(meter, clientX) {
  const rect = meter.getBoundingClientRect();
  if (!(rect.width > 0)) return voiceThreshold();
  const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
  const absoluteThresholdDb = METER_MIN_DB + ratio * (METER_MAX_DB - METER_MIN_DB);
  const noiseFloorDb = Number.isFinite(state.latestNoiseFloorDb)
    ? state.latestNoiseFloorDb
    : DEFAULT_NOISE_FLOOR_DB;
  return normalizeThreshold(absoluteThresholdDb - noiseFloorDb);
}

function bindThresholdMarker(marker, meter) {
  let activePointerId = null;
  const applyPointer = (event) => {
    if (activePointerId === null || event.pointerId !== activePointerId) return;
    setThresholdFromMarker(thresholdFromClientX(meter, event.clientX));
    event.preventDefault();
  };
  const finishPointer = (event) => {
    if (activePointerId === null || event.pointerId !== activePointerId) return;
    try {
      if (marker.hasPointerCapture?.(activePointerId)) marker.releasePointerCapture(activePointerId);
    } catch {}
    activePointerId = null;
    event.preventDefault();
  };
  marker.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    activePointerId = event.pointerId;
    try {
      marker.setPointerCapture?.(activePointerId);
    } catch {}
    applyPointer(event);
  });
  window.addEventListener('pointermove', applyPointer);
  window.addEventListener('pointerup', finishPointer);
  window.addEventListener('pointercancel', finishPointer);
  marker.addEventListener('keydown', (event) => {
    const { minimum, maximum, step } = thresholdRange();
    let nextValue = voiceThreshold();
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') nextValue -= step;
    else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') nextValue += step;
    else if (event.key === 'Home') nextValue = minimum;
    else if (event.key === 'End') nextValue = maximum;
    else return;
    event.preventDefault();
    setThresholdFromMarker(nextValue);
  });
}

function setChip(element, text, kind = '') {
  element.textContent = text;
  element.className = `chip ${kind}`.trim();
  if (element === UI.voiceState) {
    UI.liveVoiceState.textContent = text;
    UI.liveVoiceState.className = `chip ${kind}`.trim();
    UI.liveVoiceDuration.textContent = text;
  }
}

function currentBreakCredits() {
  return state.milestoneLedger?.availableBreakVouchers || 0;
}

function canTakeBreak() {
  return state.active
    && state.sessionPhase === 'studying'
    && currentBreakCredits() > 0
    && !state.eventBusy
    && !state.alertOpen
    && !state.pendingViolation
    && !state.presentation;
}

function updateBreakButton() {
  const credits = currentBreakCredits();
  UI.breakButton.textContent = `休息（${credits}）`;
  UI.breakButton.disabled = !canTakeBreak();
}

function startAllowed() {
  if (
    !state.mediaCatalog.length
    || state.startPending
    || state.previewPending
    || state.speakerProfileMutationPending
    || state.enrollmentPending
    || state.active
    || state.sceneRunning
    || state.presentation
    || state.enrollmentOpen
  ) return false;
  return state.mode === 'study' || state.speakerReady;
}

function preflightCanStart() {
  if (
    (state.sessionPhase !== 'idle' && state.sessionPhase !== 'ended')
    || state.active
    || state.startPending
    || state.previewPending
    || state.speakerProfileMutationPending
    || state.sceneRunning
    || state.eventBusy
    || state.presentation
    || state.enrollmentOpen
    || state.enrollmentPending
    || state.enrollmentBusy
    || state.preflightStarting
    || state.preflightStopping
  ) return false;
  return state.mode === 'study'
    || (state.speakerReady && state.speakerProfileExists && !state.speakerModelError);
}

function isPreflightAudioActive() {
  return state.preflightTesting
    && state.sessionPhase === 'idle'
    && !state.active
    && !state.enrollmentOpen
    && !state.enrollmentPending
    && !state.eventBusy
    && !state.presentation;
}

function isReciteDetectionActive() {
  if (state.mode !== 'recite' || !state.speakerProfileExists) return false;
  return isPreflightAudioActive() || (
    state.active
    && state.sessionPhase === 'studying'
    && state.introComplete
    && !state.calibrating
    && !state.alertOpen
    && !state.silencePausedAt
  );
}

function updatePreflightUi(status) {
  if (!UI.preflightTestButton || !UI.preflightTestStatus) return;
  if (typeof status === 'string') UI.preflightTestStatus.textContent = status;
  if (state.preflightTesting) {
    UI.preflightTestButton.disabled = false;
    UI.preflightTestButton.textContent = '停止测试';
    return;
  }
  if (state.preflightStarting || state.preflightStopping) {
    UI.preflightTestButton.disabled = true;
    UI.preflightTestButton.textContent = state.preflightStarting ? '正在启动…' : '正在停止…';
    return;
  }
  UI.preflightTestButton.textContent = '测试当前设置';
  UI.preflightTestButton.disabled = !preflightCanStart();
  if (state.mode === 'recite' && state.speakerReady && !state.speakerProfileExists) {
    UI.preflightTestStatus.textContent = '请先录入本人声音，再测试背书检测。';
  } else if (state.mode === 'recite' && !state.speakerReady) {
    UI.preflightTestStatus.textContent = state.speakerModelError || '正在准备声纹模型…';
  }
}

function updateModeUi() {
  const studyingQuietly = state.mode === 'study';
  document.body.dataset.studyMode = state.mode;
  UI.reciteModeButton.classList.toggle('active', !studyingQuietly);
  UI.studyModeButton.classList.toggle('active', studyingQuietly);
  UI.reciteModeButton.setAttribute('aria-pressed', String(!studyingQuietly));
  UI.studyModeButton.setAttribute('aria-pressed', String(studyingQuietly));
  const idleOperationBusy = state.startPending
    || state.previewPending
    || state.speakerProfileMutationPending
    || state.enrollmentPending;
  const modeSwitchDisabled = idleOperationBusy
    || state.active
    || state.sceneRunning
    || state.presentation
    || state.enrollmentOpen;
  UI.reciteModeButton.disabled = modeSwitchDisabled;
  UI.studyModeButton.disabled = modeSwitchDisabled;
  UI.modeTitle.textContent = studyingQuietly ? '· 自习模式' : '· 背书模式';
  UI.sessionLabel.textContent = studyingQuietly ? '本次自习' : '本次背书';
  UI.stopButton.textContent = studyingQuietly ? '结束本次自习' : '结束本次背书';
  UI.voicePanelTitle.textContent = studyingQuietly ? '安静自习检测' : '本人声纹巡查';
  UI.liveVoiceTitle.textContent = studyingQuietly ? '安静检测' : '本人出声检测';
  UI.voiceThresholdLabel.textContent = studyingQuietly ? '出声门槛' : '抗噪幅度';
  UI.silenceLimit.value = String(state.settings.reciteSilenceSeconds);
  UI.silenceLimitValue.textContent = `${state.settings.reciteSilenceSeconds} 秒`;
  UI.studyVoiceLimit.value = String(state.settings.studyVoiceSeconds);
  UI.studyVoiceLimitValue.textContent = `${state.settings.studyVoiceSeconds} 秒`;
  UI.voiceThreshold.min = studyingQuietly ? '6' : '4';
  UI.voiceThreshold.max = studyingQuietly ? '16' : '18';
  UI.voiceThreshold.value = String(
    studyingQuietly ? state.settings.studySensitivityDb : state.settings.reciteSensitivityDb,
  );
  document.querySelectorAll('.study-only').forEach((element) => { element.hidden = !studyingQuietly; });
  document.querySelectorAll('.recite-only').forEach((element) => { element.hidden = studyingQuietly; });
  updateThreshold({ persist: false });
  if (!state.active) {
    UI.startButton.disabled = !startAllowed();
    if (state.startPending) UI.startButton.textContent = '正在启动麦克风…';
    else if (state.previewPending || state.presentation) UI.startButton.textContent = '动画预览中';
    else if (state.speakerProfileMutationPending) UI.startButton.textContent = '正在更新声纹…';
    else if (state.enrollmentPending || state.enrollmentOpen) UI.startButton.textContent = '正在录入声纹';
    else if (startAllowed()) UI.startButton.textContent = state.sessionEnded ? '重新开始学习' : '开始学习';
    else UI.startButton.textContent = state.mode === 'recite' && !state.speakerReady
      ? '声纹模型不可用'
      : '正在准备场景…';
  }
  UI.previewClipButton.disabled = !state.mediaCatalog.length
    || idleOperationBusy
    || state.active
    || state.sceneRunning
    || Boolean(state.presentation)
    || state.enrollmentOpen;
  updateBreakButton();
  updatePreflightUi();
}

function setMode(mode) {
  if (
    state.startPending
    || state.previewPending
    || state.speakerProfileMutationPending
    || state.enrollmentPending
    || state.active
    || state.sceneRunning
    || state.presentation
    || state.enrollmentOpen
  ) return;
  if (mode !== 'recite' && mode !== 'study') return;
  if (state.preflightTesting || state.preflightStarting || state.preflightStopping) {
    stopPreflightTest({ status: '模式已切换，可按新设置重新测试。' }).catch(handleAuxiliaryUiError);
  }
  state.mode = mode;
  state.milestoneLedger = new POLICY.MilestoneLedger(mode);
  saveSettings();
  updateModeUi();
  if (mode === 'recite' && state.speakerReady && !state.speakerProfileExists) {
    setChip(UI.voiceState, '需要录入本人声纹');
    UI.voiceStatus.textContent = '开始学习前先录入本人声音';
  } else if (!state.active) {
    setChip(UI.voiceState, mode === 'study' ? '等待安静自习' : '未开启');
    UI.voiceStatus.textContent = '未在检测声音';
  }
  updatePreflightUi(
    mode === 'recite' && state.speakerReady && !state.speakerProfileExists
      ? '请先录入本人声音，再测试背书检测。'
      : '可在开始学习前测试当前检测设置。',
  );
}

function updateSpeakerProfileUi() {
  if (state.speakerModelError) {
    setChip(UI.speakerProfileState, '声纹模型不可用', 'alert');
    UI.speakerEnrollButton.disabled = true;
    UI.speakerDeleteButton.hidden = true;
    return;
  }
  if (!state.speakerReady) {
    setChip(UI.speakerProfileState, '正在加载声纹模型…');
    UI.speakerEnrollButton.disabled = true;
    UI.speakerDeleteButton.hidden = true;
    return;
  }
  if (state.speakerProfileExists) {
    setChip(UI.speakerProfileState, '已录入本人声纹', 'good');
    UI.speakerEnrollButton.textContent = '重新录入';
    UI.speakerDeleteButton.hidden = false;
  } else {
    setChip(UI.speakerProfileState, '尚未录入本人声纹');
    UI.speakerEnrollButton.textContent = '录入本人声音';
    UI.speakerDeleteButton.hidden = true;
  }
  const speakerActionDisabled = state.active
    || state.startPending
    || state.previewPending
    || state.speakerProfileMutationPending
    || state.sceneRunning
    || Boolean(state.presentation)
    || state.enrollmentPending
    || state.enrollmentBusy;
  UI.speakerEnrollButton.disabled = speakerActionDisabled;
  UI.speakerDeleteButton.disabled = speakerActionDisabled;
  updatePreflightUi();
}

async function refreshSpeakerState() {
  try {
    const profile = await window.desktopAPI.getSpeakerState();
    state.speakerReady = Boolean(profile?.ready);
    state.speakerProfileExists = Boolean(profile?.profileExists);
    state.speakerProfileCreatedAt = profile?.createdAt || '';
    state.speakerModelError = state.speakerReady ? '' : (profile?.error || '声纹服务启动失败');
    if (state.speakerReady && profile?.error && !state.speakerProfileExists) {
      UI.voiceStatus.textContent = profile.error;
    }
  } catch (error) {
    state.speakerReady = false;
    state.speakerProfileExists = false;
    state.speakerModelError = error.message || '声纹服务启动失败';
  }
  updateSpeakerProfileUi();
  updatePreflightUi(
    state.mode === 'recite' && state.speakerReady && !state.speakerProfileExists
      ? '请先录入本人声音，再测试背书检测。'
      : '可在开始学习前测试当前检测设置。',
  );
  return state.speakerReady && state.speakerProfileExists;
}

function setEnrollmentBusy(busy) {
  state.enrollmentBusy = busy;
  UI.enrollmentMicButton.disabled = busy;
  UI.enrollmentCancelButton.disabled = busy;
  updateSpeakerProfileUi();
}

async function openSpeakerEnrollment() {
  if (
    state.active
    || state.startPending
    || state.previewPending
    || state.speakerProfileMutationPending
    || state.sceneRunning
    || state.presentation
    || state.enrollmentOpen
    || state.enrollmentPending
  ) return false;
  state.enrollmentPending = true;
  updateModeUi();
  updateSpeakerProfileUi();
  try {
    await stopPreflightTest({ status: '声纹录入期间暂停测试。' });
    if (
      state.active
      || state.startPending
      || state.previewPending
      || state.speakerProfileMutationPending
      || state.sceneRunning
      || state.presentation
      || state.enrollmentOpen
    ) return false;
    if (!state.speakerReady) {
      await refreshSpeakerState();
      if (!state.speakerReady) {
        UI.voiceStatus.textContent = state.speakerModelError || '声纹模型不可用';
        return false;
      }
    }
    await window.desktopAPI.beginSpeakerEnrollment();
    state.enrollmentOpen = true;
    state.enrollmentBusy = false;
    UI.enrollmentMicState.textContent = '麦克风：准备就绪';
    UI.enrollmentStatus.textContent = `请用平时背书的麦克风连续朗读 ${ENROLLMENT_DURATION_SECONDS} 秒。`;
    UI.enrollmentMicButton.textContent = `开始 ${ENROLLMENT_DURATION_SECONDS} 秒录入`;
    UI.speakerEnrollment.hidden = false;
    document.body.classList.remove('controls-open');
    document.body.classList.add('enrollment-mode');
    return true;
  } finally {
    state.enrollmentPending = false;
    updateModeUi();
    updateSpeakerProfileUi();
  }
}

async function closeSpeakerEnrollment({ cancel = false } = {}) {
  if (!state.enrollmentOpen) return;
  if (cancel) await window.desktopAPI.cancelSpeakerEnrollment().catch(() => {});
  state.enrollmentOpen = false;
  state.enrollmentBusy = false;
  UI.speakerEnrollment.hidden = true;
  document.body.classList.remove('enrollment-mode');
  updateSpeakerProfileUi();
  updateModeUi();
}

async function captureEnrollmentMicrophone(durationSeconds) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    video: false,
  });
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  let context;
  try {
    context = new AudioContextClass({
      sampleRate: SpeakerAudio.TARGET_SAMPLE_RATE,
      latencyHint: 'interactive',
    });
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop());
    throw error;
  }
  const captureSampleRate = context.sampleRate;
  const chunks = [];
  let totalLength = 0;
  let capture = null;
  let progressTimer = null;
  const startedAt = Date.now();
  try {
    await context.resume();
    const source = context.createMediaStreamSource(stream);
    capture = new SpeakerAudio.ContinuousPcmCapture(context, source, (chunk) => {
      chunks.push(chunk);
      totalLength += chunk.length;
    });
    await capture.start();
    progressTimer = window.setInterval(() => {
      const remaining = Math.max(0, Math.ceil(durationSeconds - ((Date.now() - startedAt) / 1000)));
      UI.enrollmentMicState.textContent = `麦克风：请连续朗读 ${remaining} 秒`;
    }, 200);
    await new Promise((resolve) => window.setTimeout(resolve, durationSeconds * 1000));
  } finally {
    window.clearInterval(progressTimer);
    capture?.stop();
    stream.getTracks().forEach((track) => track.stop());
    await context.close().catch(() => {});
  }
  const merged = SpeakerAudio.concatChunks(chunks, totalLength);
  return captureSampleRate === SpeakerAudio.TARGET_SAMPLE_RATE
    ? merged
    : SpeakerAudio.resampleLinear(merged, captureSampleRate, SpeakerAudio.TARGET_SAMPLE_RATE);
}

async function runEnrollmentMicrophone() {
  if (!state.enrollmentOpen || state.enrollmentBusy) return;
  setEnrollmentBusy(true);
  UI.enrollmentStatus.textContent = '请保持平时背书的音量，连续朗读任意内容。';
  try {
    const samples = await captureEnrollmentMicrophone(ENROLLMENT_DURATION_SECONDS);
    const dynamics = SpeakerAudio.analyzeDynamics(samples, SpeakerAudio.TARGET_SAMPLE_RATE);
    if (dynamics.standardDeviationDb < 2 || dynamics.spreadDb < 6) {
      throw new Error('没有检测到足够清晰的连续朗读，请重新录入。');
    }
    const windows = SpeakerAudio.selectVoiceWindows(samples, SpeakerAudio.TARGET_SAMPLE_RATE, {
      count: ENROLLMENT_SAMPLE_COUNT,
      durationSeconds: ENROLLMENT_WINDOW_SECONDS,
      minimumDurationSeconds: ENROLLMENT_DURATION_SECONDS - 2,
    });
    for (let index = 0; index < windows.length; index += 1) {
      UI.enrollmentMicState.textContent = `麦克风：正在提取 ${index + 1}/${windows.length}`;
      await window.desktopAPI.addSpeakerEnrollmentSample({
        source: 'mic',
        samples: windows[index],
        sampleRate: SpeakerAudio.TARGET_SAMPLE_RATE,
      });
    }
    const profile = await window.desktopAPI.finishSpeakerEnrollment();
    state.speakerProfileExists = Boolean(profile?.profileExists);
    state.speakerProfileCreatedAt = profile?.createdAt || '';
    UI.enrollmentMicState.textContent = '麦克风：录入完成';
    UI.enrollmentStatus.textContent = '本人声纹已保存。';
    await new Promise((resolve) => window.setTimeout(resolve, 500));
    await closeSpeakerEnrollment();
    await refreshSpeakerState();
  } catch (error) {
    await window.desktopAPI.cancelSpeakerEnrollment().catch(() => {});
    await window.desktopAPI.beginSpeakerEnrollment().catch(() => {});
    UI.enrollmentMicState.textContent = '麦克风：录入失败';
    UI.enrollmentStatus.textContent = error.message;
    UI.enrollmentMicButton.textContent = `重新录入 ${ENROLLMENT_DURATION_SECONDS} 秒`;
  } finally {
    setEnrollmentBusy(false);
  }
}

async function deleteSpeakerProfile() {
  if (
    state.active
    || state.startPending
    || state.previewPending
    || state.speakerProfileMutationPending
    || state.sceneRunning
    || state.presentation
    || state.enrollmentOpen
    || state.enrollmentPending
    || state.enrollmentBusy
    || !state.speakerProfileExists
  ) return;
  if (!window.confirm('删除保存在本机的本人声纹？')) return;
  state.speakerProfileMutationPending = true;
  updateModeUi();
  updateSpeakerProfileUi();
  try {
    await stopPreflightTest({ status: '本人声纹已删除，请重新录入后再测试。' });
    if (state.active || state.startPending || state.previewPending || state.presentation || state.enrollmentOpen) return;
    await window.desktopAPI.deleteSpeakerProfile();
    await refreshSpeakerState();
    UI.voiceStatus.textContent = '本人声纹已删除';
  } finally {
    state.speakerProfileMutationPending = false;
    updateModeUi();
    updateSpeakerProfileUi();
  }
}

function formatTime(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
  const seconds = Math.floor(totalSeconds % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function addLog(message) {
  UI.eventLog.querySelector('.empty-log')?.remove();
  const item = document.createElement('li');
  const time = document.createElement('time');
  time.dateTime = new Date().toISOString();
  time.textContent = new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(new Date());
  const content = document.createElement('span');
  content.textContent = message;
  item.append(time, content);
  UI.eventLog.prepend(item);
}

function random() {
  if (state.randomValues.length) {
    const value = Number(state.randomValues.shift());
    if (Number.isFinite(value)) return Math.max(0, Math.min(0.999999999, value));
  }
  return Math.random();
}

function setSceneLabel(phase, clipId) {
  state.scenePhase = phase;
  document.body.dataset.scenePhase = phase;
  document.body.dataset.sceneClip = clipId;
}

async function prepareClip(clipId, audio = true) {
  return state.scenePlayer.prepare(clipId, { audio });
}

async function playPreparedToEnd(prepared, options = {}) {
  return new Promise((resolve, reject) => {
    setSceneLabel(options.phase || 'watch', prepared.clipId);
    state.scenePlayer.playPrepared(prepared, {
      audio: options.audio !== false,
      audioLoop: false,
      loop: false,
      playbackRate: state.playbackRate,
      onAudioStatus: (status) => {
        document.body.dataset.audioStatus = status;
        if (status === 'ready') {
          document.body.dataset.audioClipId = prepared.clipId;
          state.audioTrace.push({ clipId: prepared.clipId, audioClipId: prepared.clipId });
        } else {
          delete document.body.dataset.audioClipId;
        }
      },
      onEnded: resolve,
    }).catch(reject);
  });
}

function planUsesSourceAudio(plan) {
  return plan.kind === 'intro'
    || plan.kind === 'clockoff'
    || plan.kind === 'violation'
    || plan.kind === 'milestonePraise'
    || plan.milestonePraise === true
    || plan.hourlySalute === true;
}

function formatStudyDuration(totalMinutes) {
  const minutes = Math.max(1, Math.floor(Number(totalMinutes) || 1));
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (!hours) return `${minutes} 分钟`;
  if (!remainder) return `${hours} 小时`;
  return `${hours} 小时 ${remainder} 分钟`;
}

function praiseCaption(mark) {
  const milestone = Math.max(1, Math.floor(Number(mark) || 1));
  const totalMinutes = milestone * modeRules().praiseEveryMinutes;
  const activity = state.mode === 'study' ? '自习' : '背书';
  return `已${activity}满 ${formatStudyDuration(totalMinutes)}`;
}

function showPraiseCaption(mark) {
  UI.praiseCaption.textContent = praiseCaption(mark);
  UI.praiseCaption.hidden = false;
  document.body.classList.add('praise-mode');
  document.body.dataset.praiseVisible = 'true';
}

function hidePraiseCaption() {
  UI.praiseCaption.hidden = true;
  UI.praiseCaption.textContent = '';
  document.body.classList.remove('praise-mode');
  document.body.dataset.praiseVisible = 'false';
}

function phasesForPlan(plan) {
  if (plan.kind === 'intro') return ['entry', 'intro', 'exit'];
  if (plan.kind === 'clockoff') return ['entry', 'salute', 'exit'];
  if (plan.kind === 'independent') return ['independent'];
  return plan.fatal ? ['entry', plan.kind === 'violation' ? 'warning' : 'watch']
    : ['entry', plan.kind === 'violation' ? 'warning' : 'watch', 'exit'];
}

async function playPlan(plan, token) {
  const phases = phasesForPlan(plan);
  const audioEnabled = planUsesSourceAudio(plan);
  const preparedClips = await Promise.all(plan.clips.map((clipId) => prepareClip(clipId, audioEnabled)));
  for (let index = 0; index < preparedClips.length; index += 1) {
    if (token !== state.sceneToken) return false;
    const prepared = preparedClips[index];
    const praiseClip = Boolean(
      (plan.milestonePraise || plan.hourlySalute)
      && prepared.clipId === RULES.CLIPS.R_SALUTE,
    );
    state.trace.push({
      at: Date.now(),
      clipId: prepared.clipId,
      phase: phases[index],
      kind: plan.kind,
      fatal: Boolean(plan.fatal),
      strike: plan.strike || 0,
    });
    if (praiseClip) showPraiseCaption(plan.praiseMark ?? plan.salutedHourMark);
    let detail;
    try {
      detail = await playPreparedToEnd(prepared, { phase: phases[index], audio: audioEnabled });
    } finally {
      if (praiseClip) hidePraiseCaption();
    }
    if (detail?.interrupted || token !== state.sceneToken) return false;
  }
  return true;
}

async function showIdleScene() {
  state.idleEntryPrepared ||= await prepareClip(RULES.CLIPS.E1, false);
  await state.scenePlayer.showFrame(state.idleEntryPrepared, 0);
  setSceneLabel('waiting', RULES.CLIPS.E1);
  UI.sceneStatus.hidden = true;
}

function showOverlay({ title, message = '', controls = false, preview = false }) {
  document.body.classList.remove('controls-open');
  UI.controlsButton.textContent = '展开检测面板';
  document.body.classList.add('alert-mode');
  UI.inlineAlert.hidden = false;
  UI.inlineAlertTitle.textContent = title;
  UI.inlineAlertMessage.textContent = message;
  UI.inlineAlertMessage.hidden = !message;
  UI.inlineAlertBottom.hidden = !controls;
  UI.inlineAlertDismiss.hidden = !controls;
  UI.inlineAlertStop.hidden = !controls || preview;
  UI.inlineAlertDismiss.textContent = preview ? '结束预览' : '继续学习';
  UI.inlineAlertDismiss.disabled = false;
}

function hideOverlay() {
  document.body.classList.remove('alert-mode');
  UI.inlineAlert.hidden = true;
  UI.inlineAlertMessage.hidden = false;
  UI.inlineAlertBottom.hidden = false;
  UI.inlineAlertDismiss.hidden = false;
  UI.inlineAlertStop.hidden = false;
  document.body.dataset.audioStatus = 'muted';
}

function clearPatrolTimer() {
  if (state.patrolTimer) window.clearTimeout(state.patrolTimer);
  state.patrolTimer = null;
  state.nextPatrolAt = 0;
}

function effectiveElapsedMs() {
  return state.studyClock?.elapsedMs() || 0;
}

async function showEarnedBreakPrompt() {
  if (!state.breakPromptPending || !canTakeBreak()) return;
  await window.desktop.showBreakPrompt({
    kind: 'earned',
    credits: currentBreakCredits(),
    remainingSeconds: 0,
  });
}

function settleStudyMilestones() {
  if (!state.active || !state.milestoneLedger) return [];
  const events = state.milestoneLedger.settle(effectiveElapsedMs());
  let earnedBreak = false;
  events.forEach((event) => {
    if (event.type === 'break-voucher-earned') {
      earnedBreak = true;
      state.breakPromptPending = true;
      addLog(`获得 1 次两分钟休息，现有 ${currentBreakCredits()} 次。`);
    } else if (event.type === 'praise-earned') {
      state.earnedPraiseMarks = Math.max(state.earnedPraiseMarks, event.milestoneIndex);
    }
  });
  updateBreakButton();
  if (earnedBreak) showEarnedBreakPrompt().catch(handleAuxiliaryUiError);
  return events;
}

function completedPraiseMarksForPlan() {
  return state.earnedPraiseMarks > state.praisedMark
    ? state.praisedMark + 1
    : state.praisedMark;
}

function scheduleNextPatrol(delayMs = RULES.nextPatrolDelay(random)) {
  clearPatrolTimer();
  if (
    !state.active
    || state.sessionPhase !== 'studying'
    || !state.introComplete
    || state.stopRequested
    || state.pendingViolation
  ) return;
  const delay = Math.max(0, Number(delayMs) || 0);
  state.nextPatrolAt = Date.now() + delay;
  state.patrolTimer = window.setTimeout(() => {
    state.patrolTimer = null;
    state.nextPatrolAt = 0;
    if (!state.active || state.sessionPhase !== 'studying' || state.stopRequested || state.pendingViolation) return;
    if (state.windowMode === 'hidden') {
      scheduleNextPatrol();
      return;
    }
    if (state.eventBusy) return;
    runScheduledEvent().catch(handleSessionFlowError);
  }, delay);
}

function armSilenceClock() {
  if (
    !state.active
    || state.sessionPhase !== 'studying'
    || !state.introComplete
    || state.calibrating
    || state.alertOpen
  ) return;
  state.silenceArmed = true;
  state.silentSince = state.mode === 'recite' ? Date.now() : 0;
  state.silencePausedAt = 0;
  state.quietDetector?.reset();
}

function pauseSilenceClock() {
  if (!state.silenceArmed || state.silencePausedAt) return;
  state.silencePausedAt = Date.now();
}

function resumeSilenceClock() {
  if (!state.silencePausedAt) return;
  if (state.silentSince) state.silentSince += Math.max(0, Date.now() - state.silencePausedAt);
  state.silencePausedAt = 0;
  state.quietDetector?.reset();
}

function enterStudyingPhase() {
  if (!state.active || !state.introComplete || state.calibrating) return;
  if (state.sessionPhase !== 'starting' && state.sessionPhase !== 'resuming') return;
  state.sessionPhase = 'studying';
  state.studyClock.resume();
  UI.sessionState.textContent = state.mode === 'study' ? '安静自习中' : '背书中';
  UI.sessionState.className = 'state active';
  armSilenceClock();
  scheduleNextPatrol();
  updateBreakButton();
  showEarnedBreakPrompt().catch(handleAuxiliaryUiError);
}

async function runIntro() {
  const token = state.sceneToken;
  state.eventBusy = true;
  UI.sessionState.textContent = '开始学习';
  try {
    await playPlan(RULES.introPlan(), token);
  } finally {
    if (token !== state.sceneToken) return;
    state.eventBusy = false;
    state.introComplete = true;
  }

  if (state.stopRequested) {
    await finalizeManualStop();
    return;
  }
  if (!state.active) return;
  UI.sessionState.textContent = '校准声音中';
  beginNoiseCalibration();
}

async function runResumeIntro() {
  const generation = state.restGeneration;
  const token = state.sceneToken;
  state.eventBusy = true;
  state.introComplete = false;
  UI.sessionState.textContent = '开始学习';
  try {
    await playPlan(RULES.introPlan(), token);
  } finally {
    if (token === state.sceneToken) {
      state.eventBusy = false;
      if (generation === state.restGeneration) state.introComplete = true;
    }
  }
  if (token !== state.sceneToken) return;
  if (state.stopRequested) {
    await finalizeManualStop();
    return;
  }
  if (!state.active || generation !== state.restGeneration) return;
  try {
    const opened = await openMicrophone();
    if (!opened) return;
    if (!state.active || generation !== state.restGeneration) return;
    UI.sessionState.textContent = '校准声音中';
    beginNoiseCalibration();
  } catch (error) {
    UI.voiceStatus.textContent = `休息后无法恢复麦克风：${error.message}`;
    addLog(`麦克风恢复失败：${error.message}`);
    await stopSession(false, true);
  }
}

async function runScheduledEvent(planOverride = null) {
  if (
    !state.active
    || state.sessionPhase !== 'studying'
    || state.stopRequested
    || state.pendingViolation
    || state.eventBusy
  ) return false;
  clearPatrolTimer();
  const planOptions = {
    random,
    completedPraiseMarks: completedPraiseMarksForPlan(),
    praisedMark: state.praisedMark,
  };
  const hasPendingPraise = state.earnedPraiseMarks > state.praisedMark;
  const plan = planOverride || (hasPendingPraise
    ? RULES.normalPatrolPlan(planOptions)
    : RULES.scheduledPlan(planOptions));
  const praiseMark = plan.praiseMark ?? plan.salutedHourMark;
  const pausesStudyClock = planUsesSourceAudio(plan);
  const token = state.sceneToken;
  state.eventBusy = true;
  updateBreakButton();
  pauseSilenceClock();
  if (pausesStudyClock) state.studyClock.pause();
  state.eventPromise = playPlan(plan, token);
  let playbackCompleted = false;
  try {
    playbackCompleted = await state.eventPromise;
  } finally {
    if (token === state.sceneToken) state.eventBusy = false;
    state.eventPromise = null;
    if (token === state.sceneToken) resumeSilenceClock();
    if (pausesStudyClock && state.active && state.sessionPhase === 'studying') {
      state.studyClock.resume();
    }
    updateBreakButton();
    showEarnedBreakPrompt().catch(handleAuxiliaryUiError);
  }

  if (token !== state.sceneToken) return false;
  if (playbackCompleted && (plan.milestonePraise || plan.hourlySalute)) {
    state.praisedMark = praiseMark;
    addLog(`${praiseCaption(state.praisedMark)}。`);
  }
  if (state.stopRequested) {
    await finalizeManualStop();
  } else if (state.pendingViolation) {
    await runPendingViolation();
  } else if (state.active && state.sessionPhase === 'studying') {
    scheduleNextPatrol();
  }
  return Boolean(playbackCompleted);
}

async function openMicrophone() {
  if (state.audioStream && state.audioContext && state.analyser) return true;
  const generation = state.microphoneGeneration;
  let audioStream = null;
  let audioContext = null;
  let pcmCapture = null;
  try {
    audioStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });
    if (audioStream.getVideoTracks().length !== 0) {
      throw new Error('检测到非预期的视频轨道，已拒绝启动。');
    }
    const audioTracks = audioStream.getAudioTracks();
    if (!audioTracks.length) throw new Error('麦克风没有可用的实时音频轨道。');
    audioTracks.forEach((track) => {
      track.addEventListener('ended', () => {
        if (generation !== state.microphoneGeneration) return;
        if ((state.preflightTesting || state.preflightStarting) && !state.preflightStopping) {
          stopPreflightTest({ status: '麦克风已断开，测试已停止。' }).catch(handleAuxiliaryUiError);
        } else if ((state.active || state.startPending) && !state.stopRequested && state.sessionPhase !== 'stopping') {
          const error = new Error('麦克风已断开。');
          handleSessionFlowError(error, { voiceMessage: '麦克风已断开，学习已安全停止。' });
        }
      }, { once: true });
    });
    if (generation !== state.microphoneGeneration) {
      audioStream.getTracks().forEach((track) => track.stop());
      return false;
    }

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    audioContext = new AudioContextClass({
      sampleRate: SpeakerAudio.TARGET_SAMPLE_RATE,
      latencyHint: 'interactive',
    });
    await audioContext.resume();
    const source = audioContext.createMediaStreamSource(audioStream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.15;
    source.connect(analyser);

    if (state.mode === 'recite') {
      pcmCapture = new SpeakerAudio.ContinuousPcmCapture(
        audioContext,
        source,
        onRuntimePcmChunk,
      );
      await pcmCapture.start();
    }
    if (generation !== state.microphoneGeneration) {
      pcmCapture?.stop();
      audioStream.getTracks().forEach((track) => track.stop());
      await audioContext.close().catch(() => {});
      return false;
    }
    if (audioTracks.some((track) => track.readyState !== 'live')) {
      throw new Error('麦克风没有可用的实时音频轨道。');
    }

    state.audioContext = audioContext;
    state.analyser = analyser;
    state.samples = new Float32Array(analyser.fftSize);
    state.frequencySamples = new Float32Array(analyser.frequencyBinCount);
    state.previousSpectrum = null;
    state.audioStream = audioStream;
    state.pcmCapture = pcmCapture;
    window.clearInterval(state.audioTimer);
    state.audioTimer = window.setInterval(pollMicrophone, MICROPHONE_POLL_MS);
    return true;
  } catch (error) {
    pcmCapture?.stop();
    audioStream?.getTracks().forEach((track) => track.stop());
    if (audioContext && audioContext.state !== 'closed') await audioContext.close().catch(() => {});
    throw error;
  }
}

async function releaseMicrophone() {
  state.microphoneGeneration += 1;
  window.clearInterval(state.audioTimer);
  state.audioTimer = null;
  try {
    state.pcmCapture?.stop();
  } catch (error) {
    console.error('停止麦克风采集失败：', error);
  }
  state.pcmCapture = null;
  state.audioStream?.getTracks().forEach((track) => {
    try {
      track.stop();
    } catch (error) {
      console.error('停止麦克风轨道失败：', error);
    }
  });
  state.audioStream = null;
  if (state.audioContext && state.audioContext.state !== 'closed') {
    await state.audioContext.close().catch(() => {});
  }
  state.audioContext = null;
  state.analyser = null;
  state.samples = null;
  state.frequencySamples = null;
  state.previousSpectrum = null;
  state.vad = null;
  state.quietDetector = null;
  state.latestQuietResult = null;
  state.calibrating = false;
  state.silenceArmed = false;
  state.silentSince = 0;
  state.silencePausedAt = 0;
  resetSpeakerRuntime();
}

function resetIdleDetectionUi() {
  if (!state.active && !state.startPending && !state.enrollmentOpen && !state.enrollmentPending) {
    setChip(UI.voiceState, state.mode === 'study' ? '等待安静自习' : '未开启');
    UI.voiceStatus.textContent = '未在检测声音';
  }
  UI.volumeBar.style.width = '0%';
  UI.liveVolumeBar.style.width = '0%';
  UI.meter.setAttribute('aria-valuenow', '0');
  UI.liveMeter.setAttribute('aria-valuenow', '0');
  renderThresholdMarkers();
  document.body.dataset.voiceDetected = 'false';
  document.body.dataset.vadState = 'stopped';
}

async function stopPreflightTest({ status = '测试已停止。' } = {}) {
  if (state.preflightStopping) return state.preflightStopPromise;
  const wasRunning = state.preflightTesting || state.preflightStarting;
  if (!wasRunning) {
    updatePreflightUi();
    return false;
  }

  state.preflightGeneration += 1;
  state.preflightTesting = false;
  state.preflightStarting = false;
  state.preflightStopping = true;
  state.preflightThresholdReached = false;
  state.preflightSpeakerError = '';
  updatePreflightUi();
  const stopPromise = (async () => {
    try {
      await releaseMicrophone();
      resetIdleDetectionUi();
      updatePreflightUi(status);
      return true;
    } finally {
      state.preflightStopping = false;
      state.preflightStopPromise = null;
      updatePreflightUi();
    }
  })();
  state.preflightStopPromise = stopPromise;
  return stopPromise;
}

async function startPreflightTest() {
  if (state.preflightTesting) return stopPreflightTest();
  if (state.preflightStarting || state.preflightStopping) return false;
  if (state.mode === 'recite' && (!state.speakerReady || !state.speakerProfileExists)) {
    updatePreflightUi('请先录入本人声音，再测试背书检测。');
    return false;
  }
  if (!preflightCanStart()) {
    updatePreflightUi('当前状态不能测试，请先结束正在进行的操作。');
    return false;
  }

  if (state.sessionPhase === 'ended') {
    state.sessionEnded = false;
    state.sessionPhase = 'idle';
    UI.sessionState.textContent = '待命';
    UI.sessionState.className = 'state';
  }

  const generation = ++state.preflightGeneration;
  state.preflightStarting = true;
  state.preflightThresholdReached = false;
  state.preflightSpeakerError = '';
  updatePreflightUi('启动麦克风后将先校准 3 秒环境底噪。');
  try {
    const opened = await openMicrophone();
    if (!opened || generation !== state.preflightGeneration || !state.preflightStarting) return false;
    state.preflightStarting = false;
    state.preflightTesting = true;
    beginNoiseCalibration();
    updatePreflightUi('正在校准环境底噪，请保持平时的学习环境。');
    return true;
  } catch (error) {
    if (generation !== state.preflightGeneration) return false;
    state.preflightStarting = false;
    state.preflightTesting = false;
    state.preflightThresholdReached = false;
    await releaseMicrophone();
    resetIdleDetectionUi();
    updatePreflightUi(`测试无法启动：${error.message}`);
    return false;
  } finally {
    updatePreflightUi();
  }
}

function clearRestTimer() {
  window.clearInterval(state.restTimer);
  state.restTimer = null;
}

function remainingRestSeconds() {
  if (!state.restDeadline) return 0;
  return Math.max(0, Math.ceil((state.restDeadline - Date.now()) / 1_000));
}

async function updateRestPrompt() {
  if (state.sessionPhase !== 'resting') return;
  await window.desktop.updateBreakPrompt({
    kind: 'resting',
    credits: currentBreakCredits(),
    remainingSeconds: remainingRestSeconds(),
  });
}

async function cancelRestState({ hidePrompt = true } = {}) {
  state.restGeneration += 1;
  clearRestTimer();
  state.restDeadline = 0;
  state.breakPromptPending = false;
  if (hidePrompt) await window.desktop.hideBreakPrompt().catch(() => {});
}

async function finishBreak(generation) {
  if (
    generation !== state.restGeneration
    || !state.active
    || state.sessionPhase !== 'resting'
  ) return;
  clearRestTimer();
  state.restDeadline = 0;
  state.sessionPhase = 'resuming';
  UI.sessionState.textContent = '休息结束';
  await window.desktop.hideBreakPrompt().catch(() => {});
  if (!state.active || generation !== state.restGeneration) return;
  await window.desktopAPI.restoreSceneMode();
  if (!state.active || state.stopRequested || generation !== state.restGeneration) return;
  addLog('休息结束，继续学习。');
  await runResumeIntro();
}

function tickBreak(generation) {
  if (generation !== state.restGeneration || state.sessionPhase !== 'resting') return;
  const remaining = remainingRestSeconds();
  UI.sessionState.textContent = `休息中 ${formatTime(remaining)}`;
  updateRestPrompt().catch(handleAuxiliaryUiError);
  if (remaining <= 0) finishBreak(generation).catch(handleSessionFlowError);
}

async function startBreak(durationOverrideMs = null) {
  settleStudyMilestones();
  if (!canTakeBreak()) return false;
  const voucher = state.milestoneLedger.consumeBreakVoucher();
  if (!voucher.consumed) return false;

  const hasDurationOverride = durationOverrideMs !== null
    && durationOverrideMs !== undefined
    && Number.isFinite(Number(durationOverrideMs));
  const durationMs = hasDurationOverride
    ? Math.max(250, Number(durationOverrideMs))
    : voucher.durationMs;
  const generation = ++state.restGeneration;
  state.breakPromptPending = false;
  state.sessionPhase = 'resting';
  state.studyClock.pause();
  state.silenceArmed = false;
  state.silentSince = 0;
  state.silencePausedAt = 0;
  state.quietDetector?.reset();
  clearPatrolTimer();
  state.restDeadline = Date.now() + durationMs;
  updateBreakButton();
  addLog('开始两分钟休息。');

  await releaseMicrophone();
  if (!state.active || generation !== state.restGeneration) return false;
  try {
    await window.desktop.showBreakPrompt({
      kind: 'resting',
      credits: currentBreakCredits(),
      remainingSeconds: remainingRestSeconds(),
    });
    await window.desktopAPI.hideToBackground();
  } catch (error) {
    addLog(`休息提示显示失败：${error.message}`);
  }
  if (!state.active || generation !== state.restGeneration || state.sessionPhase !== 'resting') return false;
  clearRestTimer();
  state.restTimer = window.setInterval(() => tickBreak(generation), 250);
  tickBreak(generation);
  return true;
}

async function bankBreakPrompt() {
  if (state.sessionPhase === 'resting') return;
  state.breakPromptPending = false;
  await window.desktop.hideBreakPrompt();
  updateBreakButton();
  addLog('休息已攒下，可随时使用。');
}

function stopElapsedTimer() {
  window.clearInterval(state.elapsedTimer);
  state.elapsedTimer = null;
}

function setStoppedControls(label = '待命') {
  state.sessionPhase = state.sessionEnded ? 'ended' : 'idle';
  UI.stopButton.disabled = true;
  UI.backgroundButton.disabled = true;
  UI.recalibrateButton.disabled = true;
  UI.previewClipButton.disabled = !state.mediaCatalog.length;
  UI.startButton.disabled = !startAllowed();
  UI.startButton.textContent = startAllowed()
    ? (state.sessionEnded ? '重新开始学习' : '开始学习')
    : (state.mode === 'recite' ? '声纹模型不可用' : '正在准备场景…');
  UI.sessionState.textContent = label;
  UI.sessionState.className = 'state';
  setChip(UI.voiceState, '已停止');
  UI.voiceStatus.textContent = '未在检测声音';
  UI.volumeBar.style.width = '0%';
  UI.liveVolumeBar.style.width = '0%';
  UI.meter.setAttribute('aria-valuenow', '0');
  UI.liveMeter.setAttribute('aria-valuenow', '0');
  document.body.dataset.voiceDetected = 'false';
  document.body.dataset.vadState = 'stopped';
  updateSpeakerProfileUi();
  updateModeUi();
  updateBreakButton();
}

function violationDescription() {
  return state.mode === 'study'
    ? `持续出声超过 ${violationLimitSeconds()} 秒`
    : `本人连续 ${violationLimitSeconds()} 秒未出声`;
}

async function finishFatalViolation(plan) {
  state.active = false;
  state.sessionPhase = 'ended';
  state.sessionEnded = true;
  state.sceneRunning = false;
  state.stopRequested = false;
  state.pendingViolation = false;
  state.alertOpen = false;
  clearPatrolTimer();
  stopElapsedTimer();
  state.studyClock.pause();
  await cancelRestState();
  await releaseMicrophone();
  hideOverlay();
  await window.desktopAPI.finishInlineAlert({ returnToHidden: false });
  setStoppedControls('本次学习结束');
  addLog(`${violationDescription()}（第 ${plan.strike} 次），本次学习结束。`);
}

async function runPendingViolation() {
  if (!state.pendingViolation || !state.active || state.eventBusy) return false;
  state.pendingViolation = false;
  state.sessionPhase = 'violation';
  state.studyClock.pause();
  const plan = RULES.violationPlan({ livesRemaining: state.lives, random });
  state.alerts += 1;
  UI.alertCount.textContent = `${state.alerts} 次提醒`;
  addLog(`${violationDescription()}（第 ${plan.strike} 次）。`);
  clearPatrolTimer();

  const token = state.sceneToken;
  state.eventBusy = true;
  updateBreakButton();
  let returnToHidden = false;
  let revealed = false;
  let playbackCompleted = false;
  let aborted = false;
  try {
    const revealResult = await window.desktopAPI.revealForInlineAlert();
    revealed = true;
    returnToHidden = Boolean(revealResult?.returnToHidden);
    if (token !== state.sceneToken || !state.active || state.stopRequested) {
      aborted = true;
    } else {
      showOverlay({
        title: violationDescription(),
        message: `第 ${plan.strike} 次提醒`,
        controls: false,
      });
      state.eventPromise = playPlan(plan, token);
      playbackCompleted = await state.eventPromise;
    }
  } finally {
    if (token === state.sceneToken) state.eventBusy = false;
    state.eventPromise = null;
    updateBreakButton();
  }
  if (token !== state.sceneToken) return false;
  if (aborted || !state.active || state.stopRequested) {
    state.alertOpen = false;
    hideOverlay();
    if (revealed) await window.desktopAPI.finishInlineAlert({ returnToHidden: false });
    if (state.stopRequested) await finalizeManualStop();
    return false;
  }
  if (!playbackCompleted) return false;

  state.lives = Math.max(0, state.lives - 1);
  if (plan.fatal) {
    await finishFatalViolation(plan);
    return true;
  }

  state.alertOpen = false;
  hideOverlay();
  if (state.stopRequested) {
    await window.desktopAPI.finishInlineAlert({ returnToHidden: false });
    await finalizeManualStop();
    return true;
  }

  state.sessionPhase = 'studying';
  if (state.active) state.studyClock.resume();
  armSilenceClock();
  await window.desktopAPI.finishInlineAlert({
    returnToHidden: returnToHidden && state.active,
  });
  scheduleNextPatrol();
  showEarnedBreakPrompt().catch(handleAuxiliaryUiError);
  return true;
}

function raiseSilenceAlert() {
  if (
    !state.active
    || state.sessionPhase !== 'studying'
    || !state.introComplete
    || state.alertOpen
    || state.pendingViolation
  ) return;
  state.pendingViolation = true;
  state.alertOpen = true;
  state.silenceArmed = false;
  state.silentSince = 0;
  state.silencePausedAt = 0;
  clearPatrolTimer();
  window.desktop.hideBreakPrompt().catch(() => {});
  updateBreakButton();
  if (!state.eventBusy) runPendingViolation().catch(handleSessionFlowError);
}

async function finalizeManualStop() {
  if (state.finalizingStop || state.eventBusy) return;
  state.finalizingStop = true;
  const token = state.sceneToken;
  state.eventBusy = true;
  try {
    await playPlan(RULES.clockoffPlan(), token);
    if (token === state.sceneToken) await showIdleScene();
  } catch (error) {
    handleSceneError(error);
  } finally {
    if (token === state.sceneToken) state.eventBusy = false;
    state.finalizingStop = false;
  }
  if (token !== state.sceneToken) return;
  state.sceneRunning = false;
  state.stopRequested = false;
  state.sessionEnded = false;
  state.sessionPhase = 'idle';
  setStoppedControls('待命');
  addLog('结束学习。');
}

async function stopSession(addEvent = true, immediateSceneReset = false) {
  const wasRunning = state.active || state.sceneRunning;
  state.startPending = false;
  state.stopRequested = true;
  state.active = false;
  state.sessionPhase = 'stopping';
  state.silenceArmed = false;
  state.pendingViolation = false;
  clearPatrolTimer();
  stopElapsedTimer();
  state.studyClock.pause();
  await cancelRestState();
  await releaseMicrophone();

  if (state.presentation) await finishPreview();

  if (immediateSceneReset) {
    state.sceneToken += 1;
    await state.scenePlayer.stop();
    state.eventBusy = false;
    state.eventPromise = null;
    state.sceneRunning = false;
    state.stopRequested = false;
    state.finalizingStop = false;
    state.alertOpen = false;
    hideOverlay();
    await showIdleScene().catch(() => {});
    setStoppedControls('待命');
    return;
  }

  UI.stopButton.disabled = true;
  UI.backgroundButton.disabled = true;
  UI.startButton.disabled = true;
  UI.startButton.textContent = '正在结束…';
  UI.sessionState.textContent = '正在结束';
  if (!state.eventBusy) await finalizeManualStop();
  if (addEvent && wasRunning && state.eventBusy) addLog('正在结束学习。');
}

async function loadMediaCatalog() {
  try {
    const response = await fetch(MEDIA_CATALOG_URL);
    if (!response.ok) throw new Error(`资源清单读取失败：${response.status}`);
    const catalog = await response.json();
    if (!Array.isArray(catalog) || catalog.length !== 22) throw new Error(`资源数量异常：${catalog.length}`);
    state.mediaCatalog = catalog;
    UI.clipSelect.replaceChildren(...catalog.map((clip) => {
      const option = document.createElement('option');
      option.value = clip.id;
      option.textContent = `${clip.code}｜${clip.name}`;
      return option;
    }));
    UI.clipSelect.disabled = false;
    UI.mediaCount.textContent = `${catalog.length} / 22 段完整`;
    UI.mediaCount.className = 'chip good';
  } catch (error) {
    UI.mediaCount.textContent = '资源异常';
    UI.mediaCount.className = 'chip alert';
    UI.mediaCount.title = error.message;
    throw error;
  }
}

async function previewSelectedClip() {
  try {
    if (
      state.active
      || state.startPending
      || state.previewPending
      || state.speakerProfileMutationPending
      || state.sceneRunning
      || state.presentation
      || state.enrollmentOpen
      || state.enrollmentPending
      || !state.mediaCatalog.length
    ) return;
    state.previewPending = true;
    updateModeUi();
    updateSpeakerProfileUi();
    if (state.preflightTesting || state.preflightStarting || state.preflightStopping) {
      await stopPreflightTest({ status: '动画预览期间暂停测试。' });
    }
    if (
      state.active
      || state.startPending
      || state.speakerProfileMutationPending
      || state.sceneRunning
      || state.presentation
      || state.enrollmentOpen
      || state.enrollmentPending
      || !state.mediaCatalog.length
    ) return;
    const clip = state.mediaCatalog.find((item) => item.id === UI.clipSelect.value);
    if (!clip) return;
    UI.previewClipButton.disabled = true;
    UI.startButton.disabled = true;
    const token = ++state.sceneToken;
    const presentation = { kind: 'preview', token, clip };
    state.presentation = presentation;
    state.previewPending = false;
    updateModeUi();
    updateSpeakerProfileUi();
    updatePreflightUi();
    showOverlay({ title: '动画预览', message: `${clip.code}｜${clip.name}`, controls: true, preview: true });
    await window.desktopAPI.revealForInlineAlert();
    const prepared = await prepareClip(clip.id, true);
    if (state.presentation !== presentation || token !== state.sceneToken) return;
    state.trace.push({ at: Date.now(), clipId: clip.id, phase: 'preview', kind: 'preview', fatal: false, strike: 0 });
    await playPreparedToEnd(prepared, { phase: 'preview' });
  } catch (error) {
    if (state.presentation) handleSceneError(error);
  } finally {
    if (state.previewPending) {
      state.previewPending = false;
      updateModeUi();
      updateSpeakerProfileUi();
    }
  }
}

async function finishPreview() {
  const presentation = state.presentation;
  if (!presentation) return;
  state.presentation = null;
  state.sceneToken += 1;
  await state.scenePlayer.stop();
  hideOverlay();
  await showIdleScene().catch(() => {});
  await window.desktopAPI.finishInlineAlert({ returnToHidden: false });
  updateModeUi();
  updateSpeakerProfileUi();
  updatePreflightUi('可继续测试当前检测设置。');
}

function startElapsedTimer() {
  UI.timer.textContent = '00:00';
  stopElapsedTimer();
  state.elapsedTimer = window.setInterval(() => {
    UI.timer.textContent = formatTime(Math.floor(effectiveElapsedMs() / 1_000));
    settleStudyMilestones();
  }, 1000);
}

function calculateAudioFeatures() {
  state.analyser.getFloatTimeDomainData(state.samples);
  const sum = state.samples.reduce((total, sample) => total + sample * sample, 0);
  const rms = Math.sqrt(sum / state.samples.length);
  const db = Math.max(-100, 20 * Math.log10(rms || 0.00001));

  state.analyser.getFloatFrequencyData(state.frequencySamples);
  const binHz = state.audioContext.sampleRate / state.analyser.fftSize;
  const minimumBin = Math.max(1, Math.floor(80 / binHz));
  const maximumBin = Math.min(state.frequencySamples.length - 1, Math.ceil(8000 / binHz));
  const voiceMinimumBin = Math.max(minimumBin, Math.floor(120 / binHz));
  const voiceMaximumBin = Math.min(maximumBin, Math.ceil(4000 / binHz));
  let totalEnergy = 0;
  let voiceEnergy = 0;
  let amplitudeSum = 0;
  let logAmplitudeSum = 0;
  let voiceBins = 0;
  const spectrum = new Float32Array(state.frequencySamples.length);

  for (let index = minimumBin; index <= maximumBin; index += 1) {
    const frequencyDb = Number.isFinite(state.frequencySamples[index]) ? state.frequencySamples[index] : -120;
    const power = 10 ** (frequencyDb / 10);
    totalEnergy += power;
    if (index >= voiceMinimumBin && index <= voiceMaximumBin) {
      const amplitude = Math.sqrt(power);
      voiceEnergy += power;
      amplitudeSum += amplitude;
      logAmplitudeSum += Math.log(Math.max(amplitude, 1e-12));
      voiceBins += 1;
    }
  }

  const normalizer = Math.max(voiceEnergy, 1e-20);
  let flux = 0;
  for (let index = voiceMinimumBin; index <= voiceMaximumBin; index += 1) {
    const frequencyDb = Number.isFinite(state.frequencySamples[index]) ? state.frequencySamples[index] : -120;
    spectrum[index] = (10 ** (frequencyDb / 10)) / normalizer;
    if (state.previousSpectrum) flux += Math.abs(spectrum[index] - state.previousSpectrum[index]);
  }
  state.previousSpectrum = spectrum;

  const arithmeticMean = amplitudeSum / Math.max(1, voiceBins);
  const geometricMean = Math.exp(logAmplitudeSum / Math.max(1, voiceBins));
  return {
    db,
    voiceRatio: voiceEnergy / Math.max(totalEnergy, 1e-20),
    flatness: arithmeticMean > 0 ? geometricMean / arithmeticMean : 0,
    flux: Math.min(1, flux / 2),
  };
}

function resetSpeakerRuntime() {
  state.speakerVerificationGeneration += 1;
  state.latestVadSpeech = false;
  state.speakerChunks = [];
  state.speakerSampleCount = 0;
  state.speakerVerificationPending = false;
  state.lastSpeakerVerificationAt = 0;
  state.lastSpeakerDecisionAt = 0;
  state.lastSpeakerMatched = false;
  state.lastSpeakerNearMatch = false;
  state.lastSpeakerRejected = false;
  state.lastSpeakerScore = 0;
  state.speakerMatchHistory = [];
  state.lastSpeechChunkAt = 0;
  state.ownerCandidateAt = 0;
  state.ownerConfirmedUntil = 0;
  state.speakerGraceDeadline = 0;
  state.preflightSpeakerError = '';
}

async function verifyOwnerVoice(samples, sourceSampleRate) {
  if (
    state.speakerVerificationPending
    || !isReciteDetectionActive()
  ) return;
  const generation = state.speakerVerificationGeneration;
  state.speakerVerificationPending = true;
  state.lastSpeakerVerificationAt = Date.now();
  try {
    const normalized = sourceSampleRate === SpeakerAudio.TARGET_SAMPLE_RATE
      ? samples
      : SpeakerAudio.resampleLinear(samples, sourceSampleRate, SpeakerAudio.TARGET_SAMPLE_RATE);
    const result = await window.desktopAPI.verifySpeaker({
      samples: normalized,
      sampleRate: SpeakerAudio.TARGET_SAMPLE_RATE,
    });
    if (
      generation !== state.speakerVerificationGeneration
      || !isReciteDetectionActive()
    ) return;
    state.preflightSpeakerError = '';
    const now = Date.now();
    const matched = Boolean(result?.matched);
    const strongMatch = Boolean(result?.strongMatch);
    const score = Number(result?.score) || 0;
    const threshold = Number(result?.threshold) || 0.55;
    state.speakerMatchHistory.push({ at: now, matched });
    state.speakerMatchHistory = state.speakerMatchHistory
      .filter((item) => now - item.at <= 6_000)
      .slice(-3);
    const recentMatches = state.speakerMatchHistory.filter((item) => item.matched).length;
    const repeatedMatch = matched && recentMatches >= 2;
    const confirmed = matched && (strongMatch || repeatedMatch);
    state.lastSpeakerDecisionAt = now;
    state.lastSpeakerMatched = confirmed;
    state.lastSpeakerNearMatch = !matched && score >= Math.max(0, threshold - 0.08);
    state.lastSpeakerRejected = !matched
      && !state.lastSpeakerNearMatch
      && state.speakerMatchHistory.length >= 3
      && recentMatches === 0;
    state.lastSpeakerScore = score;

    if (confirmed) {
      state.ownerCandidateAt = 0;
      state.speakerMatchHistory = [];
      state.lastSpeakerRejected = false;
      state.ownerConfirmedUntil = now + SPEAKER_CONFIRM_HOLD_MS;
      state.silentSince = 0;
      document.body.dataset.voiceDetected = 'true';
      setChip(UI.voiceState, '本人正在背书', 'good');
      UI.voiceStatus.textContent = '本人正在背书';
    } else if (matched) {
      state.ownerCandidateAt = now;
      document.body.dataset.voiceDetected = 'false';
      setChip(UI.voiceState, '正在复核本人声音');
      UI.voiceStatus.textContent = '正在复核本人声音';
    } else {
      if (state.ownerCandidateAt && now - state.ownerCandidateAt > 6_000) state.ownerCandidateAt = 0;
      document.body.dataset.voiceDetected = 'false';
      const message = state.lastSpeakerRejected ? '暂未确认本人声音' : '正在复核本人声音';
      setChip(UI.voiceState, message, state.lastSpeakerRejected ? 'alert' : '');
      UI.voiceStatus.textContent = message;
    }
  } catch (error) {
    if (generation !== state.speakerVerificationGeneration) return;
    state.ownerCandidateAt = 0;
    state.speakerMatchHistory = [];
    state.lastSpeakerDecisionAt = Date.now();
    state.lastSpeakerMatched = false;
    state.lastSpeakerNearMatch = false;
    state.lastSpeakerRejected = false;
    document.body.dataset.voiceDetected = 'false';
    setChip(UI.voiceState, '声纹验证失败', 'alert');
    UI.voiceStatus.textContent = `声纹验证失败：${error.message}`;
    if (isPreflightAudioActive()) {
      state.preflightSpeakerError = error.message;
      updatePreflightUi(`声纹验证失败：${error.message}`);
    }
  } finally {
    if (generation === state.speakerVerificationGeneration) {
      state.speakerVerificationPending = false;
    }
  }
}

function onRuntimePcmChunk(chunk) {
  if (
    !isReciteDetectionActive()
    || !state.latestVadSpeech
  ) return;

  const now = Date.now();
  if (state.lastSpeechChunkAt && now - state.lastSpeechChunkAt > 650) {
    state.speakerChunks = [];
    state.speakerSampleCount = 0;
  }
  state.lastSpeechChunkAt = now;
  state.speakerChunks.push(chunk);
  state.speakerSampleCount += chunk.length;

  const sampleRate = state.audioContext?.sampleRate || SpeakerAudio.TARGET_SAMPLE_RATE;
  const targetLength = Math.round(sampleRate * SPEAKER_WINDOW_SECONDS);
  if (
    state.speakerSampleCount < targetLength
    || state.speakerVerificationPending
    || now - state.lastSpeakerVerificationAt < SPEAKER_VERIFY_INTERVAL_MS
  ) return;

  const allSamples = SpeakerAudio.concatChunks(state.speakerChunks, state.speakerSampleCount);
  const windowSamples = allSamples.slice(Math.max(0, allSamples.length - targetLength));
  const overlapLength = Math.round(sampleRate * SPEAKER_OVERLAP_SECONDS);
  const overlap = allSamples.slice(Math.max(0, allSamples.length - overlapLength));
  state.speakerChunks = overlap.length ? [overlap] : [];
  state.speakerSampleCount = overlap.length;
  verifyOwnerVoice(windowSamples, sampleRate);
}

function beginNoiseCalibration() {
  state.vad = new AdaptiveVad.AdaptiveVoiceDetector({
    calibrationFrames: Math.round((CALIBRATION_SECONDS * 1000) / MICROPHONE_POLL_MS),
    sensitivityDb: voiceThreshold(),
  });
  state.calibrating = true;
  state.quietDetector = state.mode === 'study'
    ? new POLICY.QuietModeDetector({
      violationSeconds: state.settings.studyVoiceSeconds,
      sensitivityDb: state.settings.studySensitivityDb,
      frameMs: MICROPHONE_POLL_MS,
    })
    : null;
  state.latestQuietResult = null;
  state.silenceArmed = false;
  state.silentSince = 0;
  state.previousSpectrum = null;
  resetSpeakerRuntime();
  document.body.dataset.vadState = 'calibrating';
  setChip(UI.voiceState, `校准声音 ${CALIBRATION_SECONDS} 秒`);
  UI.voiceStatus.textContent = '正在校准环境声音';
  UI.recalibrateButton.disabled = true;
}

function pollMicrophone() {
  const preflight = isPreflightAudioActive();
  if ((!state.active && !preflight) || !state.analyser || !state.vad || state.alertOpen || state.silencePausedAt) return;
  let result;
  try {
    result = state.vad.process(calculateAudioFeatures());
  } catch (error) {
    if (preflight) {
      stopPreflightTest({ status: `测试已停止：${error.message}` }).catch(handleAuxiliaryUiError);
      return;
    }
    throw error;
  }
  UI.volumeBar.style.width = `${result.levelPercent}%`;
  UI.liveVolumeBar.style.width = `${result.levelPercent}%`;
  UI.meter.setAttribute('aria-valuenow', String(result.levelPercent));
  UI.liveMeter.setAttribute('aria-valuenow', String(result.levelPercent));
  if (Number.isFinite(result.noiseFloorDb)) {
    state.latestNoiseFloorDb = clamp(result.noiseFloorDb, METER_MIN_DB, METER_MAX_DB);
  }
  renderThresholdMarkers();

  if (state.calibrating) {
    const remaining = Math.max(0, CALIBRATION_SECONDS * (1 - result.calibrationProgress));
    setChip(UI.voiceState, result.calibrated ? '校准完成' : `校准声音 ${remaining.toFixed(1)} 秒`);
    UI.voiceStatus.textContent = result.calibrated
      ? (state.mode === 'study' ? '当前安静' : '尚未检测到本人声音')
      : '正在校准环境声音';
    if (!result.calibrated) return;
    state.calibrating = false;
    UI.recalibrateButton.disabled = preflight;
    document.body.dataset.vadState = 'ready';
    if (preflight) {
      state.silenceArmed = true;
      state.silentSince = state.mode === 'recite' ? Date.now() : 0;
      state.quietDetector?.reset();
      updatePreflightUi(state.mode === 'study'
        ? '校准完成，请按平时的方式安静学习。'
        : '校准完成，请按平时的方式背书。');
      return;
    }
    enterStudyingPhase();
    return;
  }

  if (!preflight && state.sessionPhase !== 'studying') return;

  if (state.mode === 'study') {
    if (!state.silenceArmed || !state.quietDetector) return;
    const quietResult = state.quietDetector.process(result, MICROPHONE_POLL_MS);
    state.latestQuietResult = quietResult;
    document.body.dataset.voiceDetected = String(quietResult.evidence);
    if (preflight && quietResult.violated) state.preflightThresholdReached = true;
    else if (preflight && quietResult.rearmed) state.preflightThresholdReached = false;
    if (preflight && state.preflightThresholdReached) {
      setChip(UI.voiceState, '已达到提醒条件', 'alert');
      UI.voiceStatus.textContent = '已达到提醒条件';
    } else if (quietResult.evidence) {
      const seconds = (quietResult.suspectedSpeechMs / 1_000).toFixed(1);
      setChip(UI.voiceState, `疑似持续说话 ${seconds} 秒`, 'alert');
      UI.voiceStatus.textContent = `疑似持续说话 ${seconds} 秒`;
    } else if (!quietResult.armed) {
      setChip(UI.voiceState, '等待恢复安静');
      UI.voiceStatus.textContent = '保持安静后继续检测';
    } else {
      setChip(UI.voiceState, '安静', 'good');
      UI.voiceStatus.textContent = '当前安静';
    }
    if (preflight) {
      if (state.preflightThresholdReached) {
        updatePreflightUi('按当前设置将触发提醒。');
      } else if (quietResult.evidence) {
        updatePreflightUi(`已连续检测到人声 ${(quietResult.suspectedSpeechMs / 1_000).toFixed(1)} 秒。`);
      } else {
        updatePreflightUi('当前没有达到提醒条件。');
      }
    } else if (quietResult.violated) {
      raiseSilenceAlert();
    }
    return;
  }

  state.latestVadSpeech = result.isSpeech;
  if (preflight && state.preflightSpeakerError) {
    setChip(UI.voiceState, '声纹验证失败', 'alert');
    UI.voiceStatus.textContent = `声纹验证失败：${state.preflightSpeakerError}`;
    updatePreflightUi(`声纹验证失败：${state.preflightSpeakerError}`);
    return;
  }
  const now = Date.now();
  const ownerConfirmed = result.isSpeech && now < state.ownerConfirmedUntil;
  if (ownerConfirmed) {
    document.body.dataset.voiceDetected = 'true';
    setChip(UI.voiceState, '本人正在背书', 'good');
    UI.voiceStatus.textContent = '本人正在背书';
    if (preflight) {
      state.preflightThresholdReached = false;
      updatePreflightUi('已确认是本人声音，未达到提醒条件。');
    }
    return;
  }

  document.body.dataset.voiceDetected = 'false';
  if (result.isSpeech) {
    if (state.speakerVerificationPending) {
      setChip(UI.voiceState, '正在确认本人声音');
      UI.voiceStatus.textContent = '正在确认本人声音';
    } else if (state.ownerCandidateAt && now - state.ownerCandidateAt <= 6_000) {
      setChip(UI.voiceState, '正在复核本人声音');
      UI.voiceStatus.textContent = '正在复核本人声音';
    } else if (state.lastSpeakerDecisionAt && now - state.lastSpeakerDecisionAt < 1_800 && !state.lastSpeakerMatched) {
      const message = state.lastSpeakerRejected ? '暂未确认本人声音' : '正在复核本人声音';
      setChip(UI.voiceState, message, state.lastSpeakerRejected ? 'alert' : '');
      UI.voiceStatus.textContent = message;
    } else {
      setChip(UI.voiceState, '检测到声音');
      UI.voiceStatus.textContent = '正在等待本人声纹';
    }
  }

  if (!state.silenceArmed) return;
  if (!state.silentSince) state.silentSince = Date.now();
  const silentForMs = Date.now() - state.silentSince;
  const silentFor = Math.floor(silentForMs / 1000);
  if (!result.isSpeech) {
    setChip(UI.voiceState, `本人未出声 ${silentFor} 秒`, silentForMs >= violationLimitMs() ? 'alert' : '');
    UI.voiceStatus.textContent = `本人未出声 ${silentFor} 秒`;
  }
  if (silentForMs >= violationLimitMs()) {
    const graceDeadline = state.silentSince + violationLimitMs() + SPEAKER_DEADLINE_GRACE_MS;
    const verificationInFlight = result.isSpeech
      || state.speakerVerificationPending
      || state.speakerSampleCount > 0;
    if (verificationInFlight && Date.now() < graceDeadline) {
      if (preflight) {
        state.preflightThresholdReached = false;
        updatePreflightUi('达到设定时间，正在等待本次声纹确认。');
      }
      return;
    }
    if (preflight) {
      state.preflightThresholdReached = true;
      updatePreflightUi('按当前设置将触发提醒。');
      return;
    }
    raiseSilenceAlert();
  } else if (preflight) {
    state.preflightThresholdReached = false;
    updatePreflightUi(result.isSpeech
      ? '检测到声音，正在确认是否为本人。'
      : `本人未出声 ${silentFor} 秒，当前阈值 ${violationLimitSeconds()} 秒。`);
  }
}

async function startSession() {
  if (
    state.startPending
    || state.previewPending
    || state.speakerProfileMutationPending
    || state.enrollmentPending
    || state.enrollmentOpen
    || state.enrollmentBusy
    || state.active
    || state.sceneRunning
    || state.presentation
  ) return;
  state.startPending = true;
  updateModeUi();
  updateSpeakerProfileUi();
  if (state.preflightTesting || state.preflightStarting || state.preflightStopping) {
    await stopPreflightTest({ status: '测试已结束，正在开始学习。' });
  }
  if (
    state.active
    || state.previewPending
    || state.speakerProfileMutationPending
    || state.enrollmentPending
    || state.enrollmentOpen
    || state.sceneRunning
    || state.presentation
  ) {
    state.startPending = false;
    updateModeUi();
    updateSpeakerProfileUi();
    return;
  }
  updateModeUi();
  if (state.mode === 'recite' && (!state.speakerReady || !state.speakerProfileExists)) {
    await refreshSpeakerState();
    if (!state.speakerReady) {
      state.startPending = false;
      updateModeUi();
      updateSpeakerProfileUi();
      UI.voiceStatus.textContent = state.speakerModelError || '声纹模型不可用';
      return;
    }
    if (!state.speakerProfileExists) {
      state.startPending = false;
      updateModeUi();
      updateSpeakerProfileUi();
      try {
        await openSpeakerEnrollment();
      } catch (error) {
        UI.voiceStatus.textContent = `无法打开声纹录入：${error.message}`;
      } finally {
        updateModeUi();
        updateSpeakerProfileUi();
      }
      return;
    }
  }
  UI.startButton.disabled = true;
  UI.startButton.textContent = '正在启动麦克风…';
  try {
    await cancelRestState();
    const opened = await openMicrophone();
    if (!opened) throw new Error('麦克风启动已取消。');
    state.active = true;
    state.startPending = false;
    state.sessionPhase = 'starting';
    state.sessionEnded = false;
    state.introComplete = false;
    state.stopRequested = false;
    state.finalizingStop = false;
    state.pendingViolation = false;
    state.alertOpen = false;
    state.alerts = 0;
    state.lives = RULES.MAX_LIVES;
    state.studyClock = new POLICY.EffectiveStudyClock();
    state.milestoneLedger = new POLICY.MilestoneLedger(state.mode);
    state.earnedPraiseMarks = 0;
    state.praisedMark = 0;
    state.quietDetector = null;
    state.latestQuietResult = null;
    state.trace = [];
    state.audioTrace = [];
    state.sceneToken += 1;
    state.sceneRunning = true;
    UI.alertCount.textContent = '0 次提醒';
    UI.startButton.textContent = '学习进行中';
    UI.stopButton.disabled = false;
    UI.backgroundButton.disabled = false;
    UI.recalibrateButton.disabled = true;
    UI.previewClipButton.disabled = true;
    updateSpeakerProfileUi();
    updateModeUi();
    updateBreakButton();
    UI.sessionState.textContent = '开始学习';
    UI.sessionState.className = 'state active';
    addLog(state.mode === 'study' ? '开始自习。' : '开始背书。');
    startElapsedTimer();
    runIntro().catch(handleSessionFlowError);
  } catch (error) {
    const voiceMessage = `无法启动：${error.message}`;
    UI.voiceStatus.textContent = voiceMessage;
    addLog(`启动失败：${error.message}`);
    handleSessionFlowError(error, { voiceMessage });
  }
}

function applyWindowMode(mode) {
  state.windowMode = mode;
  document.body.dataset.windowMode = mode;
  if (mode === 'hidden' && (state.preflightTesting || state.preflightStarting)) {
    stopPreflightTest({ status: '窗口已隐藏，测试已停止。' }).catch(handleAuxiliaryUiError);
  }
}

function setWindowMaximizedControl(maximized) {
  const isMaximized = Boolean(maximized);
  UI.windowMaximizeButton.dataset.maximized = String(isMaximized);
  UI.windowMaximizeButton.setAttribute('aria-label', isMaximized ? '还原窗口' : '最大化窗口');
  UI.windowMaximizeButton.title = isMaximized ? '还原' : '最大化';
}

async function toggleWindowMaximize() {
  const runtime = await window.desktopAPI.toggleMaximizeWindow();
  setWindowMaximizedControl(runtime?.maximized);
}

async function hideWindowFromChrome() {
  await stopPreflightTest({ status: '窗口已隐藏，测试已停止。' });
  addLog('隐藏到后台。');
  await window.desktopAPI.hideToBackground();
}

function handleSceneError(error) {
  UI.sceneStatus.hidden = false;
  UI.sceneStatus.textContent = `场景播放失败：${error.message}`;
  console.error(error);
}

function handleAuxiliaryUiError(error) {
  console.error('辅助窗口操作失败：', error);
}

async function resetSessionAfterFlowFailure(flowError) {
  if (state.sessionFailureCleanupPending) return;
  state.sessionFailureCleanupPending = true;
  state.startPending = false;
  state.stopRequested = true;
  state.active = false;
  state.sessionPhase = 'stopping';
  state.silenceArmed = false;
  state.pendingViolation = false;
  clearPatrolTimer();
  stopElapsedTimer();
  state.studyClock.pause();

  try {
    await cancelRestState();
    await releaseMicrophone();

    state.presentation = null;
    state.sceneToken += 1;
    await state.scenePlayer?.stop().catch((error) => {
      console.error('异常流程中停止场景失败：', error);
    });

    state.eventBusy = false;
    state.eventPromise = null;
    state.sceneRunning = false;
    state.finalizingStop = false;
    state.alertOpen = false;
    state.sessionEnded = false;
    hideOverlay();
    await window.desktop.hideBreakPrompt().catch(handleAuxiliaryUiError);

    let mainWindowRestored = false;
    await window.desktopAPI.finishInlineAlert({ returnToHidden: false }).then(() => {
      mainWindowRestored = true;
    }).catch((error) => {
      console.error('异常流程中结束提醒窗口模式失败：', error);
    });
    if (!mainWindowRestored) {
      await window.desktopAPI.restoreSceneMode().catch((error) => {
        console.error('异常流程中恢复主窗口失败：', error);
      });
    }
    await showIdleScene().catch((error) => {
      console.error('异常流程中恢复待命画面失败：', error);
    });
  } finally {
    state.stopRequested = false;
    state.sessionPhase = 'idle';
    state.sessionFailureCleanupPending = false;
    setStoppedControls('待命');
    UI.sceneStatus.hidden = false;
    UI.sceneStatus.textContent = `学习已安全停止：${flowError.message}`;
  }
}

function handleSessionFlowError(error, { voiceMessage = '' } = {}) {
  handleSceneError(error);
  if (state.sessionPhase === 'idle' && !state.active && !state.sceneRunning && !state.startPending) return;
  resetSessionAfterFlowFailure(error).then(() => {
    if (voiceMessage) UI.voiceStatus.textContent = voiceMessage;
  }).catch((cleanupError) => {
    console.error('学习流程异常后的清理失败：', cleanupError);
    state.active = false;
    state.sceneRunning = false;
    state.eventBusy = false;
    state.eventPromise = null;
    state.presentation = null;
    state.alertOpen = false;
    state.pendingViolation = false;
    state.sessionEnded = false;
    state.stopRequested = false;
    state.sessionPhase = 'idle';
    state.sessionFailureCleanupPending = false;
    hideOverlay();
    window.desktop.hideBreakPrompt().catch(handleAuxiliaryUiError);
    window.desktopAPI.finishInlineAlert({ returnToHidden: false }).catch(() => (
      window.desktopAPI.restoreSceneMode().catch(() => {})
    ));
    setStoppedControls('待命');
    UI.sceneStatus.hidden = false;
    UI.sceneStatus.textContent = `学习已安全停止：${error.message}`;
    if (voiceMessage) UI.voiceStatus.textContent = voiceMessage;
  });
}

UI.startButton.addEventListener('click', startSession);
UI.stopButton.addEventListener('click', () => stopSession());
UI.breakButton.addEventListener('click', () => startBreak().catch(handleSessionFlowError));
UI.reciteModeButton.addEventListener('click', () => setMode('recite'));
UI.studyModeButton.addEventListener('click', () => setMode('study'));
UI.backgroundButton.addEventListener('click', async () => {
  await hideWindowFromChrome();
});
UI.windowMinimizeButton.addEventListener('click', () => {
  window.desktopAPI.minimizeWindow().catch(handleAuxiliaryUiError);
});
UI.windowMaximizeButton.addEventListener('click', () => {
  toggleWindowMaximize().catch(handleAuxiliaryUiError);
});
UI.windowCloseButton.addEventListener('click', () => {
  hideWindowFromChrome().catch(handleAuxiliaryUiError);
});
UI.windowTitlebar.addEventListener('dblclick', (event) => {
  if (event.target.closest('.window-controls')) return;
  toggleWindowMaximize().catch(handleAuxiliaryUiError);
});
UI.controlsButton.addEventListener('click', () => {
  const isOpen = document.body.classList.toggle('controls-open');
  UI.controlsButton.textContent = isOpen ? '收起检测面板' : '展开检测面板';
});
UI.exitButton.addEventListener('click', async () => {
  try {
    await stopPreflightTest({ status: '正在退出，测试已停止。' });
  } finally {
    window.desktopAPI.quitApp();
  }
});
UI.preflightTestButton.addEventListener('click', () => {
  startPreflightTest().catch((error) => {
    stopPreflightTest({ status: `测试已停止：${error.message}` }).catch(handleAuxiliaryUiError);
  });
});
bindThresholdMarker(UI.thresholdMarker, UI.meter);
bindThresholdMarker(UI.liveThresholdMarker, UI.liveMeter);
UI.voiceThreshold.addEventListener('input', updateThreshold);
UI.silenceLimit.addEventListener('input', () => {
  const previousSeconds = state.settings.reciteSilenceSeconds;
  state.settings.reciteSilenceSeconds = POLICY.normalizeViolationSeconds('recite', UI.silenceLimit.value);
  UI.silenceLimitValue.textContent = `${state.settings.reciteSilenceSeconds} 秒`;
  if (state.settings.reciteSilenceSeconds !== previousSeconds) resetPreflightDetectionAfterSettingChange();
  saveSettings();
});
UI.studyVoiceLimit.addEventListener('input', () => {
  const previousSeconds = state.settings.studyVoiceSeconds;
  state.settings.studyVoiceSeconds = POLICY.normalizeViolationSeconds('study', UI.studyVoiceLimit.value);
  UI.studyVoiceLimitValue.textContent = `${state.settings.studyVoiceSeconds} 秒`;
  state.quietDetector?.setViolationSeconds(state.settings.studyVoiceSeconds);
  if (state.settings.studyVoiceSeconds !== previousSeconds) resetPreflightDetectionAfterSettingChange();
  saveSettings();
});
UI.speakerEnrollButton.addEventListener('click', () => openSpeakerEnrollment());
UI.speakerDeleteButton.addEventListener('click', () => deleteSpeakerProfile());
UI.enrollmentMicButton.addEventListener('click', () => runEnrollmentMicrophone());
UI.enrollmentCancelButton.addEventListener('click', () => closeSpeakerEnrollment({ cancel: true }));
UI.previewClipButton.addEventListener('click', previewSelectedClip);
UI.recalibrateButton.addEventListener('click', () => {
  if (!state.active || state.sessionPhase !== 'studying') return;
  state.sessionPhase = 'resuming';
  state.studyClock.pause();
  clearPatrolTimer();
  UI.sessionState.textContent = '校准声音中';
  beginNoiseCalibration();
  addLog('重新校准声音。');
});
UI.inlineAlertDismiss.addEventListener('click', () => finishPreview());
UI.inlineAlertStop.addEventListener('click', () => stopSession());
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && state.presentation) finishPreview();
  else if (event.key === 'Escape' && state.enrollmentOpen && !state.enrollmentBusy) {
    closeSpeakerEnrollment({ cancel: true });
  }
});
window.desktopAPI.onWindowModeChanged(({ mode, minimized = false }) => {
  applyWindowMode(mode);
  if (minimized && (state.preflightTesting || state.preflightStarting)) {
    stopPreflightTest({ status: '窗口已最小化，测试已停止。' }).catch(handleAuxiliaryUiError);
  }
});
window.desktopAPI.onWindowMaximizedChanged(({ maximized }) => setWindowMaximizedControl(maximized));
window.desktop.onBreakPromptAction((action) => {
  if (action === 'start') {
    startBreak().then((started) => {
      if (!started) showEarnedBreakPrompt().catch(handleAuxiliaryUiError);
    }).catch(handleSessionFlowError);
  }
  else if (action === 'bank') bankBreakPrompt().catch(handleAuxiliaryUiError);
});
window.addEventListener('pagehide', () => {
  if (state.preflightTesting || state.preflightStarting || state.preflightStopping) {
    stopPreflightTest({ status: '测试已停止。' }).catch(() => {});
  }
});

window.__beishuTest = Object.freeze({
  rules: RULES,
  setRandomValues(values) {
    state.randomValues = Array.isArray(values) ? [...values] : [];
  },
  setPlaybackRate(value) {
    state.playbackRate = Math.max(0.25, Math.min(16, Number(value) || 1));
  },
  clearTrace() {
    state.trace = [];
    state.audioTrace = [];
  },
  getSnapshot() {
    return {
      active: state.active,
      startPending: state.startPending,
      previewPending: state.previewPending,
      speakerProfileMutationPending: state.speakerProfileMutationPending,
      mode: state.mode,
      sessionPhase: state.sessionPhase,
      sessionEnded: state.sessionEnded,
      introComplete: state.introComplete,
      eventBusy: state.eventBusy,
      pendingViolation: state.pendingViolation,
      alertOpen: state.alertOpen,
      alerts: state.alerts,
      lives: state.lives,
      windowMode: state.windowMode,
      trace: state.trace.map((item) => ({ ...item })),
      audioTrace: state.audioTrace.map((item) => ({ ...item })),
      nextPatrolAt: state.nextPatrolAt,
      effectiveElapsedMs: effectiveElapsedMs(),
      breakCredits: currentBreakCredits(),
      restDeadline: state.restDeadline,
      restRemainingSeconds: remainingRestSeconds(),
      earnedPraiseMarks: state.earnedPraiseMarks,
      praisedMark: state.praisedMark,
      reciteSilenceSeconds: state.settings.reciteSilenceSeconds,
      studyVoiceSeconds: state.settings.studyVoiceSeconds,
      reciteSensitivityDb: state.settings.reciteSensitivityDb,
      studySensitivityDb: state.settings.studySensitivityDb,
      latestNoiseFloorDb: state.latestNoiseFloorDb,
      quietDetector: state.quietDetector?.snapshot() || null,
      speakerReady: state.speakerReady,
      speakerProfileExists: state.speakerProfileExists,
      enrollmentPending: state.enrollmentPending,
      enrollmentOpen: state.enrollmentOpen,
      presentation: state.presentation?.kind || null,
      speakerVerificationPending: state.speakerVerificationPending,
      lastSpeakerMatched: state.lastSpeakerMatched,
      lastSpeakerRejected: state.lastSpeakerRejected,
      lastSpeakerScore: state.lastSpeakerScore,
      preflightTesting: state.preflightTesting,
      preflightStarting: state.preflightStarting,
      preflightStopping: state.preflightStopping,
      preflightThresholdReached: state.preflightThresholdReached,
      preflightSpeakerError: state.preflightSpeakerError,
      preflightCanStart: preflightCanStart(),
      microphoneOpen: Boolean(state.audioStream && state.audioContext && state.analyser),
      calibrating: state.calibrating,
    };
  },
  startPreflightTest() {
    return startPreflightTest();
  },
  stopPreflightTest() {
    return stopPreflightTest();
  },
  runScheduledPlan(plan) {
    return runScheduledEvent(plan);
  },
  triggerSilenceViolation() {
    raiseSilenceAlert();
  },
  setStudyMode(mode) {
    setMode(mode);
    return state.mode;
  },
  setEffectiveElapsedMs(value) {
    const elapsedMs = Math.max(0, Number(value) || 0);
    state.studyClock = new POLICY.EffectiveStudyClock({ elapsedMs });
    if (state.sessionPhase === 'studying') state.studyClock.resume();
    settleStudyMilestones();
    UI.timer.textContent = formatTime(Math.floor(effectiveElapsedMs() / 1_000));
    return effectiveElapsedMs();
  },
  startBreak(durationMs = 1_000) {
    return startBreak(durationMs);
  },
  completeBreak() {
    if (state.sessionPhase !== 'resting') return false;
    state.restDeadline = Date.now();
    tickBreak(state.restGeneration);
    return true;
  },
  verifyOwnerVoice(samples, sampleRate = SpeakerAudio.TARGET_SAMPLE_RATE) {
    return verifyOwnerVoice(Float32Array.from(samples), sampleRate);
  },
});

async function initialize() {
  loadSettings();
  updateModeUi();
  state.scenePlayer = new DisciplineMediaPlayer(UI.sceneCanvas, { statusElement: UI.sceneStatus });
  await loadMediaCatalog();
  await showIdleScene();
  await refreshSpeakerState();
  const runtime = await window.desktopAPI.getRuntimeWindowState().catch(() => null);
  setWindowMaximizedControl(runtime?.maximized);
  updateModeUi();
  if (state.mode === 'recite' && state.speakerReady && !state.speakerProfileExists) {
    setChip(UI.voiceState, '需要录入本人声纹');
    UI.voiceStatus.textContent = '开始学习前先录入本人声音';
  } else if (state.mode === 'study') {
    setChip(UI.voiceState, '等待安静自习');
    UI.voiceStatus.textContent = '未在检测声音';
  }
  UI.previewClipButton.disabled = !state.mediaCatalog.length;
}

initialize().catch(async (error) => {
  await stopPreflightTest({ status: `初始化失败，测试已停止：${error.message}` }).catch(() => {});
  UI.startButton.disabled = true;
  UI.startButton.textContent = '场景初始化失败';
  UI.sceneStatus.hidden = false;
  UI.sceneStatus.textContent = error.message;
  console.error(error);
});
