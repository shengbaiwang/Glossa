#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  provisionCredentialHelper,
  resolveSigningIdentity,
  verifySignedCode,
} from './glossa-macos-signing.mjs';

// Exercise Cargo's real runner with a tiny native fixture; do not restart the
// user's running Dev app or reuse its Cargo output directory.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, '.glossa-dev/qa', `dev-signing-${Date.now()}`);
mkdirSync(join(output, 'src'), { recursive: true });
const target = join(root, '.glossa-dev/target/signing-runner-fixture');
const identity = resolveSigningIdentity();
const helper = provisionCredentialHelper(identity);
const node24 = '/opt/homebrew/opt/node@24/bin/node';
writeFileSync(
  join(output, 'Cargo.toml'),
  '[package]\nname = "glossa-dev-signing-fixture"\nversion = "0.0.0"\nedition = "2021"\n[workspace]\n',
);
writeFileSync(
  join(output, 'src/main.rs'),
  'fn main() { println!("{}|{}", env!("GLOSSA_SIGNING_FINGERPRINT"), std::env::args().nth(1).unwrap()); }\n',
);
const runner = JSON.stringify([node24, join(root, 'scripts/glossa-dev-runner.mjs')]);
writeFileSync(
  join(output, 'runner.toml'),
  `[target.aarch64-apple-darwin]\nrunner = ${runner}\n[target.x86_64-apple-darwin]\nrunner = ${runner}\n`,
);
const result = spawnSync(
  'cargo',
  [
    '--config',
    join(output, 'runner.toml'),
    'run',
    '--manifest-path',
    join(output, 'Cargo.toml'),
    '--',
    'argument with spaces',
  ],
  {
    cwd: root,
    encoding: 'utf8',
    timeout: 60_000,
    env: {
      ...process.env,
      CARGO_TARGET_DIR: target,
      DBUS_ID: 'app.glossa.reader.dev',
      PATH: [
        '/opt/homebrew/opt/rustup/bin',
        `${process.env.HOME}/.cargo/bin`,
        process.env.PATH,
      ].join(':'),
      GLOSSA_SIGNING_FINGERPRINT: identity.fingerprint,
      GLOSSA_CREDENTIAL_HELPER_CDHASH: helper.cdhash,
      GLOSSA_MACOS_SIGNING_IDENTITY: identity.fingerprint,
      ...(identity.keychain ? { GLOSSA_MACOS_SIGNING_KEYCHAIN: identity.keychain } : {}),
    },
  },
);
assert.equal(result.status, 0, result.stderr || result.error?.message);
assert.equal(result.stdout.trim(), `${identity.fingerprint}|argument with spaces`);
const verified = verifySignedCode(
  join(target, 'debug/glossa-dev-signing-fixture'),
  'app.glossa.reader.dev',
  identity,
);
const report = {
  passed: true,
  argumentPreserved: true,
  compileTimePinMatched: true,
  designatedRequirement: verified.designatedRequirement,
  hardenedRuntime: true,
};
writeFileSync(join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`Glossa Dev Cargo runner verified: ${output}\n`);
