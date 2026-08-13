#!/usr/bin/env node

import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

const REQUIRED_NODE_MAJOR = 24;
const GLOSSA_IDENTIFIER = 'app.glossa.reader.dev';
const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = resolve(dirname(scriptPath), '..');
const configPath = 'src-tauri/tauri.glossa-dev.conf.json';
const configAbsolutePath = resolve(repositoryRoot, 'apps/readest-app', configPath);
const targetDirectory = resolve(repositoryRoot, '.glossa-dev', 'target');
const requestedArgs = process.argv.slice(2);

const fail = (message) => {
  process.stderr.write(`Glossa Dev: ${message}\n`);
  process.exitCode = 1;
};

const executableExists = (path) => Boolean(path && existsSync(path));

const node24Candidates = [
  process.env.GLOSSA_NODE_24,
  '/opt/homebrew/opt/node@24/bin/node',
  '/usr/local/opt/node@24/bin/node',
].filter(executableExists);

const currentNodeMajor = Number.parseInt(process.versions.node.split('.')[0] ?? '', 10);
if (currentNodeMajor !== REQUIRED_NODE_MAJOR && process.env.GLOSSA_DEV_REEXECUTED !== '1') {
  const node24 = node24Candidates[0];
  if (!node24) {
    fail(
      `Node ${REQUIRED_NODE_MAJOR} is required. Install it with \`brew install node@24\`, or set GLOSSA_NODE_24 to its executable path.`,
    );
  } else {
    const rerun = spawnSync(node24, [scriptPath, ...requestedArgs], {
      cwd: repositoryRoot,
      env: { ...process.env, GLOSSA_DEV_REEXECUTED: '1' },
      stdio: 'inherit',
    });
    process.exitCode = rerun.status ?? 1;
  }
} else if (currentNodeMajor !== REQUIRED_NODE_MAJOR) {
  fail(`Node ${REQUIRED_NODE_MAJOR} could not be activated.`);
} else if (process.env.NEXT_PUBLIC_PORTABLE_APP) {
  fail('portable mode is forbidden for Glossa Dev because it can collide with the development executable. Unset NEXT_PUBLIC_PORTABLE_APP.');
} else {
  const homeDirectory = process.env.HOME ?? '';
  const toolDirectories = [
    dirname(process.execPath),
    '/opt/homebrew/opt/node@24/bin',
    '/usr/local/opt/node@24/bin',
    '/opt/homebrew/opt/rustup/bin',
    '/usr/local/opt/rustup/bin',
    homeDirectory ? `${homeDirectory}/.cargo/bin` : '',
  ].filter(Boolean);
  const path = [...toolDirectories, process.env.PATH ?? ''].join(':');
  const commandEnvironment = {
    ...process.env,
    PATH: path,
    CARGO_TARGET_DIR: targetDirectory,
    DBUS_ID: GLOSSA_IDENTIFIER,
    NEXT_PUBLIC_GLOSSA_ENABLED: 'true',
    NEXT_PUBLIC_GLOSSA_RUNTIME_ID: GLOSSA_IDENTIFIER,
    READEST_DISABLE_UPDATER: '1',
  };

  const cargo = spawnSync('cargo', ['--version'], {
    cwd: repositoryRoot,
    env: commandEnvironment,
    encoding: 'utf8',
  });
  if (cargo.status !== 0) {
    fail('Cargo was not found. Install Rust with `brew install rustup && rustup default stable`.');
  } else if (!existsSync(configAbsolutePath)) {
    fail(`missing isolated Tauri config: apps/readest-app/${configPath}`);
  } else if (requestedArgs.length === 1 && requestedArgs[0] === '--check') {
    process.stdout.write(
      [
        'Glossa Dev isolation is ready.',
        `Node: ${process.version}`,
        `Cargo: ${cargo.stdout.trim()}`,
        `Identifier: ${GLOSSA_IDENTIFIER}`,
        `Build output: ${targetDirectory}`,
        'Application data: macOS Application Support/app.glossa.reader.dev',
      ].join('\n') + '\n',
    );
  } else {
    const tauriArguments = [
      '--filter',
      '@readest/readest-app',
      'tauri',
      'dev',
      '--config',
      configPath,
    ];
    if (requestedArgs.length > 0) tauriArguments.push('--', '--', ...requestedArgs);

    process.stdout.write(
      [
        'Starting Glossa Dev (isolated from Readest).',
        `Identifier: ${GLOSSA_IDENTIFIER}`,
        `Build output: ${targetDirectory}`,
        'Application data: macOS Application Support/app.glossa.reader.dev',
      ].join('\n') + '\n',
    );

    const child = spawn('pnpm', tauriArguments, {
      cwd: repositoryRoot,
      env: commandEnvironment,
      stdio: 'inherit',
    });
    child.on('error', (error) => {
      fail(`could not start pnpm: ${error.message}`);
    });
    child.on('exit', (code, signal) => {
      if (signal) process.exitCode = 1;
      else process.exitCode = code ?? 1;
    });
  }
}
