import type { SystemSettings } from '@/types/settings';

export const LIBRARY_DISPLAY_KEYS = [
  'libraryViewMode',
  'libraryCoverFit',
  'libraryCoverWidth',
  'libraryListScale',
  'libraryShowAuthor',
  'libraryShowProgress',
  'libraryRecentShelfEnabled',
  'librarySortBy',
  'librarySortByAuto',
  'librarySortAscending',
  'libraryThenSortBy',
  'libraryThenSortByAuto',
  'libraryThenSortAscending',
  'libraryGroupBy',
] as const;
export type LibraryDisplayKey = (typeof LIBRARY_DISPLAY_KEYS)[number];
export type LibraryDisplayClocks = Partial<Record<LibraryDisplayKey, number>>;
export type LibraryDisplaySettings = Pick<
  SystemSettings,
  LibraryDisplayKey | 'libraryDisplayUpdatedAt'
>;

function displayClock(settings: Partial<LibraryDisplaySettings>, key: LibraryDisplayKey): number {
  const value = settings.libraryDisplayUpdatedAt?.[key];
  return typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value < Number.MAX_SAFE_INTEGER
    ? value
    : 0;
}

/** Only explicit preference edits advance clocks; routine reader saves cannot claim them. */
export function editLibraryDisplay<K extends LibraryDisplayKey>(
  settings: SystemSettings,
  key: K,
  value: SystemSettings[K],
): SystemSettings {
  const clock = Math.max(
    Date.now(),
    ...LIBRARY_DISPLAY_KEYS.map((k) => displayClock(settings, k) + 1),
  );
  return {
    ...settings,
    [key]: value,
    libraryAutoColumns: false,
    libraryDisplayUpdatedAt: { ...settings.libraryDisplayUpdatedAt, [key]: clock },
  };
}

/** Merge only display fields, preserving unrelated settings and newer per-field edits. */
export function mergeLibraryDisplay<T extends SystemSettings>(
  local: T,
  incoming: Partial<LibraryDisplaySettings>,
): T {
  const merged = { ...local, libraryDisplayUpdatedAt: { ...local.libraryDisplayUpdatedAt } };
  for (const key of LIBRARY_DISPLAY_KEYS) {
    const clock = displayClock(incoming, key);
    if (incoming[key] !== undefined && clock >= displayClock(local, key)) {
      Object.assign(merged, { [key]: incoming[key] });
      merged.libraryDisplayUpdatedAt[key] = clock;
    }
  }
  return merged;
}

export function pickLibraryDisplay(settings: SystemSettings): LibraryDisplaySettings {
  return Object.fromEntries(
    [...LIBRARY_DISPLAY_KEYS, 'libraryDisplayUpdatedAt'].map((key) => [
      key,
      settings[key as keyof SystemSettings],
    ]),
  ) as LibraryDisplaySettings;
}

export const getLibraryCoverWidth = (settings: SystemSettings): number =>
  Number.isFinite(settings.libraryCoverWidth)
    ? Math.max(112, Math.min(280, settings.libraryCoverWidth!))
    : 156;
