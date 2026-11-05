#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveSigningIdentity, signExecutable } from './glossa-macos-signing.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(
  root,
  '.glossa-dev',
  'qa',
  `stable-signing-${new Date().toISOString().replaceAll(/[:.]/g, '-')}`,
);
const service = `app.glossa.signing-acceptance.${randomUUID()}`;
const identifier = 'app.glossa.signing-acceptance';
const identity = resolveSigningIdentity();
mkdirSync(output, { recursive: true });
const run = (program, args) => {
  const result = spawnSync(program, args, { encoding: 'utf8', timeout: 60_000 });
  if (result.status !== 0)
    throw new Error(
      `${program} failed (${result.status}): ${result.stderr || result.error?.message || ''}`,
    );
  return result.stdout;
};
const revisionOne = join(output, 'revision-one');
const revisionTwo = join(output, 'revision-two');
const installed = join(output, 'installed');
const wrongIdentifier = join(output, 'wrong-identifier');
const adhoc = join(output, 'adhoc');
const report = {
  service,
  identity: { name: identity.name, fingerprint: identity.fingerprint },
  checks: [],
};
const check = (
  name,
  operation,
  expectedStatus,
  executable = installed,
  fixtureService = service,
) => {
  const result = JSON.parse(run(executable, [operation, fixtureService]));
  report.checks.push({ name, ...result });
  assert.equal(result.status, expectedStatus, name);
  if (operation === 'read' && expectedStatus === 0) assert.equal(result.valueMatches, true, name);
  return result;
};
let created = false;
try {
  const source = join(root, 'scripts', 'native', 'glossa-signing-acceptance.swift');
  run('/usr/bin/xcrun', ['swiftc', source, '-o', revisionOne]);
  run('/usr/bin/xcrun', ['swiftc', '-D', 'REVISION_TWO', source, '-o', revisionTwo]);
  const signingOne = signExecutable(revisionOne, identifier, identity);
  const signingTwo = signExecutable(revisionTwo, identifier, identity);
  assert.equal(signingOne.designatedRequirement, signingTwo.designatedRequirement);
  const hashes = [revisionOne, revisionTwo].map((path) =>
    createHash('sha256').update(readFileSync(path)).digest('hex'),
  );
  assert.notEqual(hashes[0], hashes[1]);
  report.binaryHashes = hashes;
  report.designatedRequirement = signingOne.designatedRequirement;
  copyFileSync(revisionOne, installed);
  check('missing metadata stays missing without UI', 'status', -25300);
  check('first signed build creates dummy', 'create', 0);
  created = true;
  check('first signed build reads dummy', 'read', 0);
  copyFileSync(revisionTwo, `${installed}.next`);
  renameSync(`${installed}.next`, installed);
  assert.equal(check('replacement build reads existing dummy without UI', 'read', 0).revision, 2);
  check('replacement metadata query does not read secret', 'status', 0);
  check('separate process path with same identity still works', 'read', 0, revisionTwo);
  copyFileSync(revisionTwo, wrongIdentifier);
  signExecutable(wrongIdentifier, `${identifier}.other`, identity);
  const wrong = JSON.parse(run(wrongIdentifier, ['read', service]));
  assert.notEqual(wrong.status, 0, 'same certificate does not authorize a different application');
  assert.notEqual(wrong.status, -25300, 'denied access must not be reported as a missing key');
  report.checks.push({ name: 'different application denied without UI', ...wrong });
  copyFileSync(revisionTwo, adhoc);
  run('/usr/bin/codesign', ['--force', '--sign', '-', '--identifier', identifier, adhoc]);
  const unsigned = JSON.parse(run(adhoc, ['read', service]));
  assert.notEqual(unsigned.status, 0, 'ad-hoc replacement cannot inherit trust');
  assert.notEqual(unsigned.status, -25300, 'denied access must not be reported as a missing key');
  report.checks.push({ name: 'ad-hoc replacement denied without UI', ...unsigned });
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.error = error.message;
  process.exitCode = 1;
} finally {
  if (created) {
    try {
      check('dummy cleanup', 'delete', 0, revisionTwo);
      check('dummy absent after cleanup', 'status', -25300, revisionTwo);
    } catch (error) {
      report.cleanupError = error.message;
      report.passed = false;
      process.exitCode = 1;
    }
  }
  writeFileSync(join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\nEvidence: ${output}\n`);
}
