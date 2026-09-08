import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const readConfig = (name: string) =>
  JSON.parse(readFileSync(path.resolve('src-tauri', name), 'utf8')) as {
    plugins: {
      'deep-link': {
        desktop: { schemes: string[] };
        mobile?: { scheme: string[] }[];
      };
    };
  };

// These are the registered redirects used by AuthPage, OneDrive and Google Drive.
// Renaming the app must not leave an existing consent flow unable to return.
const cloudCallbackSchemes = [
  'readest',
  'readest-onedrive',
  'com.googleusercontent.apps.209390247301-ctpmep68ppfa56r1b8tr35e4qi4p60kq',
];

describe('Glossa native authentication callbacks', () => {
  it.each([
    'tauri.conf.json',
    'tauri.glossa.conf.json',
    'tauri.glossa-dev.conf.json',
  ])('%s registers retained cloud callbacks alongside its own app links', (name) => {
    const schemes = readConfig(name).plugins['deep-link'].desktop.schemes;
    expect(schemes).toContain(name.includes('-dev') ? 'glossa-dev' : 'glossa');
    expect(schemes).toEqual(expect.arrayContaining(cloudCallbackSchemes));
  });

  it('keeps mobile callback registration for the retained cloud account flows', () => {
    const mobile = readConfig('tauri.conf.json').plugins['deep-link'].mobile;
    expect(mobile?.flatMap(({ scheme }) => scheme)).toEqual(
      expect.arrayContaining(['glossa', ...cloudCallbackSchemes]),
    );
  });
});
