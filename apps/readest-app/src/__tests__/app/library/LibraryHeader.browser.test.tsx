import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import LibraryHeader from '@/app/library/components/LibraryHeader';
import { DropdownProvider } from '@/context/DropdownContext';
import '@/styles/globals.css';
import '@/styles/glossa.css';
import '@/styles/glossa-library.css';
import '@/styles/glossa-desktop.css';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ envConfig: {}, appService: {} }) }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
vi.mock('@/hooks/useTrafficLight', () => ({
  useTrafficLight: () => ({ isTrafficLightVisible: false }),
}));
vi.mock('@/hooks/useShortcuts', () => ({ default: vi.fn() }));
vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => ({ safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 } }),
}));
vi.mock('@/store/libraryStore', () => ({ useLibraryStore: () => ({ currentBookshelf: [] }) }));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({
    settings: { libraryViewMode: 'grid', libraryAutoColumns: true, libraryColumns: 4 },
    openSettingsDialog: vi.fn(),
  }),
}));

afterEach(() => {
  cleanup();
  for (const attr of ['dir', 'data-theme', 'data-eink'])
    document.documentElement.removeAttribute(attr);
});

function renderToolbar() {
  const select = vi.fn();
  const view = render(
    <DropdownProvider>
      <LibraryHeader
        isSelectMode={false}
        isSelectAll={false}
        onToggleSelectMode={select}
        onSelectAll={vi.fn()}
        onDeselectAll={vi.fn()}
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

it('keeps selection in the menu and distinguishes sliders and gear in light and dark', async () => {
  await page.viewport(1100, 800);
  const { container, select } = renderToolbar();
  expect(screen.queryByRole('button', { name: 'Select Books' })).toBeNull();
  expect(
    screen.getByRole('button', { name: 'Settings' }).querySelector('.lucide-settings'),
  ).toBeTruthy();
  for (const theme of ['default-light', 'default-dark']) {
    document.documentElement.setAttribute('data-theme', theme);
    await userEvent.click(screen.getByRole('button', { name: 'View Menu' }));
    expect(
      screen.getByRole('menuitem', { name: 'Select Books' }).getBoundingClientRect().height,
    ).toBeGreaterThanOrEqual(32);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
    await page.screenshot({
      path: `../../../../../../.glossa-dev/qa/library-toolbar-${theme}.png`,
    });
    await userEvent.click(screen.getByRole('menuitem', { name: 'Select Books' }));
    expect(container.querySelector('.view-menu')).toBeNull();
  }
  expect(select).toHaveBeenCalledTimes(2);
});

it('supports keyboard menu selection in narrow RTL and e-ink layouts', async () => {
  await page.viewport(390, 844);
  document.documentElement.dir = 'rtl';
  document.documentElement.setAttribute('data-theme', 'default-light');
  document.documentElement.setAttribute('data-eink', 'true');
  const { container, select } = renderToolbar();
  const toggle = screen.getByRole('button', { name: 'View Menu' });
  toggle.focus();
  await userEvent.keyboard('{Enter}');
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  await userEvent.tab();
  expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Select Books' }));
  const menu = container.querySelector('.view-menu')!;
  expect(menu.getBoundingClientRect().left).toBeGreaterThanOrEqual(0);
  expect(menu.getBoundingClientRect().right).toBeLessThanOrEqual(window.innerWidth);
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  await page.screenshot({
    path: '../../../../../../.glossa-dev/qa/library-toolbar-narrow-rtl-eink.png',
  });
  await userEvent.keyboard('{Enter}');
  expect(select).toHaveBeenCalledTimes(1);
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  toggle.focus();
  await userEvent.keyboard('{Enter}{Escape}');
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
});
