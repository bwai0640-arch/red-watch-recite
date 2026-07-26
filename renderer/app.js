/* global AdaptiveVad, DisciplineMediaPlayer, DisciplineSceneRules, SpeakerAudio, StudyPolicy */

const UI = {
  startButton: document.querySelector('#start-button'),
  stopButton: document.querySelector('#stop-button'),
  breakButton: document.querySelector('#break-button'),
  backgroundAction: document.querySelector('#background-action'),
  backgroundButton: document.querySelector('#background-button'),
  backgroundActionMenu: document.querySelector('#background-action-menu'),
  backgroundChoiceHidden: document.querySelector('#background-choice-hidden'),
  backgroundChoiceFloating: document.querySelector('#background-choice-floating'),
  controlsButton: document.querySelector('#controls-button'),
  exitButton: document.querySelector('#exit-button'),
  windowTitlebar: document.querySelector('#window-titlebar'),
  windowMinimizeButton: document.querySelector('#window-minimize-button'),
  windowMaximizeButton: document.querySelector('#window-maximize-button'),
  windowCloseButton: document.querySelector('#window-close-button'),
  floatingVoiceState: document.querySelector('#floating-voice-state'),
  floatingAnomalyTime: document.querySelector('#floating-anomaly-time'),
  floatingTimer: document.querySelector('#floating-timer'),
  floatingHideButton: document.querySelector('#floating-hide-button'),
  floatingExpandButton: document.querySelector('#floating-expand-button'),
  timer: document.querySelector('#timer'),
  sessionState: document.querySelector('#session-state'),
  voiceState: document.querySelector('#voice-state'),
  voiceStatus: document.querySelector('#voice-status'),
  volumeBar: document.querySelector('#volume-bar'),
  meter: document.querySelector('.meter-wrap .meter'),
  microphoneSelect: document.querySelector('#microphone-select'),
  refreshMicrophonesButton: document.querySelector('#refresh-microphones-button'),
  microphoneStatus: document.querySelector('#microphone-status'),
  preflightTestButton: document.querySelector('#preflight-test-button'),
  preflightTestStatus: document.querySelector('#preflight-test-status'),
  silenceLimit: document.querySelector('#silence-limit-input'),
  silenceLimitValue: document.querySelector('#silence-limit-value'),
  studyVoiceLimit: document.querySelector('#study-voice-limit-input'),
  studyVoiceLimitValue: document.querySelector('#study-voice-limit-value'),
  backgroundModeHidden: document.querySelector('#background-mode-hidden'),
  backgroundModeFloating: document.querySelector('#background-mode-floating'),
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
  eventLog: document.querySelector('#event-log'),
  alertCount: document.querySelector('#alert-count'),
  mediaCount: document.querySelector('#media-count'),
  clipSelect: document.querySelector('#clip-select'),
  previewClipButton: document.querySelector('#preview-clip-button'),
  speakerProfileState: document.querySelector('#speaker-profile-state'),
  speakerProfileSelect: document.querySelector('#speaker-profile-select'),
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
const LEGACY_SETTINGS_STORAGE_KEY = 'red-watch-study-settings-v1';
const MICROPHONE_POLL_MS = 100;
const CALIBRATION_SECONDS = 3;
const SPEAKER_QUICK_WINDOW_SECONDS = 2;
const SPEAKER_QUICK_CONFIRM_THRESHOLD = 0.74;
const SPEAKER_WINDOW_SECONDS = 2.4;
const SPEAKER_OVERLAP_SECONDS = 0.6;
const SPEAKER_VERIFY_INTERVAL_MS = 1_200;
const SPEAKER_CONFIRM_HOLD_MS = 2_500;
const SPEAKER_DEADLINE_GRACE_MS = 3_000;
const SPEAKER_VERIFY_TIMEOUT_MS = 5_000;
const STUDY_EVENT_WINDOW_SECONDS = 2;
const STUDY_EVENT_INTERVAL_MS = 1_000;
const STUDY_RECOVERY_CONFIRM_SECONDS = 5;
const STUDY_EVENT_OVERLAP_SECONDS = Math.max(
  0,
  STUDY_EVENT_WINDOW_SECONDS - (STUDY_EVENT_INTERVAL_MS / 1_000),
);
const ENROLLMENT_DURATION_SECONDS = 24;
const ENROLLMENT_SAMPLE_COUNT = 8;
const ENROLLMENT_WINDOW_SECONDS = 2.4;
const METER_MIN_DB = -100;
const RECITE_AUTO_VOICE_MARGIN_DB = 8;

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
  floatingAnomalyMs: 0,
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
  pcmCapture: null,
  vad: null,
  calibrating: false,
  latestVadSpeech: false,
  speakerReady: false,
  audioEventReady: false,
  audioEventError: '',
  speakerProfileExists: false,
  speakerProfileCreatedAt: '',
  speakerProfiles: [],
  speakerModelError: '',
  speakerProfileError: '',
  speakerChunks: [],
  speakerSampleCount: 0,
  speakerQuickProbeCompleted: false,
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
  studyAudioChunks: [],
  studyAudioSampleCount: 0,
  studyAudioClassificationPending: false,
  studyAudioClassificationGeneration: 0,
  lastStudyAudioClassificationAt: 0,
  latestStudyAudioDecision: null,
  microphoneProcessingWarning: '',
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
    microphoneDeviceId: '',
    microphoneDeviceLabel: '',
    backgroundMode: 'hidden',
  },
  microphoneDevices: [],
  microphoneRefreshPending: false,
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

function studySettingsPayload(source = {}) {
  return {
    mode: source.mode === 'study' ? 'study' : 'recite',
    reciteSilenceSeconds: POLICY.normalizeViolationSeconds('recite', source.reciteSilenceSeconds),
    studyVoiceSeconds: POLICY.normalizeViolationSeconds('study', source.studyVoiceSeconds),
    microphoneDeviceId: typeof source.microphoneDeviceId === 'string'
      ? source.microphoneDeviceId.slice(0, 512)
      : '',
    microphoneDeviceLabel: typeof source.microphoneDeviceLabel === 'string'
      ? source.microphoneDeviceLabel.slice(0, 160)
      : '',
  };
}

async function loadSettings() {
  const durable = await window.desktopAPI.getStudySettings();
  let settings = durable?.settings || {};
  if (!durable?.exists) {
    let legacy = {};
    try {
      legacy = JSON.parse(localStorage.getItem(LEGACY_SETTINGS_STORAGE_KEY) || '{}');
    } catch {
      // Invalid legacy browser storage is replaced by safe defaults below.
    }
    settings = studySettingsPayload(legacy);
    await window.desktopAPI.setStudySettings(settings);
  }
  localStorage.removeItem(LEGACY_SETTINGS_STORAGE_KEY);
  const normalized = studySettingsPayload(settings);
  state.mode = normalized.mode;
  state.settings.reciteSilenceSeconds = normalized.reciteSilenceSeconds;
  state.settings.studyVoiceSeconds = normalized.studyVoiceSeconds;
  state.settings.microphoneDeviceId = normalized.microphoneDeviceId;
  state.settings.microphoneDeviceLabel = normalized.microphoneDeviceLabel;
}

let studySettingsSaveChain = Promise.resolve();

function saveSettings() {
  const payload = studySettingsPayload({ mode: state.mode, ...state.settings });
  const write = studySettingsSaveChain
    .catch(() => {})
    .then(() => window.desktopAPI.setStudySettings(payload));
  studySettingsSaveChain = write.catch((error) => {
    console.error('[settings] 保存学习设置失败：', error);
  });
  return write;
}

function microphoneSelectionLocked() {
  return state.active
    || state.startPending
    || state.preflightTesting
    || state.preflightStarting
    || state.preflightStopping
    || state.enrollmentOpen
    || state.enrollmentPending
    || state.enrollmentBusy;
}

function selectedMicrophone() {
  return state.microphoneDevices.find((device) => device.deviceId === state.settings.microphoneDeviceId) || null;
}

function selectedMicrophoneProfileLabel() {
  const selected = selectedMicrophone();
  const current = selected?.label
    || state.settings.microphoneDeviceLabel
    || (state.settings.microphoneDeviceId ? '已选麦克风' : '系统默认麦克风');
  return current.slice(0, 80);
}

function microphoneConstraints({ rawStudyAudio = state.mode === 'study' } = {}) {
  const audio = {
    echoCancellation: !rawStudyAudio,
    noiseSuppression: !rawStudyAudio,
    autoGainControl: !rawStudyAudio,
    channelCount: 1,
  };
  if (state.settings.microphoneDeviceId) {
    audio.deviceId = { exact: state.settings.microphoneDeviceId };
  }
  return { audio, video: false };
}

function renderMicrophoneUi() {
  const selectedId = state.settings.microphoneDeviceId;
  const selectedPresent = !selectedId || state.microphoneDevices.some((device) => device.deviceId === selectedId);
  UI.microphoneSelect.replaceChildren();
  const defaultOption = document.createElement('option');
  defaultOption.value = '';
  defaultOption.textContent = '系统默认麦克风';
  UI.microphoneSelect.append(defaultOption);
  for (const [index, device] of state.microphoneDevices.entries()) {
    const option = document.createElement('option');
    option.value = device.deviceId;
    option.textContent = device.label || `麦克风 ${index + 1}`;
    UI.microphoneSelect.append(option);
  }
  if (!selectedPresent) {
    const missing = document.createElement('option');
    missing.value = selectedId;
    const savedLabel = state.settings.microphoneDeviceLabel;
    missing.textContent = savedLabel
      ? `${savedLabel}（当前不可用）`
      : '已选麦克风不可用，请重新选择';
    UI.microphoneSelect.append(missing);
  }
  UI.microphoneSelect.value = selectedId;
  UI.microphoneSelect.disabled = microphoneSelectionLocked() || state.microphoneRefreshPending;
  UI.refreshMicrophonesButton.disabled = microphoneSelectionLocked() || state.microphoneRefreshPending;
  const selected = selectedMicrophone();
  if (selectedId && !selectedPresent) {
    const savedLabel = state.settings.microphoneDeviceLabel;
    UI.microphoneStatus.textContent = savedLabel
      ? `已选麦克风“${savedLabel}”当前不可用，请连接后刷新或重新选择。`
      : '已选麦克风当前不可用，请连接后刷新或重新选择。';
  } else if (selected) {
    UI.microphoneStatus.textContent = `当前：${selected.label || '已选麦克风'}。用于测试、学习和声纹录入。`;
  } else {
    UI.microphoneStatus.textContent = '当前：系统默认麦克风。用于测试、学习和声纹录入。';
  }
}

async function refreshMicrophones({ requestPermission = false } = {}) {
  if (!navigator.mediaDevices?.enumerateDevices) throw new Error('当前环境无法枚举麦克风。');
  if (state.microphoneRefreshPending) return;
  state.microphoneRefreshPending = true;
  renderMicrophoneUi();
  let permissionStream = null;
  try {
    if (requestPermission) permissionStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    const devices = await navigator.mediaDevices.enumerateDevices();
    state.microphoneDevices = devices.filter((device) => device.kind === 'audioinput');
    const selected = selectedMicrophone();
    if (selected?.label && selected.label !== state.settings.microphoneDeviceLabel) {
      state.settings.microphoneDeviceLabel = selected.label.slice(0, 160);
      saveSettings();
    }
  } finally {
    permissionStream?.getTracks().forEach((track) => track.stop());
    state.microphoneRefreshPending = false;
    renderMicrophoneUi();
  }
}

function violationLimitSeconds() {
  return state.mode === 'recite'
    ? state.settings.reciteSilenceSeconds
    : state.settings.studyVoiceSeconds;
}

function violationLimitMs() {
  return violationLimitSeconds() * 1_000;
}

function renderFloatingAnomaly() {
  const durationMs = Math.max(0, Number(state.floatingAnomalyMs) || 0);
  const seconds = Math.floor(durationMs / 1_000);
  UI.floatingAnomalyTime.textContent = state.mode === 'study'
    ? `异常声音 ${seconds} 秒`
    : `未确认本人 ${seconds} 秒`;
}

function setFloatingAnomalyDuration(durationMs = 0) {
  state.floatingAnomalyMs = Math.max(0, Number(durationMs) || 0);
  renderFloatingAnomaly();
}

function resetDetectionAfterSettingChange() {
  const preflight = isPreflightAudioActive();
  if (!preflight) return;
  state.preflightThresholdReached = false;
  state.latestQuietResult = null;
  document.body.dataset.voiceDetected = 'false';
  if (state.mode === 'study') {
    state.quietDetector?.reset();
    resetStudyAudioRuntime();
  } else {
    resetSpeakerRuntime();
    state.silentSince = state.calibrating ? 0 : Date.now();
    state.silenceArmed = !state.calibrating;
  }
  setFloatingAnomalyDuration(0);
  if (state.calibrating) {
    updatePreflightUi('设置已更新，校准完成后继续测试。');
    return;
  }
  setChip(UI.voiceState, state.mode === 'study' ? '等待安静检测' : '等待本人声音');
  UI.voiceStatus.textContent = '设置已更新，请继续测试';
  updatePreflightUi('设置已更新，请继续测试。');
}

function animationWatchPresentationActive() {
  return state.active
    && state.eventBusy
    && state.sessionPhase === 'studying'
    && !state.alertOpen;
}

function setChip(element, text, kind = '') {
  if (element === UI.voiceState && kind !== 'watch' && animationWatchPresentationActive()) {
    text = '好好学！盯着你呢！';
    kind = 'watch';
  }
  element.textContent = text;
  element.className = `chip ${kind}`.trim();
  if (element === UI.voiceState) {
    const watchPresentation = kind === 'watch';
    UI.liveVoiceState.textContent = text;
    UI.liveVoiceState.className = `chip ${kind}`.trim();
    UI.liveVoiceDuration.textContent = text;
    UI.liveVoiceDuration.classList.toggle('watch-copy', watchPresentation);
    UI.floatingVoiceState.textContent = text;
    UI.floatingVoiceState.className = `floating-voice-state ${kind}`.trim();
    UI.voiceStatus.classList.toggle('watch-copy', watchPresentation);
  }
}

function updateBackgroundModeUi() {
  const floating = state.settings.backgroundMode === 'floating';
  UI.backgroundModeHidden.classList.toggle('active', !floating);
  UI.backgroundModeFloating.classList.toggle('active', floating);
  UI.backgroundModeHidden.setAttribute('aria-pressed', String(!floating));
  UI.backgroundModeFloating.setAttribute('aria-pressed', String(floating));
  UI.backgroundChoiceHidden.classList.toggle('active', !floating);
  UI.backgroundChoiceFloating.classList.toggle('active', floating);
  UI.backgroundChoiceHidden.setAttribute('aria-pressed', String(!floating));
  UI.backgroundChoiceFloating.setAttribute('aria-pressed', String(floating));
  UI.backgroundButton.textContent = '隐藏到后台';
  const closeLabel = state.active && floating ? '显示漂浮窗' : '隐藏到后台';
  UI.windowCloseButton.setAttribute('aria-label', closeLabel);
  UI.windowCloseButton.title = closeLabel;
}

function setBackgroundActionExpanded(expanded) {
  const open = Boolean(expanded) && !UI.backgroundButton.disabled;
  UI.backgroundAction.classList.toggle('menu-open', open);
  UI.backgroundButton.setAttribute('aria-expanded', String(open));
  UI.backgroundActionMenu.setAttribute('aria-hidden', String(!open));
}

function setBackgroundControlDisabled(disabled) {
  const next = Boolean(disabled);
  UI.backgroundButton.disabled = next;
  UI.backgroundChoiceHidden.disabled = next;
  UI.backgroundChoiceFloating.disabled = next;
  if (next) setBackgroundActionExpanded(false);
}

let backgroundPreferenceMutation = 0;

async function setBackgroundMode(mode) {
  const normalized = mode === 'floating' ? 'floating' : 'hidden';
  const mutation = ++backgroundPreferenceMutation;
  state.settings.backgroundMode = normalized;
  updateBackgroundModeUi();
  try {
    const saved = await window.desktopAPI.setBackgroundPreference(normalized);
    if (mutation !== backgroundPreferenceMutation) return;
    state.settings.backgroundMode = saved?.backgroundMode === 'floating' ? 'floating' : 'hidden';
  } catch (error) {
    if (mutation === backgroundPreferenceMutation) {
      const persisted = await window.desktopAPI.getBackgroundPreference().catch(() => null);
      state.settings.backgroundMode = persisted?.backgroundMode === 'floating' ? 'floating' : 'hidden';
    }
    throw error;
  } finally {
    if (mutation === backgroundPreferenceMutation) updateBackgroundModeUi();
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
  return state.mode === 'study' ? state.audioEventReady : state.speakerReady;
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
    ? state.audioEventReady
    : (state.speakerReady && state.speakerProfileExists && !state.speakerModelError);
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

function isStudyDetectionActive() {
  if (state.mode !== 'study' || !state.audioEventReady || !state.silenceArmed) return false;
  if (state.calibrating || state.alertOpen || state.silencePausedAt) return false;
  return isPreflightAudioActive() || (
    state.active
    && state.sessionPhase === 'studying'
    && state.introComplete
  );
}

function updatePreflightUi(status) {
  if (!UI.preflightTestButton || !UI.preflightTestStatus) return;
  const setStatus = (text) => {
    UI.preflightTestStatus.textContent = text;
    UI.preflightTestStatus.classList.toggle('watch-copy', text === '好好学！盯着你呢！');
  };
  if (typeof status === 'string') setStatus(status);
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
    setStatus(state.speakerProfileError
      ? `${state.speakerProfileError} 请重新录入一次。`
      : '请先录入本人声音，再测试背书检测。');
  } else if (state.mode === 'recite' && !state.speakerReady) {
    setStatus(state.speakerModelError || '正在准备声纹模型…');
  } else if (state.mode === 'study' && !state.audioEventReady) {
    setStatus(state.audioEventError || '正在准备声音分类模型…');
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
  UI.silenceLimit.value = String(state.settings.reciteSilenceSeconds);
  UI.silenceLimitValue.textContent = `${state.settings.reciteSilenceSeconds} 秒`;
  UI.studyVoiceLimit.value = String(state.settings.studyVoiceSeconds);
  UI.studyVoiceLimitValue.textContent = `${state.settings.studyVoiceSeconds} 秒`;
  document.querySelectorAll('.study-only').forEach((element) => { element.hidden = !studyingQuietly; });
  document.querySelectorAll('.recite-only').forEach((element) => { element.hidden = studyingQuietly; });
  if (!state.active) {
    UI.startButton.disabled = !startAllowed();
    if (state.startPending) UI.startButton.textContent = '正在启动麦克风…';
    else if (state.previewPending || state.presentation) UI.startButton.textContent = '动画预览中';
    else if (state.speakerProfileMutationPending) UI.startButton.textContent = '正在更新声纹…';
    else if (state.enrollmentPending || state.enrollmentOpen) UI.startButton.textContent = '正在录入声纹';
    else if (startAllowed()) UI.startButton.textContent = state.sessionEnded ? '重新开始学习' : '开始学习';
    else if (state.mode === 'recite' && !state.speakerReady) UI.startButton.textContent = '声纹模型不可用';
    else if (state.mode === 'study' && !state.audioEventReady) UI.startButton.textContent = '声音分类不可用';
    else UI.startButton.textContent = '正在准备场景…';
  }
  UI.previewClipButton.disabled = !state.mediaCatalog.length
    || idleOperationBusy
    || state.active
    || state.sceneRunning
    || Boolean(state.presentation)
    || state.enrollmentOpen;
  renderMicrophoneUi();
  updateBreakButton();
  updatePreflightUi();
  updateBackgroundModeUi();
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
  setFloatingAnomalyDuration(0);
  state.milestoneLedger = new POLICY.MilestoneLedger(mode);
  saveSettings();
  updateModeUi();
  if (mode === 'recite' && state.speakerReady && !state.speakerProfileExists) {
    setChip(UI.voiceState, '需要录入本人声纹');
    UI.voiceStatus.textContent = state.speakerProfileError
      ? `${state.speakerProfileError} 请重新录入一次。`
      : '开始学习前先录入本人声音';
  } else if (mode === 'study' && !state.audioEventReady) {
    setChip(UI.voiceState, '声音分类不可用', 'alert');
    UI.voiceStatus.textContent = state.audioEventError || '本地声音分类模型不可用';
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
    UI.speakerProfileSelect.hidden = true;
    return;
  }
  if (!state.speakerReady) {
    setChip(UI.speakerProfileState, '正在加载声纹模型…');
    UI.speakerEnrollButton.disabled = true;
    UI.speakerDeleteButton.hidden = true;
    UI.speakerProfileSelect.hidden = true;
    return;
  }
  if (state.speakerProfileExists) {
    const count = state.speakerProfiles.length;
    setChip(UI.speakerProfileState, `已保存 ${count} 份本人声纹`, 'good');
    UI.speakerProfileSelect.replaceChildren();
    for (const [index, profile] of state.speakerProfiles.entries()) {
      const option = document.createElement('option');
      option.value = profile.id;
      option.textContent = profile.label || `声纹 ${index + 1}`;
      UI.speakerProfileSelect.append(option);
    }
    UI.speakerProfileSelect.hidden = false;
    UI.speakerEnrollButton.textContent = '新增当前麦克风声纹';
    UI.speakerDeleteButton.hidden = false;
  } else {
    setChip(UI.speakerProfileState, state.speakerProfileError ? '旧声纹需要重新录入' : '尚未录入本人声纹', state.speakerProfileError ? 'alert' : '');
    UI.speakerEnrollButton.textContent = '录入本人声音';
    UI.speakerDeleteButton.hidden = true;
    UI.speakerProfileSelect.hidden = true;
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
  UI.speakerProfileSelect.disabled = speakerActionDisabled;
  updatePreflightUi();
}

async function refreshSpeakerState() {
  try {
    const profile = await window.desktopAPI.getSpeakerState();
    state.speakerReady = Boolean(profile?.ready);
    state.speakerProfileExists = Boolean(profile?.profileExists);
    state.speakerProfileCreatedAt = profile?.createdAt || '';
    state.speakerProfiles = Array.isArray(profile?.profiles) ? profile.profiles : [];
    state.speakerModelError = state.speakerReady ? '' : (profile?.error || '声纹服务启动失败');
    state.speakerProfileError = state.speakerReady && !state.speakerProfileExists ? (profile?.error || '') : '';
  } catch (error) {
    state.speakerReady = false;
    state.speakerProfileExists = false;
    state.speakerProfiles = [];
    state.speakerModelError = error.message || '声纹服务启动失败';
    state.speakerProfileError = '';
  }
  updateSpeakerProfileUi();
  updatePreflightUi(
    state.mode === 'recite' && state.speakerReady && !state.speakerProfileExists
      ? '请先录入本人声音，再测试背书检测。'
      : '可在开始学习前测试当前检测设置。',
  );
  return state.speakerReady && state.speakerProfileExists;
}

async function refreshAudioEventState() {
  try {
    const service = await window.desktopAPI.getAudioEventState();
    state.audioEventReady = Boolean(service?.ready);
    state.audioEventError = state.audioEventReady ? '' : (service?.error || '声音分类服务启动失败');
  } catch (error) {
    state.audioEventReady = false;
    state.audioEventError = error.message || '声音分类服务启动失败';
  }
  updateModeUi();
  updatePreflightUi();
  return state.audioEventReady;
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
    await window.desktopAPI.beginSpeakerEnrollment({ label: selectedMicrophoneProfileLabel() });
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
  const stream = await navigator.mediaDevices.getUserMedia(microphoneConstraints({ rawStudyAudio: false }));
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
    await window.desktopAPI.beginSpeakerEnrollment({ label: selectedMicrophoneProfileLabel() }).catch(() => {});
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
    const profileId = UI.speakerProfileSelect.value;
    if (!profileId) throw new Error('请先选择要删除的声纹。');
    await window.desktopAPI.deleteSpeakerProfile(profileId);
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
  let earnedPraise = false;
  events.forEach((event) => {
    if (event.type === 'break-voucher-earned') {
      earnedBreak = true;
      state.breakPromptPending = true;
      addLog(`获得 1 次两分钟休息，现有 ${currentBreakCredits()} 次。`);
    } else if (event.type === 'praise-earned') {
      state.earnedPraiseMarks = Math.max(state.earnedPraiseMarks, event.milestoneIndex);
      earnedPraise = true;
    }
  });
  updateBreakButton();
  if (earnedBreak) showEarnedBreakPrompt().catch(handleAuxiliaryUiError);
  if (
    earnedPraise
    && state.sessionPhase === 'studying'
    && !state.eventBusy
    && !state.pendingViolation
  ) scheduleNextPatrol(250);
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
    if (state.windowMode === 'hidden' && state.earnedPraiseMarks <= state.praisedMark) {
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
  setFloatingAnomalyDuration(0);
  state.quietDetector?.reset();
  if (state.mode === 'study') resetStudyAudioRuntime();
}

function pauseSilenceClock() {
  if (!state.silenceArmed || state.silencePausedAt) return;
  state.silencePausedAt = Date.now();
  if (state.mode === 'study') resetStudyAudioRuntime();
  showAnimationWatchState();
}

function resumeSilenceClock() {
  if (!state.silencePausedAt) return;
  if (state.silentSince) state.silentSince += Math.max(0, Date.now() - state.silencePausedAt);
  state.silencePausedAt = 0;
  if (state.mode === 'study') resetStudyAudioRuntime();
  showAnimationWatchState();
}

function showAnimationWatchState() {
  const label = '好好学！盯着你呢！';
  setChip(UI.voiceState, label, 'watch');
  UI.voiceStatus.textContent = label;
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
  UI.sessionState.textContent = state.mode === 'study' ? '声音检测准备中' : '本人声音检测准备中';
  beginDetectionWarmup();
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
    UI.sessionState.textContent = state.mode === 'study' ? '声音检测准备中' : '本人声音检测准备中';
    beginDetectionWarmup();
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
  const milestonePraise = Boolean(plan.milestonePraise || plan.hourlySalute);
  const revealPraiseFromBackground = milestonePraise
    && (state.windowMode === 'hidden' || state.windowMode === 'floating');
  const pausesAudioDetection = planUsesSourceAudio(plan);
  const pausesStudyClock = pausesAudioDetection;
  const token = state.sceneToken;
  state.eventBusy = true;
  updateBreakButton();
  showAnimationWatchState();
  if (pausesAudioDetection) pauseSilenceClock();
  if (pausesStudyClock) state.studyClock.pause();
  let playbackCompleted = false;
  let praiseAlertId = 0;
  try {
    if (revealPraiseFromBackground) {
      document.body.classList.add('praise-presentation');
      const reveal = await window.desktopAPI.revealForInlineAlert();
      praiseAlertId = Number(reveal?.alertId) || 0;
      if (!praiseAlertId) throw new Error('表扬场景未能显示。');
    }
    state.eventPromise = playPlan(plan, token);
    playbackCompleted = await state.eventPromise;
  } finally {
    if (token === state.sceneToken) state.eventBusy = false;
    state.eventPromise = null;
    if (token === state.sceneToken && pausesAudioDetection) resumeSilenceClock();
    if (pausesStudyClock && state.active && state.sessionPhase === 'studying') {
      state.studyClock.resume();
    }
    if (praiseAlertId > 0) {
      await window.desktopAPI.finishInlineAlert({ alertId: praiseAlertId, disposition: 'return' })
        .catch(handleAuxiliaryUiError);
    }
    document.body.classList.remove('praise-presentation');
    updateBreakButton();
    showEarnedBreakPrompt().catch(handleAuxiliaryUiError);
  }

  if (token !== state.sceneToken) return false;
  if (playbackCompleted && milestonePraise) {
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
    audioStream = await navigator.mediaDevices.getUserMedia(microphoneConstraints());
    if (audioStream.getVideoTracks().length !== 0) {
      throw new Error('检测到非预期的视频轨道，已拒绝启动。');
    }
    const audioTracks = audioStream.getAudioTracks();
    if (!audioTracks.length) throw new Error('麦克风没有可用的实时音频轨道。');
    const microphoneSettings = typeof audioTracks[0].getSettings === 'function'
      ? audioTracks[0].getSettings()
      : {};
    const enabledProcessing = state.mode === 'study'
      ? ['echoCancellation', 'noiseSuppression', 'autoGainControl']
        .filter((name) => microphoneSettings?.[name] === true)
      : [];
    state.microphoneProcessingWarning = enabledProcessing.length
      ? '麦克风驱动仍启用了声音处理，电脑扬声器中的视频声可能被削弱。'
      : '';
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

    pcmCapture = new SpeakerAudio.ContinuousPcmCapture(
      audioContext,
      source,
      onRuntimePcmChunk,
    );
    await pcmCapture.start();
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
    refreshMicrophones().catch(() => {});
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
  setFloatingAnomalyDuration(0);
  resetSpeakerRuntime();
  resetStudyAudioRuntime();
  state.microphoneProcessingWarning = '';
}

function resetIdleDetectionUi() {
  setFloatingAnomalyDuration(0);
  if (!state.active && !state.startPending && !state.enrollmentOpen && !state.enrollmentPending) {
    setChip(UI.voiceState, state.mode === 'study' ? '等待安静自习' : '未开启');
    UI.voiceStatus.textContent = '未在检测声音';
  }
  UI.volumeBar.style.width = '0%';
  UI.liveVolumeBar.style.width = '0%';
  UI.meter.setAttribute('aria-valuenow', '0');
  UI.liveMeter.setAttribute('aria-valuenow', '0');
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
  if (state.mode === 'study' && !state.audioEventReady) {
    await refreshAudioEventState();
    if (!state.audioEventReady) {
      updatePreflightUi(state.audioEventError || '声音分类模型不可用。');
      return false;
    }
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
  updatePreflightUi(state.mode === 'study'
    ? '启动麦克风后直接检测声音。'
    : '启动麦克风后将自动适应当前环境。');
  try {
    const opened = await openMicrophone();
    if (!opened || generation !== state.preflightGeneration || !state.preflightStarting) return false;
    state.preflightStarting = false;
    state.preflightTesting = true;
    beginDetectionWarmup();
    updatePreflightUi(state.mode === 'study'
      ? '声音检测已开始，正在形成首个分类窗口。'
      : '正在准备本人声音检测，请保持平时的学习环境。');
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
    await window.desktopAPI.hideToBackground('hidden');
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
  setBackgroundControlDisabled(true);
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

async function finishFatalViolation(plan, alertId) {
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
  await window.desktopAPI.finishInlineAlert({ alertId, disposition: 'scene' });
  hideOverlay();
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
  let alertId = 0;
  let revealed = false;
  let playbackCompleted = false;
  let aborted = false;
  showOverlay({
    title: violationDescription(),
    message: `第 ${plan.strike} 次提醒`,
    controls: false,
  });
  try {
    const revealResult = await window.desktopAPI.revealForInlineAlert();
    alertId = Number(revealResult?.alertId) || 0;
    revealed = alertId > 0;
    if (token !== state.sceneToken || !state.active || state.stopRequested) {
      aborted = true;
    } else {
      state.eventPromise = playPlan(plan, token);
      playbackCompleted = await state.eventPromise;
    }
  } catch (error) {
    if (revealed) {
      await window.desktopAPI.finishInlineAlert({ alertId, disposition: 'scene' }).catch(() => {});
    }
    state.alertOpen = false;
    hideOverlay();
    throw error;
  } finally {
    if (token === state.sceneToken) state.eventBusy = false;
    state.eventPromise = null;
    updateBreakButton();
  }
  if (token !== state.sceneToken) {
    if (revealed) await window.desktopAPI.finishInlineAlert({ alertId, disposition: 'scene' });
    hideOverlay();
    return false;
  }
  if (aborted || !state.active || state.stopRequested) {
    state.alertOpen = false;
    if (revealed) await window.desktopAPI.finishInlineAlert({ alertId, disposition: 'scene' });
    hideOverlay();
    if (state.stopRequested) await finalizeManualStop();
    return false;
  }
  if (!playbackCompleted) {
    state.alertOpen = false;
    if (revealed) await window.desktopAPI.finishInlineAlert({ alertId, disposition: 'scene' });
    hideOverlay();
    return false;
  }

  state.lives = Math.max(0, state.lives - 1);
  if (plan.fatal) {
    await finishFatalViolation(plan, alertId);
    return true;
  }

  state.alertOpen = false;
  if (state.stopRequested) {
    await window.desktopAPI.finishInlineAlert({ alertId, disposition: 'scene' });
    hideOverlay();
    await finalizeManualStop();
    return true;
  }

  state.sessionPhase = 'studying';
  if (state.active) state.studyClock.resume();
  armSilenceClock();
  await window.desktopAPI.finishInlineAlert({ alertId, disposition: 'return' });
  hideOverlay();
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
  setBackgroundControlDisabled(true);
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
      await stopPreflightTest({ status: '好好学！盯着你呢！' });
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
    const presentation = { kind: 'preview', token, clip, alertId: 0 };
    state.presentation = presentation;
    state.previewPending = false;
    updateModeUi();
    updateSpeakerProfileUi();
    updatePreflightUi();
    showOverlay({ title: '动画预览', message: `${clip.code}｜${clip.name}`, controls: true, preview: true });
    const revealResult = await window.desktopAPI.revealForInlineAlert();
    presentation.alertId = Number(revealResult?.alertId) || 0;
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
  await showIdleScene().catch(() => {});
  if (presentation.alertId > 0) {
    await window.desktopAPI.finishInlineAlert({ alertId: presentation.alertId, disposition: 'scene' });
  } else {
    await window.desktopAPI.restoreSceneMode();
  }
  hideOverlay();
  updateModeUi();
  updateSpeakerProfileUi();
  updatePreflightUi('可继续测试当前检测设置。');
}

function startElapsedTimer() {
  UI.timer.textContent = '00:00';
  UI.floatingTimer.textContent = '已学习 00:00';
  setFloatingAnomalyDuration(0);
  stopElapsedTimer();
  state.elapsedTimer = window.setInterval(() => {
    const elapsed = formatTime(Math.floor(effectiveElapsedMs() / 1_000));
    UI.timer.textContent = elapsed;
    UI.floatingTimer.textContent = `已学习 ${elapsed}`;
    renderFloatingAnomaly();
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

function calculateAudioLevelPercent() {
  state.analyser.getFloatTimeDomainData(state.samples);
  const sum = state.samples.reduce((total, sample) => total + sample * sample, 0);
  const rms = Math.sqrt(sum / Math.max(1, state.samples.length));
  const db = Math.max(METER_MIN_DB, 20 * Math.log10(Math.max(rms, 0.00001)));
  return clamp(Math.round(db - METER_MIN_DB), 0, 100);
}

function resetSpeakerRuntime() {
  state.speakerVerificationGeneration += 1;
  state.latestVadSpeech = false;
  state.speakerChunks = [];
  state.speakerSampleCount = 0;
  state.speakerQuickProbeCompleted = false;
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

function resetStudyAudioRuntime() {
  state.studyAudioClassificationGeneration += 1;
  state.studyAudioChunks = [];
  state.studyAudioSampleCount = 0;
  state.studyAudioClassificationPending = false;
  state.lastStudyAudioClassificationAt = 0;
  state.latestStudyAudioDecision = null;
}

function renderStudyAudioDecision(quietResult, decision) {
  const preflight = isPreflightAudioActive();
  const candidateActive = quietResult.rawEvidenceMs > 0;
  state.latestQuietResult = quietResult;
  state.latestStudyAudioDecision = decision;
  setFloatingAnomalyDuration(
    quietResult.violated ? quietResult.violationThresholdMs : quietResult.suspectedSpeechMs,
  );
  document.body.dataset.voiceDetected = String(
    decision.mediaEvidence || candidateActive,
  );
  if (preflight && quietResult.violated) state.preflightThresholdReached = true;
  else if (preflight && quietResult.rearmed) state.preflightThresholdReached = false;

  if (preflight && state.preflightThresholdReached) {
    setChip(UI.voiceState, '已达到提醒条件', 'alert');
    UI.voiceStatus.textContent = '已达到提醒条件';
  } else if (decision.mediaEvidence && quietResult.suspectedSpeechMs <= 0) {
    setChip(UI.voiceState, '正在复核媒体声音');
    UI.voiceStatus.textContent = '正在复核媒体声音';
  } else if (decision.mediaEvidence) {
    const seconds = (quietResult.suspectedSpeechMs / 1_000).toFixed(1);
    setChip(UI.voiceState, `疑似媒体声音 ${seconds} 秒`, 'alert');
    UI.voiceStatus.textContent = `疑似媒体声音 ${seconds} 秒`;
  } else if (candidateActive) {
    setChip(UI.voiceState, '正在确认恢复');
    UI.voiceStatus.textContent = '正在确认恢复';
  } else if (!quietResult.armed) {
    setChip(UI.voiceState, '等待恢复安静');
    UI.voiceStatus.textContent = '保持安静后继续检测';
  } else if (decision.keyboardOnly) {
    setChip(UI.voiceState, '键盘输入', 'good');
    UI.voiceStatus.textContent = '键盘输入';
  } else {
    setChip(UI.voiceState, '安静', 'good');
    UI.voiceStatus.textContent = '当前安静';
  }

  if (preflight) {
    if (state.preflightThresholdReached) {
      updatePreflightUi('按当前设置将触发提醒。');
    } else if (!decision.mediaEvidence && candidateActive) {
      updatePreflightUi('正在确认恢复，连续正常 5 秒后清除本次累计。');
    } else if (decision.mediaEvidence) {
      updatePreflightUi(`已累计疑似媒体声音 ${(quietResult.suspectedSpeechMs / 1_000).toFixed(1)} 秒。`);
    } else if (decision.keyboardOnly) {
      updatePreflightUi('已识别为键盘输入，未达到提醒条件。');
    } else if (state.microphoneProcessingWarning) {
      updatePreflightUi(state.microphoneProcessingWarning);
    } else {
      updatePreflightUi('当前没有达到提醒条件。');
    }
  } else if (quietResult.violated) {
    raiseSilenceAlert();
  }
  if (animationWatchPresentationActive()) showAnimationWatchState();
}

async function classifyStudyAudioWindow(samples, sampleRate, decisionDurationMs, generation) {
  state.studyAudioClassificationPending = true;
  try {
    const normalized = sampleRate === SpeakerAudio.TARGET_SAMPLE_RATE
      ? samples
      : SpeakerAudio.resampleLinear(samples, sampleRate, SpeakerAudio.TARGET_SAMPLE_RATE);
    const result = await window.desktopAPI.classifyAudioEvents({
      samples: normalized,
      sampleRate: SpeakerAudio.TARGET_SAMPLE_RATE,
    });
    if (generation !== state.studyAudioClassificationGeneration || !isStudyDetectionActive()) return;
    const decision = POLICY.classifyStudyAudioEvents(result?.events);
    const quietResult = state.quietDetector.process(
      {
        mediaEvidence: decision.mediaEvidence,
        transientEvidence: decision.transientEvidence,
      },
      decisionDurationMs,
    );
    renderStudyAudioDecision(quietResult, decision);
  } catch (error) {
    if (generation !== state.studyAudioClassificationGeneration) return;
    state.audioEventReady = false;
    state.audioEventError = error.message || '声音分类失败';
    if (isPreflightAudioActive()) {
      stopPreflightTest({ status: `测试已停止：${state.audioEventError}` }).catch(handleAuxiliaryUiError);
    } else if (state.active) {
      handleSessionFlowError(error, { voiceMessage: '声音分类不可用，学习已安全停止。' });
    }
  } finally {
    if (generation === state.studyAudioClassificationGeneration) {
      state.studyAudioClassificationPending = false;
    }
  }
}

function onStudyPcmChunk(chunk) {
  if (!isStudyDetectionActive()) return;
  const sampleRate = state.audioContext?.sampleRate || SpeakerAudio.TARGET_SAMPLE_RATE;
  const targetLength = Math.round(sampleRate * STUDY_EVENT_WINDOW_SECONDS);
  state.studyAudioChunks.push(chunk);
  state.studyAudioSampleCount += chunk.length;

  if (state.studyAudioSampleCount > targetLength * 2) {
    const compacted = SpeakerAudio.concatChunks(state.studyAudioChunks, state.studyAudioSampleCount)
      .slice(-targetLength);
    state.studyAudioChunks = [compacted];
    state.studyAudioSampleCount = compacted.length;
  }

  const now = Date.now();
  if (
    state.studyAudioSampleCount < targetLength
    || state.studyAudioClassificationPending
    || (state.lastStudyAudioClassificationAt && now - state.lastStudyAudioClassificationAt < STUDY_EVENT_INTERVAL_MS)
  ) return;

  const allSamples = SpeakerAudio.concatChunks(state.studyAudioChunks, state.studyAudioSampleCount);
  const windowSamples = allSamples.slice(Math.max(0, allSamples.length - targetLength));
  state.studyAudioChunks = [windowSamples];
  state.studyAudioSampleCount = windowSamples.length;
  const decisionDurationMs = state.lastStudyAudioClassificationAt
    ? clamp(now - state.lastStudyAudioClassificationAt, 500, 1_500)
    : STUDY_EVENT_INTERVAL_MS;
  state.lastStudyAudioClassificationAt = now;
  classifyStudyAudioWindow(
    windowSamples,
    sampleRate,
    decisionDurationMs,
    state.studyAudioClassificationGeneration,
  );
}

async function verifyOwnerVoice(samples, sourceSampleRate, { quickProbe = false } = {}) {
  if (
    state.speakerVerificationPending
    || !isReciteDetectionActive()
  ) return;
  const generation = state.speakerVerificationGeneration;
  state.speakerVerificationPending = true;
  state.lastSpeakerVerificationAt = Date.now();
  let verificationTimeout = null;
  try {
    const normalized = sourceSampleRate === SpeakerAudio.TARGET_SAMPLE_RATE
      ? samples
      : SpeakerAudio.resampleLinear(samples, sourceSampleRate, SpeakerAudio.TARGET_SAMPLE_RATE);
    const result = await Promise.race([
      window.desktopAPI.verifySpeaker({
        samples: normalized,
        sampleRate: SpeakerAudio.TARGET_SAMPLE_RATE,
      }),
      new Promise((_, reject) => {
        verificationTimeout = setTimeout(() => {
          reject(new Error('声纹处理超时。'));
        }, SPEAKER_VERIFY_TIMEOUT_MS);
      }),
    ]);
    if (
      generation !== state.speakerVerificationGeneration
      || !isReciteDetectionActive()
    ) return;
    if (result?.error) throw new Error(
      typeof result.error === 'string' ? result.error : '声纹服务暂时不可用。',
    );
    state.preflightSpeakerError = '';
    const now = Date.now();
    const matched = Boolean(result?.matched);
    const strongMatch = Boolean(result?.strongMatch);
    const score = Number(result?.score) || 0;
    const threshold = Number(result?.threshold) || 0.55;
    const quickConfirmed = quickProbe
      && matched
      && score >= SPEAKER_QUICK_CONFIRM_THRESHOLD;
    if (quickProbe && !quickConfirmed) {
      state.lastSpeakerVerificationAt = 0;
      document.body.dataset.voiceDetected = 'false';
      setChip(UI.voiceState, '正在复核本人声音');
      UI.voiceStatus.textContent = '正在复核本人声音';
      return;
    }
    state.speakerMatchHistory.push({ at: now, matched });
    state.speakerMatchHistory = state.speakerMatchHistory
      .filter((item) => now - item.at <= 6_000)
      .slice(-3);
    const recentMatches = state.speakerMatchHistory.filter((item) => item.matched).length;
    const repeatedMatch = matched && recentMatches >= 2;
    const confirmed = quickConfirmed || (matched && (strongMatch || repeatedMatch));
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
      setFloatingAnomalyDuration(0);
      if (quickProbe) {
        state.speakerChunks = [];
        state.speakerSampleCount = 0;
        state.speakerQuickProbeCompleted = false;
        state.lastSpeechChunkAt = 0;
      }
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
      await stopPreflightTest({ status: `声纹服务异常，测试已安全停止：${error.message}` });
    } else if (state.active) {
      await stopSession(false, true);
      setChip(UI.voiceState, '声纹服务异常', 'alert');
      UI.voiceStatus.textContent = `检测已安全停止：${error.message}`;
      UI.sessionState.textContent = '检测已安全停止';
      addLog('声纹服务异常，本次学习已安全停止，未计为违规。');
    }
  } finally {
    if (verificationTimeout) clearTimeout(verificationTimeout);
    if (generation === state.speakerVerificationGeneration) {
      state.speakerVerificationPending = false;
      pumpSpeakerVerification(sourceSampleRate);
    }
  }
}

function pumpSpeakerVerification(sourceSampleRate) {
  if (!isReciteDetectionActive() || state.speakerVerificationPending) return;
  const sampleRate = sourceSampleRate
    || state.audioContext?.sampleRate
    || SpeakerAudio.TARGET_SAMPLE_RATE;
  const quickLength = Math.round(sampleRate * SPEAKER_QUICK_WINDOW_SECONDS);
  const targetLength = Math.round(sampleRate * SPEAKER_WINDOW_SECONDS);
  if (
    !state.speakerQuickProbeCompleted
    && state.speakerSampleCount >= quickLength
  ) {
    state.speakerQuickProbeCompleted = true;
    const quickSamples = SpeakerAudio.concatChunks(state.speakerChunks, state.speakerSampleCount)
      .slice(Math.max(0, state.speakerSampleCount - quickLength));
    verifyOwnerVoice(quickSamples, sampleRate, { quickProbe: true });
    return;
  }
  if (
    state.speakerSampleCount < targetLength
    || Date.now() - state.lastSpeakerVerificationAt < SPEAKER_VERIFY_INTERVAL_MS
  ) return;

  const allSamples = SpeakerAudio.concatChunks(state.speakerChunks, state.speakerSampleCount);
  const windowSamples = allSamples.slice(Math.max(0, allSamples.length - targetLength));
  const overlapLength = Math.round(sampleRate * SPEAKER_OVERLAP_SECONDS);
  const overlap = allSamples.slice(Math.max(0, allSamples.length - overlapLength));
  state.speakerChunks = overlap.length ? [overlap] : [];
  state.speakerSampleCount = overlap.length;
  verifyOwnerVoice(windowSamples, sampleRate);
}

function onRuntimePcmChunk(chunk) {
  if (state.mode === 'study') {
    onStudyPcmChunk(chunk);
    return;
  }
  if (
    !isReciteDetectionActive()
    || !state.latestVadSpeech
  ) return;

  const now = Date.now();
  if (state.lastSpeechChunkAt && now - state.lastSpeechChunkAt > 650) {
    state.speakerChunks = [];
    state.speakerSampleCount = 0;
    state.speakerQuickProbeCompleted = false;
  }
  state.lastSpeechChunkAt = now;
  state.speakerChunks.push(chunk);
  state.speakerSampleCount += chunk.length;
  pumpSpeakerVerification(state.audioContext?.sampleRate || SpeakerAudio.TARGET_SAMPLE_RATE);
}

function beginDetectionWarmup() {
  const directStudyDetection = state.mode === 'study';
  state.vad = directStudyDetection
    ? null
    : new AdaptiveVad.AdaptiveVoiceDetector({
      calibrationFrames: Math.round((CALIBRATION_SECONDS * 1000) / MICROPHONE_POLL_MS),
      sensitivityDb: RECITE_AUTO_VOICE_MARGIN_DB,
    });
  state.calibrating = !directStudyDetection;
  state.quietDetector = directStudyDetection
    ? new POLICY.QuietModeDetector({
      violationSeconds: state.settings.studyVoiceSeconds,
      rearmQuietSeconds: STUDY_RECOVERY_CONFIRM_SECONDS,
      evidenceGapSeconds: STUDY_RECOVERY_CONFIRM_SECONDS,
      evidenceOverlapSeconds: STUDY_EVENT_OVERLAP_SECONDS,
      frameMs: STUDY_EVENT_INTERVAL_MS,
    })
    : null;
  state.latestQuietResult = null;
  state.silenceArmed = directStudyDetection;
  state.silentSince = 0;
  state.previousSpectrum = null;
  resetSpeakerRuntime();
  resetStudyAudioRuntime();
  if (directStudyDetection) {
    document.body.dataset.vadState = 'ready';
    setChip(UI.voiceState, '正在识别声音');
    UI.voiceStatus.textContent = '等待首个声音分类结果';
    if (isPreflightAudioActive()) {
      updatePreflightUi('声音检测已开始，正在形成首个分类窗口。');
    } else {
      enterStudyingPhase();
    }
    return;
  }
  document.body.dataset.vadState = 'calibrating';
  setChip(UI.voiceState, `准备检测 ${CALIBRATION_SECONDS} 秒`);
  UI.voiceStatus.textContent = '正在自动适应环境声音';
}

function pollMicrophone() {
  const preflight = isPreflightAudioActive();
  if ((!state.active && !preflight) || !state.analyser || state.alertOpen || state.silencePausedAt) return;
  if (state.mode === 'recite' && !state.vad) return;
  try {
  let result;
  try {
    result = state.mode === 'study'
      ? { levelPercent: calculateAudioLevelPercent() }
      : state.vad.process(calculateAudioFeatures());
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

  if (state.calibrating) {
    const remaining = Math.max(0, CALIBRATION_SECONDS * (1 - result.calibrationProgress));
    setChip(UI.voiceState, result.calibrated ? '检测就绪' : `准备检测 ${remaining.toFixed(1)} 秒`);
    UI.voiceStatus.textContent = result.calibrated
      ? (state.mode === 'study' ? '当前安静' : '尚未检测到本人声音')
      : '正在自动适应环境声音';
    if (!result.calibrated) return;
    state.calibrating = false;
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
    if (!state.latestQuietResult && !state.studyAudioClassificationPending) {
      setChip(UI.voiceState, '正在识别环境声音');
      UI.voiceStatus.textContent = '正在识别环境声音';
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
  setFloatingAnomalyDuration(silentForMs);
  const silentFor = Math.floor(silentForMs / 1000);
  if (!result.isSpeech) {
    setChip(UI.voiceState, `本人未出声 ${silentFor} 秒`, silentForMs >= violationLimitMs() ? 'alert' : '');
    UI.voiceStatus.textContent = `本人未出声 ${silentFor} 秒`;
  }
  if (silentForMs >= violationLimitMs()) {
    if (state.speakerVerificationPending) {
      if (preflight) {
        state.preflightThresholdReached = false;
        updatePreflightUi('达到设定时间，正在等待本次声纹确认。');
      }
      return;
    }
    const graceDeadline = state.silentSince + violationLimitMs() + SPEAKER_DEADLINE_GRACE_MS;
    const verificationInFlight = result.isSpeech
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
  } finally {
    if (animationWatchPresentationActive()) showAnimationWatchState();
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
  if (state.mode === 'study' && !state.audioEventReady) {
    await refreshAudioEventState();
    if (!state.audioEventReady) {
      state.startPending = false;
      updateModeUi();
      updateSpeakerProfileUi();
      UI.voiceStatus.textContent = state.audioEventError || '声音分类模型不可用';
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
    setBackgroundControlDisabled(false);
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
  if ((mode === 'hidden' || mode === 'floating') && (state.preflightTesting || state.preflightStarting)) {
    stopPreflightTest({ status: '窗口已转入后台，测试已停止。' }).catch(handleAuxiliaryUiError);
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

async function hideWindowFromChrome(forceMode = null) {
  await stopPreflightTest({ status: '窗口已转入后台，测试已停止。' });
  const requestedMode = state.sessionPhase === 'resting' ? 'hidden' : (forceMode || (
    state.active
      ? state.settings.backgroundMode
      : 'hidden'
  ));
  addLog(requestedMode === 'floating' ? '显示漂浮窗。' : '完全隐藏到后台。');
  await window.desktopAPI.hideToBackground(requestedMode);
}

async function chooseBackgroundModeAndHide(mode) {
  setBackgroundActionExpanded(false);
  try {
    await setBackgroundMode(mode);
  } catch (error) {
    handleAuxiliaryUiError(error);
  }
  await hideWindowFromChrome(mode);
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

    await window.desktopAPI.forceRestoreSceneMode().catch((error) => {
      console.error('异常流程中恢复主窗口失败：', error);
    });
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
    window.desktopAPI.forceRestoreSceneMode().catch(() => {});
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
  setBackgroundActionExpanded(false);
  await hideWindowFromChrome();
});
UI.backgroundAction.addEventListener('pointerenter', () => setBackgroundActionExpanded(true));
UI.backgroundAction.addEventListener('pointerleave', () => setBackgroundActionExpanded(false));
UI.backgroundAction.addEventListener('focusin', () => setBackgroundActionExpanded(true));
UI.backgroundAction.addEventListener('focusout', () => {
  window.requestAnimationFrame(() => {
    if (!UI.backgroundAction.contains(document.activeElement)) setBackgroundActionExpanded(false);
  });
});
UI.backgroundAction.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  event.preventDefault();
  UI.backgroundButton.focus();
  setBackgroundActionExpanded(false);
});
UI.backgroundChoiceHidden.addEventListener('click', () => {
  chooseBackgroundModeAndHide('hidden').catch(handleAuxiliaryUiError);
});
UI.backgroundChoiceFloating.addEventListener('click', () => {
  chooseBackgroundModeAndHide('floating').catch(handleAuxiliaryUiError);
});
UI.backgroundModeHidden.addEventListener('click', () => {
  setBackgroundMode('hidden').catch(handleAuxiliaryUiError);
});
UI.backgroundModeFloating.addEventListener('click', () => {
  setBackgroundMode('floating').catch(handleAuxiliaryUiError);
});
UI.floatingHideButton.addEventListener('click', () => {
  hideWindowFromChrome('hidden').catch(handleAuxiliaryUiError);
});
UI.floatingExpandButton.addEventListener('click', () => {
  window.desktopAPI.restoreSceneMode().catch(handleAuxiliaryUiError);
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
UI.refreshMicrophonesButton.addEventListener('click', () => {
  refreshMicrophones({ requestPermission: true }).catch((error) => {
    UI.microphoneStatus.textContent = `无法刷新麦克风：${error.message}`;
  });
});
UI.microphoneSelect.addEventListener('change', () => {
  if (microphoneSelectionLocked()) return;
  state.settings.microphoneDeviceId = UI.microphoneSelect.value;
  const selected = selectedMicrophone();
  state.settings.microphoneDeviceLabel = selected?.label?.slice(0, 160) || '';
  saveSettings();
  renderMicrophoneUi();
  updatePreflightUi('麦克风已切换，可按当前设置重新测试。');
});
UI.silenceLimit.addEventListener('input', () => {
  const previousSeconds = state.settings.reciteSilenceSeconds;
  state.settings.reciteSilenceSeconds = POLICY.normalizeViolationSeconds('recite', UI.silenceLimit.value);
  UI.silenceLimitValue.textContent = `${state.settings.reciteSilenceSeconds} 秒`;
  if (state.settings.reciteSilenceSeconds !== previousSeconds) resetDetectionAfterSettingChange();
  saveSettings();
});
UI.studyVoiceLimit.addEventListener('input', () => {
  const previousSeconds = state.settings.studyVoiceSeconds;
  state.settings.studyVoiceSeconds = POLICY.normalizeViolationSeconds('study', UI.studyVoiceLimit.value);
  UI.studyVoiceLimitValue.textContent = `${state.settings.studyVoiceSeconds} 秒`;
  state.quietDetector?.setViolationSeconds(state.settings.studyVoiceSeconds);
  if (state.settings.studyVoiceSeconds !== previousSeconds) resetDetectionAfterSettingChange();
  saveSettings();
});
UI.speakerEnrollButton.addEventListener('click', () => openSpeakerEnrollment());
UI.speakerDeleteButton.addEventListener('click', () => deleteSpeakerProfile());
UI.enrollmentMicButton.addEventListener('click', () => runEnrollmentMicrophone());
UI.enrollmentCancelButton.addEventListener('click', () => closeSpeakerEnrollment({ cancel: true }));
UI.previewClipButton.addEventListener('click', previewSelectedClip);
UI.inlineAlertDismiss.addEventListener('click', () => finishPreview());
UI.inlineAlertStop.addEventListener('click', () => stopSession());
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && state.presentation) finishPreview();
  else if (event.key === 'Escape' && state.enrollmentOpen && !state.enrollmentBusy) {
    closeSpeakerEnrollment({ cancel: true });
  }
});
window.desktopAPI.onWindowModeChanged(({ mode, minimized = false, transitionId = 0 }) => {
  applyWindowMode(mode);
  if (Number.isSafeInteger(transitionId) && transitionId > 0) {
    let acknowledged = false;
    const acknowledge = () => {
      if (acknowledged) return;
      acknowledged = true;
      window.desktopAPI.acknowledgeWindowMode({ transitionId, mode });
    };
    const fallback = window.setTimeout(() => {
      void document.body.offsetWidth;
      acknowledge();
    }, 80);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        window.clearTimeout(fallback);
        acknowledge();
      });
    });
  }
  if (minimized && (state.preflightTesting || state.preflightStarting)) {
    stopPreflightTest({ status: '窗口已最小化，测试已停止。' }).catch(handleAuxiliaryUiError);
  }
});
window.desktopAPI.onWindowMaximizedChanged(({ maximized }) => setWindowMaximizedControl(maximized));
window.desktopAPI.onWindowCloseRequested(() => {
  hideWindowFromChrome().catch(handleAuxiliaryUiError);
});
if (navigator.mediaDevices?.addEventListener) {
  navigator.mediaDevices.addEventListener('devicechange', () => {
    if (!microphoneSelectionLocked()) refreshMicrophones().catch(() => {});
  });
}
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
      reciteUsesAutomaticVoiceGate: true,
      reciteAutoVoiceMarginDb: RECITE_AUTO_VOICE_MARGIN_DB,
      backgroundMode: state.settings.backgroundMode,
      floatingTimer: UI.floatingTimer.textContent,
      studyUsesDirectClassification: true,
      quietDetector: state.quietDetector?.snapshot() || null,
      audioEventReady: state.audioEventReady,
      audioEventError: state.audioEventError,
      studyAudioClassificationPending: state.studyAudioClassificationPending,
      latestStudyAudioDecision: state.latestStudyAudioDecision,
      microphoneProcessingWarning: state.microphoneProcessingWarning,
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
    const elapsed = formatTime(Math.floor(effectiveElapsedMs() / 1_000));
    UI.timer.textContent = elapsed;
    UI.floatingTimer.textContent = `已学习 ${elapsed}`;
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
  await loadSettings();
  const backgroundPreference = await window.desktopAPI.getBackgroundPreference().catch(() => null);
  if (backgroundPreference) {
    state.settings.backgroundMode = backgroundPreference.backgroundMode === 'floating'
      ? 'floating'
      : 'hidden';
  }
  await refreshMicrophones().catch(() => {});
  updateModeUi();
  state.scenePlayer = new DisciplineMediaPlayer(UI.sceneCanvas, { statusElement: UI.sceneStatus });
  await loadMediaCatalog();
  await showIdleScene();
  await Promise.all([refreshSpeakerState(), refreshAudioEventState()]);
  const runtime = await window.desktopAPI.getRuntimeWindowState().catch(() => null);
  setWindowMaximizedControl(runtime?.maximized);
  if (runtime?.mode) applyWindowMode(runtime.mode);
  updateModeUi();
  if (state.mode === 'recite' && state.speakerReady && !state.speakerProfileExists) {
    setChip(UI.voiceState, '需要录入本人声纹');
    UI.voiceStatus.textContent = state.speakerProfileError
      ? `${state.speakerProfileError} 请重新录入一次。`
      : '开始学习前先录入本人声音';
  } else if (state.mode === 'study' && !state.audioEventReady) {
    setChip(UI.voiceState, '声音分类不可用', 'alert');
    UI.voiceStatus.textContent = state.audioEventError || '本地声音分类模型不可用';
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
