import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import LibraryHeader from '@/app/library/components/LibraryHeader';
import { eventDispatcher } from '@/utils/event';
import { DropdownProvider } from '@/context/DropdownContext';

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
const selection = vi.hoisted(() => ({ ids: new Set<string>(), clear: vi.fn() }));
vi.mock('@/store/libraryStore', () => ({
  useLibraryStore: () => ({
    currentBookshelf: [],
    selectedBooks: selection.ids,
    setSelectedBooks: selection.clear,
  }),
}));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({
    settings: { libraryViewMode: 'grid', libraryAutoColumns: true, libraryColumns: 4 },
    openSettingsDialog: vi.fn(),
  }),
}));

beforeEach(() => {
  selection.ids = new Set();
  selection.clear.mockReset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const importBooks = vi.fn();

function LibraryToolbar() {
  return (
    <DropdownProvider>
      <LibraryHeader
        onImportBooks={importBooks}
        onPullLibrary={vi.fn()}
        searchQuery=''
        searchTarget='books'
        searchConfig={{ scope: 'book', mode: 'contains', matchCase: false, matchDiacritics: false }}
        onSearchConfigChange={vi.fn()}
        onSearchQueryChange={vi.fn()}
        onSearchTargetChange={vi.fn()}
      />
    </DropdownProvider>
  );
}

it('offers display options without a book selection command', () => {
  render(<LibraryToolbar />);
  fireEvent.click(screen.getByRole('button', { name: 'Library Display' }));
  expect(screen.queryByRole('menuitem', { name: 'Select Books' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Done' })).toBeNull();
});

it('shows actions for actual selections without the old select-all controls', () => {
  selection.ids = new Set(['a', 'b']);
  render(<LibraryToolbar />);
  expect(screen.queryByRole('button', { name: 'Select All' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Deselect' })).toBeNull();
  expect(screen.getByRole('button', { name: '{{count}} selected' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Library Display' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Clear Selection' }));
  expect(selection.clear).toHaveBeenCalledWith([]);
});

it('dismisses the view menu without entering selection mode', () => {
  render(<LibraryToolbar />);
  const menu = screen.getByRole('button', { name: 'Library Display' });
  fireEvent.click(menu);
  fireEvent.keyDown(menu, { key: 'Escape' });
  expect(menu.getAttribute('aria-expanded')).toBe('false');
  expect(screen.queryByRole('button', { name: 'Done' })).toBeNull();
});

it('labels the display grid alongside the global settings gear', () => {
  render(<LibraryToolbar />);
  const settings = screen.getByRole('button', { name: 'Settings' });
  expect(settings.querySelector('svg')?.classList.contains('lucide-settings')).toBe(true);
  expect(
    screen.getByRole('button', { name: 'Library Display' }).querySelector('rect'),
  ).toBeTruthy();
});

it('keeps import and display available while books are selected', () => {
  selection.ids = new Set(['a', 'b']);
  render(<LibraryToolbar />);
  const button = screen.getByRole('button', { name: 'Import Books' });
  fireEvent.click(button);
  expect(importBooks).toHaveBeenCalledWith(button);
  expect(screen.getByRole('button', { name: 'Library Display' })).toBeTruthy();
});

it('keeps only move and delete in the selected-count menu for touch and keyboard access', () => {
  const dispatch = vi.spyOn(eventDispatcher, 'dispatch').mockResolvedValue();
  selection.ids = new Set(['a', 'b']);
  render(<LibraryToolbar />);
  fireEvent.click(screen.getByRole('button', { name: '{{count}} selected' }));
  expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
    'Move to…',
    'Delete',
  ]);
  fireEvent.click(screen.getByRole('menuitem', { name: 'Move to…' }));
  expect(dispatch).toHaveBeenCalledWith('library-move-selection');
  fireEvent.click(screen.getByRole('button', { name: '{{count}} selected' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
  expect(dispatch).toHaveBeenCalledWith('library-delete-selection');
});

it('clears a selection with Escape from a closed toolbar control', () => {
  selection.ids = new Set(['a', 'b']);
  render(<LibraryToolbar />);
  fireEvent.keyDown(screen.getByRole('button', { name: '{{count}} selected' }), {
    key: 'Escape',
  });
  expect(selection.clear).toHaveBeenCalledWith([]);
});

it('lets an open dropdown handle Escape before clearing the selection', () => {
  selection.ids = new Set(['a', 'b']);
  render(<LibraryToolbar />);
  const menu = screen.getByRole('button', { name: '{{count}} selected' });
  fireEvent.click(menu);
  fireEvent.keyDown(menu, { key: 'Escape' });
  expect(menu.getAttribute('aria-expanded')).toBe('false');
  expect(selection.clear).not.toHaveBeenCalled();
});
