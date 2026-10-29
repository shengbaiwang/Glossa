import { it, expect, vi } from 'vitest';
import type { SystemSettings } from '@/types/settings';
import type { FileSystem } from '@/types/system';
import { saveSettings } from '@/services/settingsService';
import { DEFAULT_SYSTEM_SETTINGS, SETTINGS_FILENAME } from '@/services/constants';

const base = () =>
  ({
    ...DEFAULT_SYSTEM_SETTINGS,
    libraryCoverWidth: 156,
    libraryShowAuthor: true,
  }) as SystemSettings;
const memory = () => {
  const files = new Map<string, string>();
  const fs = {
    getPrefix: async () => '',
    readFile: async (name: string) => files.get(name) ?? '',
    writeFile: vi.fn(async (name: string, _base: unknown, data: string) => {
      files.set(name, data);
    }),
  } as unknown as FileSystem;
  return { fs, read: () => JSON.parse(files.get(SETTINGS_FILENAME)!) };
};
it('routine saves from an old reader retain the latest display choices', async () => {
  const { fs, read } = memory();
  const old = base();
  await saveSettings(fs, {
    ...old,
    libraryCoverWidth: 260,
    libraryShowAuthor: false,
    libraryDisplayUpdatedAt: { libraryCoverWidth: 2, libraryShowAuthor: 2 },
  } as SystemSettings);
  await saveSettings(fs, { ...old, lastOpenBooks: [] });
  expect(read()).toMatchObject({ libraryCoverWidth: 260, libraryShowAuthor: false });
});
it('concurrent independent display edits merge and late older writes cannot win', async () => {
  const { fs, read } = memory();
  const old = base();
  await Promise.all([
    saveSettings(fs, {
      ...old,
      libraryShowAuthor: false,
      libraryDisplayUpdatedAt: { libraryShowAuthor: 2 },
    } as SystemSettings),
    saveSettings(fs, {
      ...old,
      libraryCoverWidth: 260,
      libraryDisplayUpdatedAt: { libraryCoverWidth: 3 },
    } as SystemSettings),
  ]);
  await saveSettings(fs, {
    ...old,
    libraryCoverWidth: 200,
    libraryDisplayUpdatedAt: { libraryCoverWidth: 1 },
  } as SystemSettings);
  expect(read()).toMatchObject({ libraryCoverWidth: 260, libraryShowAuthor: false });
});

it('does not keep retired 3D-cover preferences when an older window saves', async () => {
  const { fs, read } = memory();
  const old = {
    ...base(),
    librarySkeuomorphicCovers: true,
    libraryDisplayUpdatedAt: { librarySkeuomorphicCovers: 100, libraryCoverWidth: 2 },
  } as SystemSettings;
  await saveSettings(fs, old);
  expect(read()).not.toHaveProperty('librarySkeuomorphicCovers');
  expect(read().libraryDisplayUpdatedAt).not.toHaveProperty('librarySkeuomorphicCovers');
  expect(read().libraryCoverWidth).toBe(156);
  await saveSettings(fs, old);
  expect(read()).not.toHaveProperty('librarySkeuomorphicCovers');
});
