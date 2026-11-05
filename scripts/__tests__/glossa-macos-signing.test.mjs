import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  chooseIdentity,
  parseIdentities,
  validateIdentity,
  verificationRequirement,
} from '../glossa-macos-signing.mjs';

const fingerprint = '1234567890ABCDEF1234567890ABCDEF12345678';

test('refuses ad-hoc, missing and ambiguous identities instead of weakening signing', () => {
  for (const identity of ['', '-', '\n-\n', 'name\nother'])
    assert.throws(() => validateIdentity(identity));
  assert.throws(() => chooseIdentity('missing', []));
  assert.throws(() =>
    chooseIdentity('Glossa', [
      { name: 'Glossa', fingerprint },
      { name: 'Glossa', fingerprint: 'A'.repeat(40) },
    ]),
  );
});

test('uses exact fingerprint or exact name, including locally self-signed identities', () => {
  const identities = parseIdentities(
    `  1) ${fingerprint} "Glossa Local Code Signing" (CSSMERR_TP_NOT_TRUSTED)\n  1) ${fingerprint} "Glossa Local Code Signing"\n`,
  );
  assert.equal(identities.length, 1);
  assert.equal(chooseIdentity(fingerprint.toLowerCase(), identities).fingerprint, fingerprint);
  assert.throws(() => chooseIdentity('Glossa', identities));
});

test('verification binds both certificate and exact application identity', () => {
  assert.equal(
    verificationRequirement('app.glossa.reader', fingerprint),
    `identifier "app.glossa.reader" and certificate leaf = H"${fingerprint}"`,
  );
  assert.notEqual(
    verificationRequirement('app.glossa.reader.dev', fingerprint),
    verificationRequirement('app.glossa.reader', fingerprint),
  );
  assert.throws(() => verificationRequirement('app" or true', fingerprint));
  assert.throws(() => verificationRequirement('app.glossa.reader', '-'));
});
