import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { lazy, Suspense } from 'react';
import SettingsToggler from '@/app/reader/components/SettingsToggler';
import BookCover from '@/components/BookCover';
import { useSettingsStore } from '@/store/settingsStore';
import { useLibraryStore } from '@/store/libraryStore';
import { useLibraryRefresh } from '@/hooks/useLibraryRefresh';
import { notifyLibraryUpdated } from '@/utils/libraryEvents';
import { getDefaultViewSettings } from '@/services/settingsService';
import { DEFAULT_SYSTEM_SETTINGS } from '@/services/constants';
import type { Book } from '@/types/book';
import type { SystemSettings } from '@/types/settings';
import type { FileSystem } from '@/types/system';
import { readLibraryDiagnostics } from '@/utils/libraryDiagnostics';
import '@/styles/globals.css';
import '@/styles/glossa.css';
const SettingsDialog = lazy(() => import('@/components/settings/SettingsDialog'));

const fixture = vi.hoisted(() => ({
  envConfig: {},
  appService: { isMobile: false, hasWindow: true, isAndroidApp: false, isMacOSApp: true },
  trusted: [] as boolean[],
}));
const t = (key: string) => key;
// Synthetic preferences replace every disk, account, font and native boundary.
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: fixture.envConfig, appService: fixture.appService }),
}));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => t }));
vi.mock('@/hooks/useResponsiveSize', () => ({ useResponsiveSize: (size: number) => size }));
vi.mock('@/components/command-palette', () => ({ useCommandPalette: () => ({ open: vi.fn() }) }));

vi.mock('@/store/themeStore', () => ({ useThemeStore: () => ({ safeAreaInsets: {} }) }));
vi.mock('@/store/deviceStore', () => ({
  useDeviceControlStore: () => ({
    acquireBackKeyInterception: vi.fn(),
    releaseBackKeyInterception: vi.fn(),
  }),
}));
const reader = vi.hoisted(() => ({
  views: {} as Record<string, import('@/types/book').ViewSettings>,
  bookKeys: ['synthetic-book'],
  getView: () => null,
  getViewState: () => ({ isPrimary: true }),
  getViewSettings: (key: string) => reader.views[key],
  setViewSettings: vi.fn(),
  getGridInsets: () => ({}),
  recreateViewer: vi.fn(),
  setHoveredBookKey: vi.fn(),
}));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: Object.assign(() => reader, { getState: () => reader }),
}));
const data = vi.hoisted(() => ({
  fixed: true,
  saveConfig: vi.fn(async () => {}),
  getConfig: () => ({}),
  getBookData: () => ({
    isFixedLayout: data.fixed,
    book: { format: data.fixed ? 'PDF' : 'EPUB' },
    bookDoc: { rendition: { layout: data.fixed ? 'pre-paginated' : 'reflowable' } },
  }),
}));
vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: Object.assign(() => data, { getState: () => data }),
}));
vi.mock('@/utils/bridge', () => ({
  getSysFontsList: async () => ({ fonts: { 'Synthetic System Font': 'Synthetic System Font' } }),
  selectDirectory: vi.fn(),
  lockScreenOrientation: vi.fn(),
  captureWebviewRegion: vi.fn(),
}));
vi.mock('@/services/biometric', () => ({
  isBiometricSupported: () => false,
  getBiometricStatus: vi.fn(),
  getBiometryLabelKey: vi.fn(),
}));
vi.mock('@/components/AboutWindow', () => ({ setAboutDialogVisible: vi.fn() }));
vi.mock('@/app/library/components/BackupWindow', () => ({ setBackupDialogVisible: vi.fn() }));
vi.mock('@/app/library/components/CacheManagerWindow', () => ({
  setCacheManagerDialogVisible: vi.fn(),
}));
vi.mock('@/app/library/components/MigrateDataWindow', () => ({
  setMigrateDataDirDialogVisible: vi.fn(),
}));
vi.mock('@/hooks/useResetSettings', () => ({ useResetViewSettings: () => vi.fn() }));
vi.mock('@/store/customFontStore', () => ({
  useCustomFontStore: () => ({ fonts: [], getFontFamilies: () => [] }),
}));
vi.mock('@/components/settings/CustomFonts', () => ({ default: () => null }));
vi.mock('@/components/Dropdown', () => ({ default: () => null }));
vi.mock('@/components/settings/DialogMenu', () => ({ default: () => null }));

vi.mock('@/components/settings/ThemePanel', () => ({ default: () => null }));
vi.mock('@/components/settings/ShortcutsPanel', () => ({
  default: () => (
    <div data-testid='shortcuts-panel' data-setting-id='settings.shortcuts.bindings'>
      Shortcut preferences
    </div>
  ),
}));
vi.mock('@/components/settings/ControlPanel', () => ({ default: () => null }));
vi.mock('@/components/settings/LangPanel', () => ({ default: () => null }));
vi.mock('@/components/settings/IntegrationsPanel', () => ({ default: () => null }));
vi.mock('@/components/settings/MiscPanel', () => ({ default: () => null }));
vi.mock('@/glossa/ui/ModelSettingsPanel', () => ({ default: () => null }));
vi.mock('@/glossa/ui/PromptSettingsPanel', () => ({ default: () => null }));

const artwork = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="240"><rect width="160" height="240" fill="#819e88"/><circle cx="80" cy="100" r="42" fill="#e9dcb9"/></svg>')}`;
const books: Book[] = Array.from({ length: 3 }, (_, index) => ({
  hash: `synthetic-${index}`,
  title: `Synthetic ${index}`,
  author: 'Glossa',
  format: 'PDF',
  createdAt: 1,
  updatedAt: 1,
  coverImageUrl: artwork,
}));
const service = { loadLibraryBooks: vi.fn(async () => useLibraryStore.getState().library) };
function Harness() {
  const { isSettingsDialogOpen } = useSettingsStore();
  const { library } = useLibraryStore();
  useLibraryRefresh(service);
  return (
    <main style={{ padding: 64 }} onClickCapture={(event) => fixture.trusted.push(event.isTrusted)}>
      <SettingsToggler bookKey='synthetic-book' />
      <section style={{ display: 'flex', gap: 20 }}>
        {library.map((book) => (
          <div key={book.hash} style={{ width: 160, height: 240 }}>
            <BookCover book={book} />
          </div>
        ))}
      </section>
      {isSettingsDialogOpen && (
        <Suspense fallback={<span>Loading settings</span>}>
          <SettingsDialog bookKey='synthetic-book' scope='reading' />
        </Suspense>
      )}
    </main>
  );
}
beforeEach(() => {
  localStorage.clear();
  sessionStorage.setItem('glossa-library-diagnostics', '1');
  const defaults = getDefaultViewSettings({
    fs: {} as FileSystem,
    isMobile: false,
    isEink: false,
    isAppDataSandbox: true,
  });
  reader.views['synthetic-book'] = { ...defaults, isGlobal: false };
  // Older records omit these optional fields; opening Layout must remain read-only.
  Reflect.deleteProperty(reader.views['synthetic-book']!, 'webtoonMode');
  Reflect.deleteProperty(reader.views['synthetic-book']!, 'contrast');
  useSettingsStore.setState({
    settings: { ...DEFAULT_SYSTEM_SETTINGS, globalViewSettings: defaults } as SystemSettings,
    isSettingsDialogOpen: false,
  });
  useLibraryStore.getState().setLibrary(books, true);
  vi.clearAllMocks();
  fixture.trusted = [];
});
afterEach(() => {
  cleanup();
  sessionStorage.removeItem('glossa-library-diagnostics');
});

it.each([
  'PDF',
  'EPUB',
])('keeps actual covers visible while opening and closing real %s settings and refreshing progress', async (format) => {
  data.fixed = format === 'PDF';
  render(<Harness />);
  await waitFor(() =>
    expect(document.querySelectorAll('img[aria-hidden="false"]')).toHaveLength(3),
  );
  const original = [...document.querySelectorAll('img.cover-image')];
  for (let cycle = 0; cycle < 2; cycle++) {
    await page.getByRole('button', { name: 'Reading Appearance' }).click({ button: 'left' });
    await waitFor(() => expect(screen.getByText('This Book Only')).toBeTruthy(), {
      timeout: 15000,
    });
    await page.getByRole('button', { name: 'Layout', exact: true }).click({ button: 'left' });
    expect(data.saveConfig).not.toHaveBeenCalled();
    await page.getByRole('button', { name: 'Close', exact: true }).click({ button: 'left' });
    await waitFor(() => expect(screen.queryByText('This Book Only')).toBeNull());
  }
  notifyLibraryUpdated(['synthetic-0']);
  await waitFor(() => expect(service.loadLibraryBooks).toHaveBeenCalled());
  for (const [index, image] of [
    ...document.querySelectorAll<HTMLImageElement>('img.cover-image'),
  ].entries()) {
    expect(image).toBe(original[index]);
    expect(image.naturalWidth).toBeGreaterThan(0);
    expect(getComputedStyle(image).visibility).toBe('visible');
  }
  expect(readLibraryDiagnostics().some((entry) => entry.event === 'cover-error')).toBe(false);
  expect(fixture.trusted.length).toBeGreaterThanOrEqual(6);
  expect(fixture.trusted.every(Boolean)).toBe(true);
});
