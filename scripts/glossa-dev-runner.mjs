#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  provisionCredentialHelper,
  resolveSigningIdentity,
  signExecutable,
  verifySignedCode,
} from './glossa-macos-signing.mjs';

// Cargo's target runner runs after compilation and before the app starts. Do not
// use Tauri's --runner here: that replaces Cargo itself, not the built binary.
try {
  const [binary, ...arguments_] = process.argv.slice(2);
  if (process.platform !== 'darwin' || !binary || process.env.DBUS_ID !== 'app.glossa.reader.dev') {
    throw new Error('This runner is only for the isolated macOS Glossa Dev executable.');
  }
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const target = realpathSync(resolve(root, '.glossa-dev/target'));
  const executable = realpathSync(binary);
  const location = relative(target, executable);
  if (location.startsWith('..') || isAbsolute(location))
    throw new Error('Refusing to sign a binary outside the isolated Dev target.');
  const identity = resolveSigningIdentity();
  if (process.env.GLOSSA_SIGNING_FINGERPRINT !== identity.fingerprint)
    throw new Error('The Dev compile-time signing pin and active identity do not match.');
  const helper = provisionCredentialHelper(identity);
  if (process.env.GLOSSA_CREDENTIAL_HELPER_CDHASH !== helper.cdhash)
    throw new Error('The Dev helper pin changed; restart the Dev command to rebuild.');
  try {
    verifySignedCode(executable, 'app.glossa.reader.dev', identity);
  } catch {
    signExecutable(executable, 'app.glossa.reader.dev', identity);
  }
  if (typeof process.execve !== 'function')
    throw new Error('Node 24 execve is required to preserve the Cargo process lifecycle.');
  process.execve(executable, [executable, ...arguments_], process.env);
} catch (error) {
  process.stderr.write(`Glossa Dev signing: ${error.message}\n`);
  process.exitCode = 1;
}
