'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');
const packagePath = path.join(projectRoot, 'package.json');
const packageConfig = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const candidateRoot = path.join(
  projectRoot,
  'work',
  `release-candidate-${packageConfig.version}`,
);
const builderCli = path.join(projectRoot, 'node_modules', 'electron-builder', 'cli.js');
const staticTest = path.join(projectRoot, 'scripts', 'release-package-static-test.cjs');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = options.capture
      ? `${result.stdout || ''}${result.stderr || ''}`.trim()
      : '';
    throw new Error(`Release command failed (${result.status}).${detail ? `\n${detail}` : ''}`);
  }
  return options.capture ? String(result.stdout || '') : '';
}

function assertFreshCandidate() {
  const workRoot = path.join(projectRoot, 'work');
  const relative = path.relative(workRoot, candidateRoot);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Release output must stay inside the project work directory.');
  }
  if (fs.existsSync(candidateRoot)) {
    throw new Error(`Release candidate already exists and will not be overwritten: ${candidateRoot}`);
  }
  for (const protectedName of ['dist', 'release-staging']) {
    if (path.resolve(candidateRoot) === path.resolve(projectRoot, protectedName)) {
      throw new Error(`Refusing to use protected output directory: ${protectedName}`);
    }
  }
}

function trackedInputHash() {
  const names = run('git', ['ls-files', '-z'], { capture: true })
    .split('\0')
    .filter(Boolean)
    .sort();
  const hash = crypto.createHash('sha256');
  for (const name of names) {
    const absolute = path.join(projectRoot, name);
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) continue;
    hash.update(name.replaceAll('\\', '/'));
    hash.update('\0');
    hash.update(fs.readFileSync(absolute));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function assertCleanWorktree() {
  const status = run(
    'git',
    ['status', '--porcelain=v1', '--untracked-files=all'],
    { capture: true },
  ).trim();
  if (status) {
    throw new Error('Release builds require a clean Git worktree. Commit or remove the listed changes first.');
  }
}

function sha256(filename) {
  return crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
}

function buildTarget(target, extraConfig = []) {
  run(process.execPath, [
    builderCli,
    '--win',
    target,
    `--config.directories.output=${candidateRoot}`,
    ...extraConfig,
  ]);
}

function main() {
  if (packageConfig.name !== 'red-watch-recite') {
    throw new Error('This release wrapper only accepts the 凛冬督学局 project.');
  }
  assertFreshCandidate();
  assertCleanWorktree();
  const inputHash = trackedInputHash();

  buildTarget('nsis');
  const archivePath = path.join(candidateRoot, 'win-unpacked', 'resources', 'app.asar');
  if (!fs.existsSync(archivePath)) throw new Error('Installer build did not produce app.asar.');
  const installerArchiveHash = sha256(archivePath);

  buildTarget('portable', [
    '--config.win.artifactName=凛冬督学局-便携版-${version}.${ext}',
  ]);
  if (!fs.existsSync(archivePath)) throw new Error('Portable build did not produce app.asar.');
  const portableArchiveHash = sha256(archivePath);
  if (portableArchiveHash !== installerArchiveHash) {
    throw new Error('Installer and portable builds embedded different app.asar inputs.');
  }

  if (trackedInputHash() !== inputHash) {
    throw new Error('Tracked source changed while the release was being built.');
  }
  run(process.execPath, [staticTest, candidateRoot]);
  process.stdout.write(`${candidateRoot}\n`);
}

if (require.main === module) main();

module.exports = {
  assertFreshCandidate,
  candidateRoot,
  trackedInputHash,
};
