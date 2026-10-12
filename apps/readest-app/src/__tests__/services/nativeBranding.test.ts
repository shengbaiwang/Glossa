import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const readConfig = (name: string) =>
  JSON.parse(readFileSync(path.resolve('src-tauri', name), 'utf8')) as {
    productName: string;
    mainBinaryName: string;
    identifier: string;
    plugins: {
      'deep-link': {
        desktop: { schemes: string[] };
        mobile?: { scheme: string[] }[];
      };
    };
  };

// These are the registered redirects used by AuthPage, OneDrive and Google Drive.
// Renaming the app must not leave an existing consent flow unable to return.
const cloudCallbackSchemes = ['readest'];

describe('Glossa native application identity', () => {
  it.each([
    ['tauri.conf.json', 'Glossa', 'glossa', 'app.glossa.reader'],
    ['tauri.glossa.conf.json', 'Glossa', 'glossa', 'app.glossa.reader'],
    ['tauri.glossa-dev.conf.json', 'Glossa Dev', 'glossa-dev', 'app.glossa.reader.dev'],
  ] as const)('%s uses the Glossa product identity', (name, productName, mainBinaryName, identifier) => {
    expect(readConfig(name)).toMatchObject({ productName, mainBinaryName, identifier });
  });

  it('uses a Glossa executable for cargo run and unbundled macOS permission prompts', () => {
    // Tauri dev calls cargo run; mainBinaryName only renames packaged builds.
    const manifest = readFileSync(path.resolve('src-tauri/Cargo.toml'), 'utf8');
    const packageSection = manifest.split(/^\[package\]\s*$/m)[1]?.split(/^\[/m)[0];
    expect(packageSection).toMatch(/^default-run\s*=\s*"Glossa"$/m);
    expect(manifest).toMatch(/\[\[bin\]\]\s+name\s*=\s*"Glossa"\s+path\s*=\s*"src\/main\.rs"/);
  });
});

describe('Glossa native authentication callbacks', () => {
  it.each([
    'tauri.conf.json',
    'tauri.glossa.conf.json',
    'tauri.glossa-dev.conf.json',
  ])('%s registers retained cloud callbacks alongside its own app links', (name) => {
    const schemes = readConfig(name).plugins['deep-link'].desktop.schemes;
    expect(schemes).toContain(name.includes('-dev') ? 'glossa-dev' : 'glossa');
    expect(schemes).toEqual(expect.arrayContaining(cloudCallbackSchemes));
    expect(schemes).toContain(name.includes('-dev') ? 'glossa-dev-onedrive' : 'glossa-onedrive');
    expect(schemes).not.toContain('readest-onedrive');
  });

  it('keeps mobile callback registration for the retained cloud account flows', () => {
    const mobile = readConfig('tauri.conf.json').plugins['deep-link'].mobile;
    expect(mobile?.flatMap(({ scheme }) => scheme)).toEqual(
      expect.arrayContaining(['glossa', ...cloudCallbackSchemes]),
    );
  });
});
