import './LibraryDisplay.browser.test';
import { beforeAll, expect, it } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { appDataDir, join } from '@tauri-apps/api/path';
import { mkdir, remove, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { saveSettings } from '@/services/settingsService';
import { editLibraryDisplay } from '@/utils/libraryDisplaySettings';
import { DEFAULT_SYSTEM_SETTINGS, SETTINGS_FILENAME } from '@/services/constants';
import type { FileSystem } from '@/types/system';
import type { SystemSettings } from '@/types/settings';

beforeAll(async () => {
  expect(await invoke('get_app_identifier')).toBe('com.bilingify.readest.webdriver-test');
});
it('merges concurrent display edits and a stale reader save through native files', async () => {
  const dir = await join(await appDataDir(), `qa-library-display-${crypto.randomUUID()}`);
  await mkdir(dir, { recursive: true });
  const fs = {
    getPrefix: async () => dir,
    readFile: async (name: string) => readTextFile(await join(dir, name)),
    writeFile: async (name: string, _base: unknown, data: string) =>
      writeTextFile(await join(dir, name), data),
  } as unknown as FileSystem;
  try {
    const old = { ...DEFAULT_SYSTEM_SETTINGS, libraryCoverWidth: 156 } as SystemSettings;
    await saveSettings(fs, old);
    await Promise.all([
      saveSettings(fs, editLibraryDisplay(old, 'libraryCoverWidth', 260)),
      saveSettings(fs, editLibraryDisplay(old, 'libraryShowAuthor', false)),
    ]);
    await saveSettings(fs, old);
    const persisted = JSON.parse(await readTextFile(await join(dir, SETTINGS_FILENAME)));
    expect(persisted).toMatchObject({ libraryCoverWidth: 260, libraryShowAuthor: false });
  } finally {
    await remove(dir, { recursive: true });
  }
});
