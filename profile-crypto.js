'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');

const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const DPAPI_TIMEOUT_MS = 10_000;
const DPAPI_MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

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
    let outputBytes = 0;
    let settled = false;
    const settle = (handler, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      handler(value);
    };
    const timeout = setTimeout(() => {
      child.kill();
      settle(reject, new Error('Windows 本地加密处理超时。'));
    }, DPAPI_TIMEOUT_MS);
    const captureOutput = (target, chunk) => {
      if (settled) return;
      outputBytes += chunk.length;
      if (outputBytes > DPAPI_MAX_OUTPUT_BYTES) {
        child.kill();
        settle(reject, new Error('Windows 本地加密返回的数据异常过大。'));
        return;
      }
      target.push(chunk);
    };
    child.stdout.on('data', (chunk) => captureOutput(stdout, chunk));
    child.stderr.on('data', (chunk) => captureOutput(stderr, chunk));
    child.once('error', (error) => settle(reject, error));
    child.once('close', (code) => {
      if (code !== 0) {
        settle(reject, new Error(`Windows 本地加密失败（退出码 ${code}）：${Buffer.concat(stderr).toString('utf8').trim()}`));
        return;
      }
      settle(resolve, Buffer.from(Buffer.concat(stdout).toString('utf8').trim(), 'base64'));
    });
    child.stdin.once('error', (error) => settle(reject, error));
    try {
      child.stdin.end(Buffer.from(input).toString('base64'));
    } catch (error) {
      settle(reject, error);
    }
  });
}

function createProfileCrypto() {
  return Object.freeze({
    async isAvailable() {
      try {
        const probe = Buffer.from('red-watch-dpapi-probe', 'utf8');
        const encrypted = await runDpapi(protectScript, probe);
        const decrypted = await runDpapi(unprotectScript, encrypted);
        return decrypted.equals(probe);
      } catch {
        return false;
      }
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
