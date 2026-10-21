import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ViewMenu from '@/app/library/components/ViewMenu';

const { settings, save, navigate, openSettings } = vi.hoisted(() => ({
  settings: {
    libraryViewMode: 'list',
    libraryListScale: 100,
    libraryAutoColumns: true,
    libraryColumns: 10,
    libraryGroupBy: 'none',
    librarySortBy: 'title',
    librarySortByAuto: true,
    libraryThenSortBy: 'none',
    libraryCoverFit: 'crop',
    librarySkeuomorphicCovers: false,
    libraryRecentShelfEnabled: true,
  },
  save: vi.fn(),
  navigate: vi.fn(),
  openSettings: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({}),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ envConfig: {} }) }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({ settings, openSettingsDialog: openSettings }),
}));
vi.mock('@/helpers/settings', () => ({ saveSysSettings: save }));
vi.mock('@/utils/nav', () => ({ navigateToLibrary: navigate }));

beforeEach(() => {
  Object.assign(settings, {
    libraryViewMode: 'list',
    libraryListScale: 100,
    libraryAutoColumns: true,
    libraryColumns: 10,
    libraryGroupBy: 'none',
    librarySortBy: 'title',
    librarySortByAuto: true,
    libraryThenSortBy: 'none',
    libraryCoverFit: 'crop',
    librarySkeuomorphicCovers: false,
    libraryRecentShelfEnabled: true,
  });
  save.mockReset();
  navigate.mockReset();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('keeps display choices together without a selection command', () => {
  render(<ViewMenu />);
  expect(screen.queryByRole('menuitem', { name: 'Select Books' })).toBeNull();
  expect(screen.getByRole('button', { name: 'List', pressed: true })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Grid', pressed: false })).toBeTruthy();
  expect(
    screen.getByRole('menuitemcheckbox', { name: 'Skeuomorphic Book Covers - OFF' }),
  ).toBeTruthy();
  expect(screen.queryByRole('group', { name: 'Cover Size' })).toBeNull();
});

it('adjusts only the active size and disables its unavailable direction', async () => {
  settings.libraryListScale = 80;
  render(<ViewMenu />);
  const size = within(screen.getByRole('group', { name: 'List Size' }));
  expect(size.getByRole('button', { name: 'Decrease' }).hasAttribute('disabled')).toBe(true);
  fireEvent.click(size.getByRole('button', { name: 'Increase' }));
  await waitFor(() => expect(save).toHaveBeenCalledWith({}, 'libraryListScale', 90));
  expect(save).not.toHaveBeenCalledWith({}, 'libraryColumns', expect.anything());
});

it('preserves URL filters when changing layout and fitting covers', async () => {
  window.history.replaceState(null, '', '/library?q=sample&group=one');
  try {
    render(<ViewMenu />);
    fireEvent.click(screen.getByRole('button', { name: 'Grid' }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith({}, 'q=sample&group=one&view=grid'));
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Book Covers' })).getByRole('button', {
        name: 'Fit',
      }),
    );
    await waitFor(() => expect(save).toHaveBeenCalledWith({}, 'libraryCoverFit', 'fit'));
    expect(navigate).toHaveBeenCalledWith({}, 'q=sample&group=one&cover=fit');
  } finally {
    window.history.replaceState(null, '', '/');
  }
});

it('sizes the grid from its visible automatic columns and plus enlarges covers', async () => {
  settings.libraryViewMode = 'grid';
  const shelf = document.createElement('div');
  shelf.className = 'glossa-collection-grid';
  shelf.style.gridTemplateColumns = '200px 200px 200px 200px 200px';
  document.body.appendChild(shelf);
  try {
    render(<ViewMenu />);
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Cover Size' })).getByRole('button', {
        name: 'Increase',
      }),
    );
    await waitFor(() => expect(save).toHaveBeenCalledWith({}, 'libraryAutoColumns', false));
    expect(save).toHaveBeenCalledWith({}, 'libraryColumns', 4);
  } finally {
    shelf.remove();
  }
});

it('restores automatic sizing and saves skeuomorphic covers and recent reading in existing fields', async () => {
  settings.libraryViewMode = 'grid';
  settings.libraryAutoColumns = false;
  render(<ViewMenu />);
  fireEvent.click(screen.getByRole('button', { name: 'Auto', pressed: false }));
  await waitFor(() => expect(save).toHaveBeenCalledWith({}, 'libraryAutoColumns', true));
  fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Skeuomorphic Book Covers - OFF' }));
  await waitFor(() => expect(save).toHaveBeenCalledWith({}, 'librarySkeuomorphicCovers', true));
  fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Continue reading - ON' }));
  await waitFor(() => expect(save).toHaveBeenCalledWith({}, 'libraryRecentShelfEnabled', false));
});

it('preserves effective secondary sorting inside one disclosure', async () => {
  settings.libraryGroupBy = 'author';
  render(<ViewMenu />);
  const details = screen.getByRole('button', { name: 'Sort by' }).closest('details')!;
  details.open = true;
  const sort = within(details);
  expect((sort.getByRole('combobox', { name: 'Then by...' }) as HTMLSelectElement).value).toBe(
    'series',
  );
  expect(sort.getByRole('option', { name: 'Series (Auto)' })).toBeTruthy();
  fireEvent.change(sort.getByRole('combobox', { name: 'Then by...' }), {
    target: { value: 'title' },
  });
  await waitFor(() => expect(save).toHaveBeenCalledWith({}, 'libraryThenSortBy', 'title'));
  fireEvent.change(sort.getByRole('combobox', { name: 'Sort by' }), {
    target: { value: 'author' },
  });
  await waitFor(() => expect(save).toHaveBeenCalledWith({}, 'librarySortByAuto', false));
});

it('opens global appearance in the existing settings panel and closes this menu', () => {
  const close = vi.fn();
  render(<ViewMenu setIsDropdownOpen={close} />);
  fireEvent.click(screen.getByRole('menuitem', { name: 'Theme & Background' }));
  expect(openSettings).toHaveBeenCalledWith('application', '', 'Theme');
  expect(close).toHaveBeenCalledWith(false);
});
