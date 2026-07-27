const fs = require('node:fs');
const path = require('node:path');

const [target, parentPidText] = process.argv.slice(2);
const parentPid = Number(parentPidText);
const deadline = Date.now() + 30_000;

function isValidCleanupTarget(candidate, pid) {
  if (!candidate || !path.isAbsolute(candidate)) return false;
  if (!Number.isInteger(pid) || pid <= 0) return false;
  const resolved = path.resolve(candidate);
  const parent = path.dirname(resolved);
  return path.basename(resolved) === `run-${pid}`
    && path.basename(parent) === 'TransientElectronData'
    && path.dirname(parent) !== parent;
}

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
    const stats = fs.lstatSync(target);
    if (stats.isSymbolicLink()) {
      fs.unlinkSync(target);
    } else if (stats.isDirectory()) {
      fs.rmSync(target, { recursive: true, force: true });
    } else {
      fs.unlinkSync(target);
    }
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

if (require.main === module) {
  if (!isValidCleanupTarget(target, parentPid)) {
    process.exitCode = 1;
  } else {
    waitForParentExit();
  }
}

module.exports = { isValidCleanupTarget };
