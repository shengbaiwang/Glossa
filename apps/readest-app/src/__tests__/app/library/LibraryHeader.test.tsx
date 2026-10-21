import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import LibraryHeader from '@/app/library/components/LibraryHeader';
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
vi.mock('@/store/libraryStore', () => ({ useLibraryStore: () => ({ currentBookshelf: [] }) }));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({
    settings: { libraryViewMode: 'grid', libraryAutoColumns: true, libraryColumns: 4 },
    openSettingsDialog: vi.fn(),
  }),
}));

afterEach(cleanup);

const importBooks = vi.fn();

function LibraryToolbar({ selecting = false }: { selecting?: boolean }) {
  const [isSelectMode, setSelectMode] = useState(selecting);
  const [isSelectAll, setSelectAll] = useState(false);
  return (
    <DropdownProvider>
      <LibraryHeader
        isSelectMode={isSelectMode}
        isSelectAll={isSelectAll}
        onToggleSelectMode={() => setSelectMode(!isSelectMode)}
        onSelectAll={() => setSelectAll(true)}
        onDeselectAll={() => setSelectAll(false)}
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

it('preserves select all, deselect and done for selection entered from the bookshelf', () => {
  render(<LibraryToolbar selecting />);
  fireEvent.click(screen.getByRole('button', { name: 'Select All' }));
  fireEvent.click(screen.getByRole('button', { name: 'Deselect' }));
  expect(screen.getByRole('button', { name: 'Select All' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Done' }));
  const menu = screen.getByRole('button', { name: 'Library Display' });
  fireEvent.click(menu);
  expect(menu.getAttribute('aria-expanded')).toBe('true');
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

it('opens import from the toolbar anchor and hides it during book selection', () => {
  render(<LibraryToolbar />);
  const button = screen.getByRole('button', { name: 'Import Books' });
  fireEvent.click(button);
  expect(importBooks).toHaveBeenCalledWith(button);
  cleanup();
  render(<LibraryToolbar selecting />);
  expect(screen.queryByRole('button', { name: 'Import Books' })).toBeNull();
});
