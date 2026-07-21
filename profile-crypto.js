'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');

const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');

const protectScript = [
  'Add-Type -AssemblyName System.Security',
  '$data=[Convert]::FromBase64String([Console]::In.ReadToEnd().Trim())',
  '$out=[System.Security.Cryptography.ProtectedData]::Protect($data,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser)',
  '[Console]::Out.Write([Convert]::ToBase64String($out))',
].join('; ');

const unprotectScript = [
  'Add-Type -AssemblyName System.Security',
  '$data=[Convert]::FromBase64String([Console]::In.ReadToEnd().Trim())',
  '$out=[System.Security.Cryptography.ProtectedData]::Unprotect($data,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser)',
  '[Console]::Out.Write([Convert]::ToBase64String($out))',
].join('; ');

function runDpapi(script, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(powershell, ['-NoProfile', '-NonInteractive', '-Command', script], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.once('error', reject);
    child.once('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Windows 本地加密失败（退出码 ${code}）：${Buffer.concat(stderr).toString('utf8').trim()}`));
        return;
      }
      resolve(Buffer.from(Buffer.concat(stdout).toString('utf8').trim(), 'base64'));
    });
    child.stdin.end(Buffer.from(input).toString('base64'));
  });
}

function createProfileCrypto() {
  return Object.freeze({
    async isAvailable() {
      return true;
    },
    async encryptString(value) {
      return runDpapi(protectScript, Buffer.from(String(value), 'utf8'));
    },
    async decryptString(value) {
      return (await runDpapi(unprotectScript, Buffer.from(value))).toString('utf8');
    },
  });
}

module.exports = { createProfileCrypto };
