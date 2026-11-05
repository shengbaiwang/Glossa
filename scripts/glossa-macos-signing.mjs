#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createHash, randomBytes, X509Certificate } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const localSigningDirectory = join(
  homedir(),
  'Library',
  'Application Support',
  'Glossa Signing',
);
export const localSigningProfile = join(localSigningDirectory, 'identity.json');
export const credentialHelperPath = join(localSigningDirectory, 'credential-helper');
export const credentialHelperIdentifier = 'app.glossa.credential-helper';

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.status !== 0) {
    throw new Error(
      `${command.split('/').at(-1)} failed (${result.status ?? 'unavailable'}): ${(result.stderr || result.error?.message || '').trim()}`,
    );
  }
  return `${result.stdout ?? ''}${result.stderr ?? ''}`;
};

export function validateIdentity(value) {
  const identity = String(value ?? '').trim();
  if (!identity || identity === '-' || /[\r\n\0]/u.test(identity)) {
    throw new Error(
      'A persistent code-signing certificate is required; ad-hoc signing is not allowed.',
    );
  }
  return identity;
}

export function parseIdentities(output) {
  const identities = new Map();
  for (const match of output.matchAll(/^\s*\d+\)\s+([A-Fa-f0-9]{40})\s+"([^"]+)"/gm)) {
    identities.set(match[1].toUpperCase(), { fingerprint: match[1].toUpperCase(), name: match[2] });
  }
  return [...identities.values()];
}

export function chooseIdentity(requested, identities) {
  const identity = validateIdentity(requested);
  const matches = identities.filter(
    (item) => item.fingerprint === identity.toUpperCase() || item.name === identity,
  );
  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one installed code-signing identity for ${identity}; found ${matches.length}. No ad-hoc fallback is permitted.`,
    );
  }
  return matches[0];
}

export function resolveSigningIdentity(environment = process.env) {
  let requested = environment.GLOSSA_MACOS_SIGNING_IDENTITY || environment.APPLE_SIGNING_IDENTITY;
  let keychain = environment.GLOSSA_MACOS_SIGNING_KEYCHAIN;
  let local = false;
  if (!requested) {
    if (!existsSync(localSigningProfile)) {
      throw new Error(
        'No stable signing identity is configured. Run `node scripts/glossa-macos-signing.mjs provision` once, or set GLOSSA_MACOS_SIGNING_IDENTITY to your Developer ID certificate.',
      );
    }
    const profile = JSON.parse(readFileSync(localSigningProfile, 'utf8'));
    if (
      profile.version !== 1 ||
      !/^[A-F0-9]{40}$/u.test(profile.fingerprint) ||
      !profile.keychain
    ) {
      throw new Error('The local signing profile is invalid; refusing to replace its identity.');
    }
    requested = profile.fingerprint;
    keychain = profile.keychain;
    local = true;
  }
  validateIdentity(requested);
  const identities = parseIdentities(
    run('/usr/bin/security', [
      'find-identity',
      '-p',
      'codesigning',
      ...(keychain ? [keychain] : []),
    ]),
  );
  const selected = chooseIdentity(requested, identities);
  if (!local && existsSync(localSigningProfile)) {
    const profile = JSON.parse(readFileSync(localSigningProfile, 'utf8'));
    local = selected.fingerprint === profile.fingerprint;
    if (local && !keychain) keychain = profile.keychain;
  }
  return { ...selected, keychain, local };
}

export function verificationRequirement(identifier, fingerprint) {
  if (!/^[A-Za-z0-9.-]+$/u.test(identifier) || !/^[A-Fa-f0-9]{40}$/u.test(fingerprint)) {
    throw new Error('Invalid code-signing identifier or certificate fingerprint.');
  }
  return `identifier "${identifier}" and certificate leaf = H"${fingerprint}"`;
}

export function verifySignedCode(path, identifier, identity) {
  run('/usr/bin/codesign', [
    '--verify',
    '--deep',
    '--strict',
    '-R',
    `=${verificationRequirement(identifier, identity.fingerprint)}`,
    path,
  ]);
  const details = run('/usr/bin/codesign', ['-dvvv', '-r-', path]);
  const designatedRequirement = details
    .split('\n')
    .find((line) => line.startsWith('designated => '));
  if (
    !designatedRequirement ||
    /\bcdhash\b/u.test(designatedRequirement) ||
    details.includes('Signature=adhoc')
  ) {
    throw new Error('The final code identity is not stable across builds.');
  }
  if (!/flags=0x[0-9a-f]+\([^)]*\bruntime\b/iu.test(details)) {
    throw new Error('Hardened Runtime is required for credential callers and the helper.');
  }
  const entitlements = spawnSync('/usr/bin/codesign', ['-d', '--entitlements', ':-', path], {
    encoding: 'utf8',
  });
  if (entitlements.status !== 0) throw new Error('Could not inspect code-signing entitlements.');
  if (entitlements.stdout.trim()) {
    const values = JSON.parse(
      run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', '--', '-'], {
        input: entitlements.stdout,
      }),
    );
    for (const permission of [
      'com.apple.security.cs.allow-dyld-environment-variables',
      'com.apple.security.cs.disable-library-validation',
      'com.apple.security.get-task-allow',
    ]) {
      if (values[permission] === true)
        throw new Error(`Unsafe credential-access entitlement: ${permission}`);
    }
  }
  const cdhash = /^CDHash=([a-f0-9]{40,64})$/imu.exec(details)?.[1];
  if (!cdhash) throw new Error('The signed executable has no verifiable code directory hash.');
  return { fingerprint: identity.fingerprint, designatedRequirement, cdhash, details };
}

// Standalone executable signing for acceptance fixtures. App bundles are signed
// inside-out by Tauri, never with codesign --deep --sign after bundling.
export function signExecutable(path, identifier, identity) {
  run('/usr/bin/codesign', [
    '--force',
    '--sign',
    identity.fingerprint,
    ...(identity.keychain ? ['--keychain', identity.keychain] : []),
    '--identifier',
    identifier,
    '--options',
    'runtime',
    ...(identity.local ? ['--timestamp=none'] : []),
    path,
  ]);
  return verifySignedCode(path, identifier, identity);
}

export function provisionLocalIdentity() {
  if (existsSync(localSigningProfile)) return resolveSigningIdentity({});
  mkdirSync(localSigningDirectory, { recursive: true, mode: 0o700 });
  chmodSync(localSigningDirectory, 0o700);
  const keychain = run('/usr/bin/security', ['default-keychain', '-d', 'user'])
    .trim()
    .replace(/^"|"$/g, '');
  if (!keychain) throw new Error('No user keychain is available.');
  if (
    existsSync(join(localSigningDirectory, 'certificate.pem')) ||
    parseIdentities(
      run('/usr/bin/security', ['find-identity', '-p', 'codesigning', keychain]),
    ).some((identity) => identity.name === 'Glossa Local Code Signing')
  ) {
    throw new Error(
      'An existing local certificate needs its public identity profile recovered; refusing to silently generate a different identity.',
    );
  }
  const temporary = mkdtempSync(join(tmpdir(), 'glossa-signing-'));
  chmodSync(temporary, 0o700);
  try {
    const keyPath = join(temporary, 'private.key');
    const certificatePath = join(temporary, 'certificate.pem');
    const archivePath = join(temporary, 'identity.p12');
    const importerPath = join(temporary, 'import-identity');
    const configurationPath = join(temporary, 'openssl.cnf');
    writeFileSync(
      configurationPath,
      '[req]\nprompt=no\ndistinguished_name=dn\nx509_extensions=ext\n[dn]\nCN=Glossa Local Code Signing\n[ext]\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=critical,codeSigning\n',
      { mode: 0o600 },
    );
    // The temporary directory is private before openssl creates any material.
    // No private key, password, or PKCS#12 archive is saved in the repository.
    run('/usr/bin/openssl', [
      'req',
      '-new',
      '-newkey',
      'rsa:3072',
      '-nodes',
      '-x509',
      '-sha256',
      '-days',
      '7300',
      '-config',
      configurationPath,
      '-keyout',
      keyPath,
      '-out',
      certificatePath,
    ]);
    chmodSync(keyPath, 0o600);
    const temporaryPassword = randomBytes(32).toString('hex');
    run(
      '/usr/bin/openssl',
      [
        'pkcs12',
        '-export',
        '-inkey',
        keyPath,
        '-in',
        certificatePath,
        '-out',
        archivePath,
        '-passout',
        'stdin',
      ],
      { input: `${temporaryPassword}\n` },
    );
    chmodSync(archivePath, 0o600);
    // No app is permanently trusted for the newly-created private key. Signing
    // requires explicit system authorization; never use Always Allow, -A, or
    // global trust to make local development unattended.
    run('/usr/bin/xcrun', [
      'swiftc',
      resolve(dirname(fileURLToPath(import.meta.url)), 'native', 'glossa-signing-import.swift'),
      '-o',
      importerPath,
    ]);
    run(importerPath, [archivePath, keychain], { input: `${temporaryPassword}\n` });
    const certificate = new X509Certificate(readFileSync(certificatePath));
    const fingerprint = createHash('sha1').update(certificate.raw).digest('hex').toUpperCase();
    const profile = {
      version: 1,
      fingerprint,
      keychain,
      name: 'Glossa Local Code Signing',
      createdAt: new Date().toISOString(),
    };
    writeFileSync(join(localSigningDirectory, 'certificate.pem'), certificate.toString(), {
      mode: 0o600,
      flag: 'wx',
    });
    writeFileSync(localSigningProfile, `${JSON.stringify(profile, null, 2)}\n`, {
      mode: 0o600,
      flag: 'wx',
    });
    return resolveSigningIdentity({});
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

export function provisionCredentialHelper(identity, { upgrade = false } = {}) {
  const sourcePath = resolve(
    dirname(fileURLToPath(import.meta.url)),
    'native',
    'glossa-credential-helper.swift',
  );
  const source = readFileSync(sourcePath, 'utf8');
  const sourceHash = createHash('sha256').update(source).digest('hex');
  const manifestPath = join(localSigningDirectory, 'credential-helper.json');
  mkdirSync(localSigningDirectory, { recursive: true, mode: 0o700 });
  const directory = lstatSync(localSigningDirectory);
  if (
    !directory.isDirectory() ||
    directory.isSymbolicLink() ||
    directory.uid !== process.getuid() ||
    (directory.mode & 0o077) !== 0
  ) {
    throw new Error(
      'The credential helper directory must be a private directory owned by this user.',
    );
  }
  if (existsSync(credentialHelperPath) || existsSync(manifestPath)) {
    if (!existsSync(credentialHelperPath) || !existsSync(manifestPath))
      throw new Error(
        'The credential helper installation is incomplete; inspect it before recovery.',
      );
    const installed = lstatSync(credentialHelperPath);
    const manifestFile = lstatSync(manifestPath);
    if (
      !installed.isFile() ||
      installed.isSymbolicLink() ||
      installed.uid !== process.getuid() ||
      (installed.mode & 0o022) !== 0 ||
      !manifestFile.isFile() ||
      manifestFile.isSymbolicLink()
    ) {
      throw new Error('The credential helper installation permissions are invalid.');
    }
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const actualHash = createHash('sha256')
      .update(readFileSync(credentialHelperPath))
      .digest('hex');
    if (manifest.executableSHA256 !== actualHash)
      throw new Error(
        'The installed credential helper was modified; refusing to replace it automatically.',
      );
    if (
      manifest.version === 2 &&
      manifest.sourceHash === sourceHash &&
      manifest.certificateSHA1 === identity.fingerprint
    ) {
      const verified = verifySignedCode(credentialHelperPath, credentialHelperIdentifier, identity);
      return { ...manifest, cdhash: verified.cdhash, path: credentialHelperPath, reused: true };
    }
    if (!upgrade)
      throw new Error(
        'The credential helper source or signer changed. Review the change, then explicitly run `node scripts/glossa-macos-signing.mjs upgrade-helper`. Updating the helper itself may require one new Keychain authorization.',
      );
  }
  const temporary = mkdtempSync(join(localSigningDirectory, '.helper-build-'));
  chmodSync(temporary, 0o700);
  try {
    const renderedPath = join(temporary, 'helper.swift');
    const executablePath = join(temporary, 'credential-helper');
    writeFileSync(
      renderedPath,
      source.replace('__GLOSSA_SIGNING_CERT_SHA1__', identity.fingerprint),
      { mode: 0o600 },
    );
    run('/usr/bin/xcrun', ['swiftc', '-O', renderedPath, '-o', executablePath]);
    const verified = signExecutable(executablePath, credentialHelperIdentifier, identity);
    chmodSync(executablePath, 0o700);
    const manifest = {
      version: 2,
      sourceHash,
      certificateSHA1: identity.fingerprint,
      cdhash: verified.cdhash,
      executableSHA256: createHash('sha256').update(readFileSync(executablePath)).digest('hex'),
      identifier: credentialHelperIdentifier,
      createdAt: new Date().toISOString(),
    };
    if (existsSync(credentialHelperPath)) {
      copyFileSync(
        credentialHelperPath,
        join(localSigningDirectory, `credential-helper.previous-${Date.now()}`),
      );
    }
    renameSync(executablePath, credentialHelperPath);
    writeFileSync(join(temporary, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, {
      mode: 0o600,
    });
    renameSync(join(temporary, 'manifest.json'), manifestPath);
    return { ...manifest, path: credentialHelperPath, reused: false };
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

export function localPrivateKeyAccess(identity, operation) {
  const profile = JSON.parse(readFileSync(localSigningProfile, 'utf8'));
  if (
    !identity.local ||
    identity.fingerprint !== profile.fingerprint ||
    identity.keychain !== profile.keychain
  ) {
    throw new Error(
      'Private-key ACL tooling is restricted to the one provisioned local Glossa identity.',
    );
  }
  if (!['inspect', 'lock'].includes(operation)) throw new Error('Invalid private-key operation.');
  const temporary = mkdtempSync(join(tmpdir(), 'glossa-key-access-'));
  chmodSync(temporary, 0o700);
  try {
    const executable = join(temporary, 'key-access');
    run('/usr/bin/xcrun', [
      'swiftc',
      resolve(dirname(fileURLToPath(import.meta.url)), 'native/glossa-signing-key-access.swift'),
      '-o',
      executable,
    ]);
    return JSON.parse(run(executable, [operation, identity.fingerprint, identity.keychain]));
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.platform !== 'darwin') throw new Error('macOS is required.');
    const [operation, path, identifier] = process.argv.slice(2);
    const identity =
      operation === 'provision' ? provisionLocalIdentity() : resolveSigningIdentity();
    if (operation === 'lock-private-key' || operation === 'inspect-private-key') {
      process.stdout.write(
        `${JSON.stringify(localPrivateKeyAccess(identity, operation === 'lock-private-key' ? 'lock' : 'inspect'), null, 2)}\n`,
      );
    } else if (operation === 'provision-helper' || operation === 'upgrade-helper') {
      process.stdout.write(
        `${JSON.stringify(provisionCredentialHelper(identity, { upgrade: operation === 'upgrade-helper' }), null, 2)}\n`,
      );
    } else if (operation === 'sign-executable') {
      if (!path || !identifier) throw new Error('Usage: sign-executable PATH IDENTIFIER');
      process.stdout.write(
        `${JSON.stringify(signExecutable(path, identifier, identity), null, 2)}\n`,
      );
    } else if (operation === 'inspect' || operation === 'provision') {
      process.stdout.write(`${JSON.stringify(identity, null, 2)}\n`);
    } else
      throw new Error(
        'Usage: glossa-macos-signing.mjs provision | inspect | provision-helper | upgrade-helper | inspect-private-key | lock-private-key | sign-executable PATH IDENTIFIER',
      );
  } catch (error) {
    process.stderr.write(`Glossa signing: ${error.message}\n`);
    process.exitCode = 1;
  }
}
