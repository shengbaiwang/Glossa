import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import LibraryHeader from '@/app/library/components/LibraryHeader';
import { DropdownProvider } from '@/context/DropdownContext';
import { useSettingsStore } from '@/store/settingsStore';
let zh: Record<string, string> = {};

const locale = vi.hoisted(() => ({ chinese: false }));
const selection = vi.hoisted(() => ({ ids: new Set<string>(), clear: vi.fn() }));
import '@/styles/globals.css';
import '@/styles/glossa.css';
import '@/styles/glossa-library.css';
import '@/styles/glossa-desktop.css';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ envConfig: {}, appService: {} }) }));
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string, values?: Record<string, unknown>) => {
    const label = locale.chinese ? (zh[key] ?? key) : key;
    return label.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values?.[name] ?? name));
  },
}));
vi.mock('@/helpers/settings', () => ({
  saveSysSettings: async (_env: unknown, key: string, value: unknown) => {
    const store = useSettingsStore.getState();
    store.setSettings({ ...store.settings, [key]: value });
  },
}));
vi.mock('@/utils/nav', () => ({ navigateToLibrary: vi.fn() }));
vi.mock('@/hooks/useTrafficLight', () => ({
  useTrafficLight: () => ({ isTrafficLightVisible: false }),
}));
vi.mock('@/hooks/useShortcuts', () => ({ default: vi.fn() }));
vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => ({ safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 } }),
}));
vi.mock('@/store/libraryStore', () => ({
  useLibraryStore: () => ({
    currentBookshelf: [],
    selectedBooks: selection.ids,
    setSelectedBooks: selection.clear,
  }),
}));
beforeEach(async () => {
  zh = await fetch('/locales/zh-CN/translation.json').then((response) => response.json());
  locale.chinese = false;
  selection.ids = new Set();
  selection.clear.mockReset();
  document.documentElement.dataset['page'] = 'library';
  useSettingsStore.setState({
    settings: {
      ...useSettingsStore.getState().settings,
      libraryViewMode: 'grid',
      libraryAutoColumns: true,
      libraryColumns: 4,
      libraryCoverFit: 'fit',
      libraryListScale: 100,
      libraryGroupBy: 'none',
      librarySortBy: 'title',
      librarySortByAuto: true,
      librarySortAscending: true,
      libraryThenSortBy: 'none',
      libraryThenSortAscending: true,
      libraryRecentShelfEnabled: true,
    },
    isSettingsDialogOpen: false,
  });
});

afterEach(() => {
  cleanup();
  for (const attr of ['dir', 'data-theme', 'data-eink', 'data-page'])
    document.documentElement.removeAttribute(attr);
});

function renderToolbar() {
  const select = vi.fn();
  const view = render(
    <DropdownProvider>
      <LibraryHeader
        onImportBooks={vi.fn()}
        onPullLibrary={vi.fn()}
        searchQuery=''
        searchTarget='books'
        searchConfig={{ scope: 'book', mode: 'contains', matchCase: false, matchDiacritics: false }}
        onSearchConfigChange={vi.fn()}
        onSearchQueryChange={vi.fn()}
        onSearchTargetChange={vi.fn()}
      />
    </DropdownProvider>,
  );
  return { ...view, select };
}

it('keeps display hierarchy and functional icons legible in light and dark', async () => {
  await page.viewport(1100, 800);
  const { container, select } = renderToolbar();
  const trigger = screen.getByRole('button', { name: 'Library Display' });
  expect(trigger.textContent).toBe('Display');
  expect(screen.getByRole('button', { name: 'Settings' }).querySelector('svg')).toBeTruthy();
  for (const theme of ['default-light', 'default-dark']) {
    document.documentElement.setAttribute('data-theme', theme);
    await userEvent.click(trigger);
    expect(screen.queryByRole('menuitem', { name: 'Select Books' })).toBeNull();
    const menu = container.querySelector('.view-menu')!;
    expect(menu.getBoundingClientRect().right).toBeLessThanOrEqual(innerWidth - 15);
    expect(menu.getBoundingClientRect().height).toBeLessThan(
      matchMedia('(pointer: coarse)').matches ? 470 : 430,
    );
    expect(
      screen.getByRole('button', { name: 'Grid', pressed: true }).querySelector('svg'),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'List', pressed: false }).querySelector('svg'),
    ).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: '3D covers' })).toBeNull();
    await page.screenshot({
      path: `../../../../../../.glossa-dev/qa/library-display-${theme}.png`,
    });
    await userEvent.keyboard('{Escape}');
    expect(menu.isConnected).toBe(false);
  }
  expect(select).not.toHaveBeenCalled();
});

it('supports keyboard display choices and Escape at 320px in RTL and e-ink', async () => {
  await page.viewport(320, 680);
  document.documentElement.dir = 'rtl';
  document.documentElement.setAttribute('data-theme', 'default-light');
  document.documentElement.setAttribute('data-eink', 'true');
  const { container, select } = renderToolbar();
  const toggle = screen.getByRole('button', { name: 'Library Display' });
  toggle.focus();
  await userEvent.keyboard('{Enter}');
  await userEvent.tab();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Grid' }));
  await userEvent.tab();
  await userEvent.keyboard('{Enter}');
  expect(screen.getByRole('button', { name: 'List', pressed: true })).toBeTruthy();
  expect(screen.getByRole('group', { name: 'List Size' })).toBeTruthy();
  const menu = container.querySelector('.view-menu')!;
  expect(menu.getBoundingClientRect().left).toBeGreaterThanOrEqual(15);
  expect(menu.getBoundingClientRect().right).toBeLessThanOrEqual(innerWidth - 15);
  expect(menu.scrollWidth).toBeLessThanOrEqual(menu.clientWidth);
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(innerWidth);
  await page.screenshot({ path: '../../../../../../.glossa-dev/qa/library-display-rtl-eink.png' });
  await userEvent.keyboard('{Escape}');
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  expect(document.activeElement).toBe(toggle);
  expect(select).not.toHaveBeenCalled();
});

it('updates cover and sort preferences in place and reaches global settings from a short window', async () => {
  await page.viewport(390, 520);
  renderToolbar();
  await userEvent.click(screen.getByRole('button', { name: 'Library Display' }));
  await userEvent.click(screen.getByRole('button', { name: 'Sort' }));
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Primary sort' }), 'author');
  expect(useSettingsStore.getState().settings.librarySortBy).toBe('author');
  await userEvent.click(screen.getByRole('button', { name: 'Primary sort / Ascending' }));
  expect(screen.getByRole('button', { name: 'Primary sort / Descending' })).toBeTruthy();
  expect(
    screen.getByRole('button', { name: 'Secondary sort / Ascending' }).hasAttribute('disabled'),
  ).toBe(true);
  expect(screen.queryByRole('menuitem', { name: 'Theme & Background' })).toBeNull();
  await userEvent.keyboard('{Escape}');
  await userEvent.click(screen.getByRole('button', { name: 'Settings' }));
  expect(useSettingsStore.getState().requestedPanel).toBe('General');
  expect(useSettingsStore.getState().settingsDialogScope).toBe('application');
  expect(useSettingsStore.getState().isSettingsDialogOpen).toBe(true);
  expect(
    screen.getByRole('button', { name: 'Library Display' }).getAttribute('aria-expanded'),
  ).toBe('false');
});

it('keeps Chinese controls aligned with touch targets and takes a localized preview', async () => {
  await page.viewport(820, 720);
  locale.chinese = true;
  document.documentElement.setAttribute('data-theme', 'default-dark');
  renderToolbar();
  await userEvent.click(screen.getByRole('button', { name: '书库显示' }));
  const grid = screen.getByRole('button', { name: '网格' });
  const list = screen.getByRole('button', { name: '列表' });
  expect(grid.getBoundingClientRect().width).toBeCloseTo(list.getBoundingClientRect().width, 0);
  if (matchMedia('(pointer: coarse)').matches) {
    for (const control of [
      grid,
      list,
      screen.getByRole('slider', { name: zh['Cover Size'] ?? 'Cover Size' }),
    ]) {
      expect(control.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    }
  }
  await page.screenshot({ path: '../../../../../../.glossa-dev/qa/library-display-zh-dark.png' });
});

it('keeps direct selection actions and display/import within a narrow toolbar', async () => {
  await page.viewport(320, 680);
  locale.chinese = true;
  selection.ids = new Set(['a', 'b']);
  const { container } = renderToolbar();
  expect(screen.queryByRole('button', { name: zh['Select All'] })).toBeNull();
  expect(screen.getByRole('button', { name: zh['Import Books'] })).toBeTruthy();
  expect(screen.getByRole('button', { name: zh['Library Display'] })).toBeTruthy();
  expect(container.querySelector('.glossa-library-header')!.scrollWidth).toBeLessThanOrEqual(320);
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(innerWidth);
  await userEvent.click(screen.getByRole('button', { name: zh['Clear Selection'] }));
  expect(selection.clear).toHaveBeenCalledWith([]);
});
