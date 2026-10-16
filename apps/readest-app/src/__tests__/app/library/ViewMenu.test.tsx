import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ViewMenu from '@/app/library/components/ViewMenu';

const { settings, save, navigate } = vi.hoisted(() => ({
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
  },
  save: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({}),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ envConfig: {} }) }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
vi.mock('@/store/settingsStore', () => ({ useSettingsStore: () => ({ settings }) }));
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
  });
  save.mockReset();
  navigate.mockReset();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('places working size controls beside each of the two view choices', async () => {
  render(<ViewMenu onSelectBooks={vi.fn()} />);
  expect(screen.queryByRole('menuitem', { name: 'Columns' })).toBeNull();
  const list = within(screen.getByRole('group', { name: 'List' }));
  const grid = within(screen.getByRole('group', { name: 'Grid' }));
  expect(list.getByRole('button', { name: 'Decrease' }).hasAttribute('disabled')).toBe(false);
  expect(grid.getByRole('button', { name: 'Increase' }).hasAttribute('disabled')).toBe(false);
  fireEvent.click(list.getByRole('button', { name: 'Increase' }));
  await waitFor(() => expect(save).toHaveBeenCalledWith({}, 'libraryListScale', 110));
  expect(save).not.toHaveBeenCalledWith({}, 'libraryColumns', expect.anything());
});

it('keeps grouping in the library navigation and cover choices directly reachable', async () => {
  render(<ViewMenu onSelectBooks={vi.fn()} />);
  expect(screen.queryByRole('button', { name: 'Group by...' })).toBeNull();
  expect(screen.queryByRole('menuitem', { name: 'Book Covers' })).toBeNull();
  const covers = within(screen.getByRole('group', { name: 'Book Covers' }));
  fireEvent.click(covers.getByRole('menuitemcheckbox', { name: 'Fit - OFF' }));
  await waitFor(() => expect(save).toHaveBeenCalledWith({}, 'libraryCoverFit', 'fit'));
  expect(save).not.toHaveBeenCalledWith({}, 'libraryGroupBy', expect.anything());
});

it('shows only the effective secondary sort when authors imply series sorting', async () => {
  settings.libraryGroupBy = 'author';
  render(<ViewMenu onSelectBooks={vi.fn()} />);
  const disclosure = screen.getByRole('button', { name: 'Then by...' });
  const details = disclosure.closest('details')!;
  details.open = true;
  expect(
    within(details)
      .getAllByRole('menuitemcheckbox', { checked: true })
      .map((item) => item.textContent),
  ).toEqual(['Series (Auto)', 'Ascending']);
  fireEvent.click(within(details).getByRole('menuitemcheckbox', { name: 'Title - OFF' }));
  await waitFor(() => expect(save).toHaveBeenCalledWith({}, 'libraryThenSortBy', 'title'));
});

it('starts grid sizing at the visible automatic columns and makes plus enlarge covers', async () => {
  settings.libraryViewMode = 'grid';
  const shelf = document.createElement('div');
  shelf.className = 'glossa-collection-grid';
  shelf.style.gridTemplateColumns = '200px 200px 200px 200px 200px';
  document.body.appendChild(shelf);
  render(<ViewMenu onSelectBooks={vi.fn()} />);
  fireEvent.click(
    within(screen.getByRole('group', { name: 'Grid' })).getByRole('button', { name: 'Increase' }),
  );
  await waitFor(() => expect(save).toHaveBeenCalledWith({}, 'libraryAutoColumns', false));
  expect(save).toHaveBeenCalledWith({}, 'libraryColumns', 4);
  shelf.remove();
});

it('activates the sized view and preserves other library URL parameters', async () => {
  window.history.replaceState(null, '', '/library?q=sample&group=one');
  render(<ViewMenu onSelectBooks={vi.fn()} />);
  fireEvent.click(
    within(screen.getByRole('group', { name: 'Grid' })).getByRole('button', { name: 'Decrease' }),
  );
  await waitFor(() => expect(navigate).toHaveBeenCalledWith({}, 'q=sample&group=one&view=grid'));
  expect(save).toHaveBeenCalledWith({}, 'libraryViewMode', 'grid');
  window.history.replaceState(null, '', '/');
});

it('disables list sizing at its limits and can restore automatic grid sizing', async () => {
  settings.libraryListScale = 80;
  settings.libraryAutoColumns = false;
  render(<ViewMenu onSelectBooks={vi.fn()} />);
  expect(
    within(screen.getByRole('group', { name: 'List' }))
      .getByRole('button', { name: 'Decrease' })
      .hasAttribute('disabled'),
  ).toBe(true);
  fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Grid / Auto' }));
  await waitFor(() => expect(save).toHaveBeenCalledWith({}, 'libraryAutoColumns', true));
});
