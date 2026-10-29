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
    libraryRecentShelfEnabled: true,
    libraryCoverWidth: undefined as number | undefined,
    libraryShowAuthor: undefined as boolean | undefined,
    libraryShowProgress: undefined as boolean | undefined,
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
    libraryRecentShelfEnabled: true,
    libraryCoverWidth: undefined,
    libraryShowAuthor: undefined,
    libraryShowProgress: undefined,
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
  expect(screen.queryByText('Library Display')).toBeNull();
  expect(screen.queryByRole('group', { name: 'Cover display' })).toBeNull();
  expect(screen.getByRole('checkbox', { name: 'Recent reading' })).toBeTruthy();
  expect(screen.queryByRole('group', { name: 'Cover Size' })).toBeNull();
});

it('adjusts only the current list size with a bounded slider', async () => {
  settings.libraryListScale = 80;
  render(<ViewMenu />);
  const slider = screen.getByRole('slider', { name: 'List Size' });
  expect(slider.getAttribute('min')).toBe('80');
  expect(slider.getAttribute('max')).toBe('140');
  fireEvent.change(slider, { target: { value: '90' } });
  await waitFor(() => expect(save).toHaveBeenCalledWith({}, 'libraryListScale', 90));
  expect(save).not.toHaveBeenCalledWith({}, 'libraryColumns', expect.anything());
});

it('preserves URL filters when changing layout and fitting covers', async () => {
  settings.libraryViewMode = 'grid';
  window.history.replaceState(null, '', '/library?q=sample&group=one');
  try {
    render(<ViewMenu />);
    fireEvent.click(screen.getByRole('button', { name: 'List' }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith({}, 'q=sample&group=one&view=list'));
    fireEvent.click(screen.getByRole('button', { name: 'Show full cover' }));
    await waitFor(() => expect(save).toHaveBeenCalledWith({}, 'libraryCoverFit', 'fit'));
    expect(navigate).toHaveBeenCalledWith({}, 'q=sample&group=one&cover=fit');
  } finally {
    window.history.replaceState(null, '', '/');
  }
});

it('starts from visible cover width and saves size independently of column count', async () => {
  settings.libraryViewMode = 'grid';
  const shelf = document.createElement('div');
  shelf.className = 'glossa-collection-grid';
  shelf.style.gridTemplateColumns = '200px 200px 200px 200px 200px';
  document.body.appendChild(shelf);
  try {
    render(<ViewMenu />);
    const slider = screen.getByRole('slider', { name: 'Cover Size' });
    expect((slider as HTMLInputElement).value).toBe('156');
    fireEvent.change(slider, { target: { value: '220' } });
    expect(save).toHaveBeenCalledWith({}, 'libraryCoverWidth', 220);
    expect(save).not.toHaveBeenCalledWith({}, 'libraryColumns', expect.anything());
  } finally {
    shelf.remove();
  }
});

it('removes automatic sizing and reuses cover and recent reading fields', async () => {
  settings.libraryViewMode = 'grid';
  settings.libraryAutoColumns = false;
  settings.libraryCoverWidth = 220;
  render(<ViewMenu />);
  expect(screen.queryByRole('button', { name: 'Auto' })).toBeNull();
  expect(screen.queryByRole('checkbox', { name: '3D covers' })).toBeNull();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Recent reading' }));
  await waitFor(() => expect(save).toHaveBeenCalledWith({}, 'libraryRecentShelfEnabled', false));
});

it('keeps book information collapsed and defaults old preferences to visible', async () => {
  render(<ViewMenu />);
  const disclosure = screen.getByRole('button', { name: 'Card information' }).closest('details')!;
  expect(disclosure.open).toBe(false);
  disclosure.open = true;
  const info = within(disclosure);
  expect((info.getByRole('checkbox', { name: 'Author' }) as HTMLInputElement).checked).toBe(true);
  expect(
    (info.getByRole('checkbox', { name: 'Reading Progress' }) as HTMLInputElement).checked,
  ).toBe(true);
  fireEvent.click(info.getByRole('checkbox', { name: 'Author' }));
  await waitFor(() => expect(save).toHaveBeenCalledWith({}, 'libraryShowAuthor', false));
  fireEvent.click(info.getByRole('checkbox', { name: 'Reading Progress' }));
  await waitFor(() => expect(save).toHaveBeenCalledWith({}, 'libraryShowProgress', false));
});

it('preserves effective secondary sorting inside one disclosure', async () => {
  settings.libraryGroupBy = 'author';
  render(<ViewMenu />);
  const details = screen.getByRole('button', { name: 'Sort' }).closest('details')!;
  details.open = true;
  const sort = within(details);
  expect((sort.getByRole('combobox', { name: 'Secondary sort' }) as HTMLSelectElement).value).toBe(
    'series',
  );
  expect(sort.getByRole('option', { name: 'Series (Auto)' })).toBeTruthy();
  fireEvent.change(sort.getByRole('combobox', { name: 'Secondary sort' }), {
    target: { value: 'title' },
  });
  await waitFor(() => expect(save).toHaveBeenCalledWith({}, 'libraryThenSortBy', 'title'));
  fireEvent.change(sort.getByRole('combobox', { name: 'Primary sort' }), {
    target: { value: 'author' },
  });
  await waitFor(() => expect(save).toHaveBeenCalledWith({}, 'librarySortByAuto', false));
});

it('keeps appearance in global settings rather than this menu', () => {
  render(<ViewMenu />);
  expect(screen.queryByRole('menuitem', { name: 'Theme & Background' })).toBeNull();
});
