(function initializeBreakPrompt() {
  'use strict';

  const UI = {
    creditCount: document.querySelector('#credit-count'),
    earnedView: document.querySelector('#earned-view'),
    restingView: document.querySelector('#resting-view'),
    countdown: document.querySelector('#rest-countdown'),
    startButton: document.querySelector('#start-rest'),
    bankButton: document.querySelector('#bank-rest'),
  };

  let currentState = { kind: 'earned', credits: 0, remainingSeconds: 0 };
  let actionSent = false;
  let earnedSignature = '';

  function validState(payload) {
    return payload
      && (payload.kind === 'earned' || payload.kind === 'resting')
      && Number.isSafeInteger(payload.credits)
      && payload.credits >= 0
      && Number.isSafeInteger(payload.remainingSeconds)
      && payload.remainingSeconds >= 0;
  }

  function formatCountdown(totalSeconds) {
    const seconds = Math.max(0, Math.floor(totalSeconds));
    const minutes = Math.floor(seconds / 60).toString().padStart(2, '0');
    const remainder = (seconds % 60).toString().padStart(2, '0');
    return `${minutes}:${remainder}`;
  }

  function render(payload) {
    if (!validState(payload)) return;
    currentState = {
      kind: payload.kind,
      credits: payload.credits,
      remainingSeconds: payload.remainingSeconds,
    };
    const nextSignature = `${currentState.kind}:${currentState.credits}`;
    if (currentState.kind === 'earned' || nextSignature !== earnedSignature) {
      earnedSignature = nextSignature;
      actionSent = false;
    }

    document.body.dataset.kind = currentState.kind;
    UI.creditCount.textContent = `休息券 × ${currentState.credits}`;
    UI.earnedView.hidden = currentState.kind !== 'earned';
    UI.restingView.hidden = currentState.kind !== 'resting';
    UI.countdown.value = formatCountdown(currentState.remainingSeconds);
    UI.countdown.textContent = UI.countdown.value;
    UI.startButton.disabled = actionSent || currentState.credits < 1;
    UI.bankButton.disabled = actionSent;
  }

  function sendAction(action) {
    if (actionSent || currentState.kind !== 'earned') return;
    if (action !== 'start' && action !== 'bank') return;
    actionSent = true;
    UI.startButton.disabled = true;
    UI.bankButton.disabled = true;
    window.breakPrompt.sendAction(action);
  }

  UI.startButton.addEventListener('click', () => sendAction('start'));
  UI.bankButton.addEventListener('click', () => sendAction('bank'));
  window.breakPrompt.onStateChanged(render);
  render(currentState);
}());
