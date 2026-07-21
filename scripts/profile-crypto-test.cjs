'use strict';

const assert = require('node:assert/strict');
const { createProfileCrypto } = require('../profile-crypto');

async function main() {
  const plaintext = 'speaker-profile-dpapi-cross-process-test';
  const writer = createProfileCrypto();

  assert.equal(await writer.isAvailable(), true, 'Windows DPAPI must be available');
  const ciphertext = await writer.encryptString(plaintext);
  assert.ok(Buffer.isBuffer(ciphertext), 'encrypted profile data must be a Buffer');
  assert.notEqual(ciphertext.toString('utf8'), plaintext, 'plaintext must not be stored directly');

  // Each operation invokes a fresh hidden PowerShell child, so this also verifies
  // current-user DPAPI remains readable across independent processes.
  const reader = createProfileCrypto();
  assert.equal(await reader.decryptString(ciphertext), plaintext);

  console.log('DPAPI profile crypto cross-process test passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
