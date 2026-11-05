#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  credentialHelperPath,
  provisionCredentialHelper,
  resolveSigningIdentity,
  signExecutable,
} from './glossa-macos-signing.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(
  root,
  '.glossa-dev',
  'qa',
  `credential-helper-${new Date().toISOString().replaceAll(/[:.]/g, '-')}`,
);
mkdirSync(output, { recursive: true });
const identity = resolveSigningIdentity();
const helper = provisionCredentialHelper(identity);
const account = `glossa-signing-acceptance.${randomUUID()}`;
const productionValue = Buffer.from([1, ...Buffer.from('synthetic-previous-only')]).toString(
  'base64',
);
const developmentValue = Buffer.from([1, ...Buffer.from('synthetic-development-only')]).toString(
  'base64',
);
const production = join(output, 'production-caller');
const revisionTwo = join(output, 'production-revision-two');
const development = join(output, 'development-caller');
const denied = join(output, 'wrong-identifier');
const adhoc = join(output, 'adhoc-caller');
const previousOwner = join(output, 'previous-owner');
const report = { account, helperSHA256: helper.executableSHA256, checks: [] };
const run = (program, args, input) => {
  const result = spawnSync(program, args, { encoding: 'utf8', timeout: 60_000, input });
  if (result.status !== 0)
    throw new Error(
      `${program.split('/').at(-1)} failed (${result.status}): ${result.stderr || result.error?.message || ''}`,
    );
  return result.stdout;
};
const call = (caller, request) =>
  JSON.parse(
    run(
      caller,
      [credentialHelperPath],
      JSON.stringify({ account, noninteractive: true, ...request }),
    ),
  );
const check = (name, caller, request, expectedStatus, expectedValue) => {
  const response = call(caller, request);
  // Store only success/status/error, never credential bytes, even dummy bytes.
  const { dataBase64, ...safeResponse } = response;
  report.checks.push({
    name,
    ...safeResponse,
    ...(expectedValue ? { valueMatches: dataBase64 === expectedValue } : {}),
  });
  assert.equal(response.status, expectedStatus, name);
  if (expectedValue) assert.equal(dataBase64, expectedValue, name);
  else assert.equal(dataBase64, undefined, name);
  return response;
};
let compiled = false;
let previousCompiled = false;
try {
  const source = readFileSync(
    join(root, 'scripts/native/glossa-credential-helper-caller.swift'),
    'utf8',
  );
  const rendered = join(output, 'caller.swift');
  writeFileSync(rendered, source.replace('__GLOSSA_SIGNING_CERT_SHA1__', identity.fingerprint));
  run('/usr/bin/xcrun', ['swiftc', rendered, '-o', production]);
  run('/usr/bin/xcrun', ['swiftc', '-D', 'REVISION_TWO', rendered, '-o', revisionTwo]);
  signExecutable(production, 'app.glossa.reader', identity);
  signExecutable(revisionTwo, 'app.glossa.reader', identity);
  copyFileSync(revisionTwo, development);
  signExecutable(development, 'app.glossa.reader.dev', identity);
  compiled = true;
  run('/usr/bin/xcrun', [
    'swiftc',
    join(root, 'scripts/native/glossa-previous-credential-fixture.swift'),
    '-o',
    previousOwner,
  ]);
  signExecutable(previousOwner, 'app.glossa.reader', identity);
  previousCompiled = true;
  assert.equal(JSON.parse(run(previousOwner, ['create', 'production', account])).status, 'present');
  check(
    'old app item metadata can be inspected without reading it',
    production,
    { operation: 'status', previous: true },
    'present',
  );
  check(
    'old app item is not silently granted to the helper',
    production,
    { operation: 'get', previous: true },
    'unavailable',
  );
  check(
    'Dev cannot inspect the old production item',
    development,
    { operation: 'status', previous: true },
    'missing',
  );
  const ownedRecord = JSON.parse(run(previousOwner, ['get', 'production', account]));
  assert.equal(ownedRecord.status, 'present');
  assert.equal(ownedRecord.dataBase64, productionValue);
  report.migrationAuthorization =
    'Existing owner read the synthetic record and supplied it to v2; the one-time user authorization dialog was not automated.';
  check('metadata absent without UI', production, { operation: 'status' }, 'missing');
  check(
    'first build stores the owner-supplied synthetic record in v2',
    production,
    { operation: 'set', valueBase64: ownedRecord.dataBase64 },
    'present',
  );
  check(
    'first build reads synthetic record',
    production,
    { operation: 'get' },
    'present',
    productionValue,
  );
  const firstHash = createHash('sha256').update(readFileSync(production)).digest('hex');
  copyFileSync(revisionTwo, `${production}.next`);
  renameSync(`${production}.next`, production);
  const secondHash = createHash('sha256').update(readFileSync(production)).digest('hex');
  assert.notEqual(firstHash, secondHash);
  report.callerHashes = [firstHash, secondHash];
  assert.equal(
    check(
      'changed replacement build reads without UI',
      production,
      { operation: 'get' },
      'present',
      productionValue,
    ).callerRevision,
    2,
  );
  check('metadata present without reading data', production, { operation: 'status' }, 'present');
  check('Dev cannot see production record', development, { operation: 'status' }, 'missing');
  check(
    'Dev cannot read the production legacy service',
    development,
    { operation: 'get', legacy: true },
    'unavailable',
  );
  check(
    'Dev cannot query the production legacy service',
    development,
    { operation: 'status', legacy: true },
    'unavailable',
  );
  check(
    'Dev stores separate record',
    development,
    { operation: 'set', valueBase64: developmentValue },
    'present',
  );
  check('Dev reads own record', development, { operation: 'get' }, 'present', developmentValue);
  check(
    'production record unchanged',
    production,
    { operation: 'get' },
    'present',
    productionValue,
  );
  check('clear writes tombstone', production, { operation: 'set', valueBase64: 'AA==' }, 'present');
  assert.equal(
    check('cleared metadata is missing', production, { operation: 'status' }, 'missing').cleared,
    true,
  );
  check(
    'tombstone remains readable for migration guard',
    production,
    { operation: 'get' },
    'present',
    'AA==',
  );
  check(
    'restore synthetic record',
    production,
    { operation: 'set', valueBase64: productionValue },
    'present',
  );
  check(
    'caller cannot specify another service',
    production,
    { operation: 'get', service: 'Readest Safe Storage' },
    'unavailable',
  );
  check(
    'legacy service is read only',
    production,
    { operation: 'set', valueBase64: productionValue, legacy: true },
    'unavailable',
  );
  check(
    'previous service is read only',
    production,
    { operation: 'set', valueBase64: productionValue, previous: true },
    'unavailable',
  );
  check(
    'previous and legacy cannot be combined',
    production,
    { operation: 'get', previous: true, legacy: true },
    'unavailable',
  );
  check(
    'oversized payload rejected',
    production,
    { operation: 'set', valueBase64: 'A'.repeat(70_000) },
    'unavailable',
  );
  copyFileSync(revisionTwo, denied);
  signExecutable(denied, 'app.glossa.reader.other', identity);
  check(
    'different app with same certificate is denied',
    denied,
    { operation: 'get' },
    'unavailable',
  );
  const nonhardened = join(output, 'nonhardened-caller');
  copyFileSync(revisionTwo, nonhardened);
  run('/usr/bin/codesign', [
    '--force',
    '--sign',
    identity.fingerprint,
    ...(identity.keychain ? ['--keychain', identity.keychain] : []),
    '--identifier',
    'app.glossa.reader',
    '--options',
    '0',
    '--timestamp=none',
    nonhardened,
  ]);
  check(
    'previously signed caller without Hardened Runtime is denied',
    nonhardened,
    { operation: 'get' },
    'unavailable',
  );
  const injected = join(output, 'injection-enabled-caller');
  const injectedEntitlements = join(output, 'unsafe-entitlements.plist');
  writeFileSync(
    injectedEntitlements,
    '<?xml version="1.0"?><plist version="1.0"><dict><key>com.apple.security.cs.allow-dyld-environment-variables</key><true/></dict></plist>',
  );
  copyFileSync(revisionTwo, injected);
  run('/usr/bin/codesign', [
    '--force',
    '--sign',
    identity.fingerprint,
    ...(identity.keychain ? ['--keychain', identity.keychain] : []),
    '--identifier',
    'app.glossa.reader',
    '--options',
    'runtime',
    '--timestamp=none',
    '--entitlements',
    injectedEntitlements,
    injected,
  ]);
  check(
    'caller with injection entitlement is denied',
    injected,
    { operation: 'get' },
    'unavailable',
  );
  copyFileSync(revisionTwo, adhoc);
  run('/usr/bin/codesign', ['--force', '--sign', '-', '--identifier', 'app.glossa.reader', adhoc]);
  check(
    'ad-hoc app with matching identifier is denied',
    adhoc,
    { operation: 'get' },
    'unavailable',
  );
  const reused = provisionCredentialHelper(identity);
  assert.equal(reused.executableSHA256, helper.executableSHA256);
  assert.equal(reused.reused, true);
  report.helperReusedWithoutRebuild = true;
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.error = error.message;
  process.exitCode = 1;
} finally {
  if (previousCompiled) {
    try {
      assert.ok(
        ['present', 'missing'].includes(
          JSON.parse(run(previousOwner, ['delete', 'production', account])).status,
        ),
      );
      assert.equal(
        JSON.parse(run(previousOwner, ['get', 'production', account])).status,
        'missing',
      );
      report.previousFixtureCleaned = true;
    } catch (error) {
      report.cleanupError = error.message;
      report.passed = false;
      process.exitCode = 1;
    }
  }
  if (compiled) {
    for (const caller of [production, development]) {
      try {
        const result = call(caller, { operation: 'deleteFixture' });
        assert.ok(result.status === 'present' || result.status === 'missing');
        check(`cleanup ${caller.split('/').at(-1)}`, caller, { operation: 'status' }, 'missing');
      } catch (error) {
        report.cleanupError = error.message;
        report.passed = false;
        process.exitCode = 1;
      }
    }
  }
  // Retain evidence and source, but no executable signing authority in QA.
  for (const path of [
    production,
    revisionTwo,
    development,
    denied,
    adhoc,
    previousOwner,
    join(output, 'nonhardened-caller'),
    join(output, 'injection-enabled-caller'),
  ]) {
    if (existsSync(path)) {
      const removed = spawnSync('/usr/bin/codesign', ['--remove-signature', path], {
        encoding: 'utf8',
      });
      if (removed.status !== 0) {
        report.signatureCleanupFailed = true;
        report.passed = false;
        process.exitCode = 1;
      }
    }
  }
  report.fixtureSignaturesRemoved = !report.signatureCleanupFailed;
  writeFileSync(join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\nEvidence: ${output}\n`);
}
