const fs = require('node:fs');
const path = require('node:path');

const [target, parentPidText] = process.argv.slice(2);
const parentPid = Number(parentPidText);
const deadline = Date.now() + 30_000;

function parentIsRunning() {
  if (!Number.isInteger(parentPid) || parentPid <= 0) return false;
  try {
    process.kill(parentPid, 0);
    return true;
  } catch {
    return false;
  }
}

function removeTransientData() {
  try {
    fs.rmSync(target, { recursive: true, force: true });
    fs.rmdirSync(path.dirname(target));
  } catch (error) {
    if (error?.code !== 'ENOTEMPTY' && error?.code !== 'ENOENT') process.exitCode = 1;
  }
}

function waitForParentExit() {
  if (!parentIsRunning() || Date.now() >= deadline) {
    removeTransientData();
    return;
  }
  setTimeout(waitForParentExit, 100);
}

if (!target || !path.isAbsolute(target)) {
  process.exitCode = 1;
} else {
  waitForParentExit();
}
