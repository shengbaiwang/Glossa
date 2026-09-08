#!/usr/bin/env node

import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const REQUIRED_NODE_MAJOR = 24;
const GLOSSA_IDENTIFIER = 'app.glossa.reader';
const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = resolve(dirname(scriptPath), '..');
const configPath = 'src-tauri/tauri.glossa.conf.json';
const configAbsolutePath = resolve(repositoryRoot, 'apps/readest-app', configPath);
const targetDirectory = resolve(repositoryRoot, '.glossa-build', 'target');
const appPath = resolve(targetDirectory, 'release', 'bundle', 'macos', 'Glossa.app');

const fail = (message) => {
  process.stderr.write(`Glossa build: ${message}\n`);
  process.exitCode = 1;
};

const executableExists = (path) => Boolean(path && existsSync(path));

const node24Candidates = [
  process.env.GLOSSA_NODE_24,
  '/opt/homebrew/opt/node@24/bin/node',
  '/usr/local/opt/node@24/bin/node',
].filter(executableExists);

const currentNodeMajor = Number.parseInt(process.versions.node.split('.')[0] ?? '', 10);
if (process.platform !== 'darwin') {
  fail('the app bundle can only be built on macOS.');
} else if (currentNodeMajor !== REQUIRED_NODE_MAJOR && process.env.GLOSSA_BUILD_REEXECUTED !== '1') {
  const node24 = node24Candidates[0];
  if (!node24) {
    fail(
      `Node ${REQUIRED_NODE_MAJOR} is required. Install it with \`brew install node@24\`, or set GLOSSA_NODE_24 to its executable path.`,
    );
  } else {
    const rerun = spawnSync(node24, [scriptPath], {
      cwd: repositoryRoot,
      env: { ...process.env, GLOSSA_BUILD_REEXECUTED: '1' },
      stdio: 'inherit',
    });
    process.exitCode = rerun.status ?? 1;
  }
} else if (currentNodeMajor !== REQUIRED_NODE_MAJOR) {
  fail(`Node ${REQUIRED_NODE_MAJOR} could not be activated.`);
} else if (!existsSync(configAbsolutePath)) {
  fail(`missing Tauri config: apps/readest-app/${configPath}`);
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
    NODE_OPTIONS: [process.env.NODE_OPTIONS, '--max-old-space-size=8192'].filter(Boolean).join(' '),
    CARGO_TARGET_DIR: targetDirectory,
    DBUS_ID: GLOSSA_IDENTIFIER,
    NEXT_PUBLIC_GLOSSA_RUNTIME_ID: GLOSSA_IDENTIFIER,
    KEEP_SOURCEMAPS: '1',
  };

  const cargo = spawnSync('cargo', ['--version'], {
    cwd: repositoryRoot,
    env: commandEnvironment,
    encoding: 'utf8',
  });
  if (cargo.status !== 0) {
    fail('Cargo was not found. Install Rust with `brew install rustup && rustup default stable`.');
  } else {
    process.stdout.write(
      [
        'Building the isolated Glossa macOS app.',
        `Identifier: ${GLOSSA_IDENTIFIER}`,
        `Build output: ${targetDirectory}`,
      ].join('\n') + '\n',
    );

    const build = spawnSync(
      'pnpm',
      [
        // This command only executes dependencies already present in the lockfile.
        // Permit the locally installed pnpm when Corepack's remote signature lookup
        // is unavailable, rather than attempting a package-manager download.
        '--pm-on-fail=ignore',
        '--filter',
        '@readest/readest-app',
        'tauri',
        'build',
        '--config',
        configPath,
        '--bundles',
        'app',
      ],
      {
        cwd: repositoryRoot,
        env: commandEnvironment,
        stdio: 'inherit',
      },
    );
    if (build.status !== 0) {
      fail(`Tauri exited with status ${build.status ?? 'unknown'}.`);
    } else if (!existsSync(appPath)) {
      fail(`Tauri reported success but ${appPath} was not created.`);
    } else {
      const sign = spawnSync(
        '/usr/bin/codesign',
        ['--force', '--deep', '--sign', '-', '--identifier', GLOSSA_IDENTIFIER, appPath],
        { cwd: repositoryRoot, stdio: 'inherit' },
      );
      if (sign.status !== 0) {
        fail(`ad-hoc code signing exited with status ${sign.status ?? 'unknown'}.`);
      } else {
        const verify = spawnSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', appPath], {
          cwd: repositoryRoot,
          stdio: 'inherit',
        });
        if (verify.status !== 0) {
          fail(`code-sign verification exited with status ${verify.status ?? 'unknown'}.`);
        } else {
          process.stdout.write(`Glossa.app is ready at ${appPath}\n`);
        }
      }
    }
  }
}
