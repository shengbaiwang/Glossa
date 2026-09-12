import { useEffect } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Notebook from '@/app/reader/components/notebook/Notebook';
import { useNotebookStore } from '@/store/notebookStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { eventDispatcher } from '@/utils/event';
import type { BookNote } from '@/types/book';

const mocks = vi.hoisted(() => ({
  pinned: false,
  language: 'en',
  rtl: false,
  format: 'EPUB',
  saveSysSettings: vi.fn(),
  guideUnmount: vi.fn(),
  notes: [] as BookNote[],
}));

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
vi.mock('@/hooks/useResponsiveSize', () => ({ useResponsiveSize: (size: number) => size }));
vi.mock('@/hooks/useShortcuts', () => ({ default: vi.fn() }));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {}, appService: { isMobile: false } }),
}));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({
    settings: { globalReadSettings: { notebookWidth: '30%', isNotebookPinned: mocks.pinned } },
  }),
}));
vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => ({ updateAppTheme: vi.fn(), safeAreaInsets: {}, systemUIVisible: false }),
}));
vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({
    getBookData: (key: string) => ({
      book: { hash: key.split('-')[0], format: mocks.format, title: key },
      bookDoc: { metadata: { language: [mocks.language] }, toc: [] },
    }),
    getConfig: () => ({ booknotes: mocks.notes }),
    saveConfig: vi.fn(),
    updateBooknotes: vi.fn(),
  }),
}));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({
    getView: () => null,
    getViewsById: () => [],
    getProgress: () => ({ page: 1 }),
    getViewSettings: () => ({ rtl: mocks.rtl }),
  }),
}));
vi.mock('@/utils/book', () => ({ getBookDirFromLanguage: () => (mocks.rtl ? 'rtl' : 'ltr') }));
vi.mock('@/utils/misc', () => ({ uniqueId: () => 'new-note' }));
vi.mock('@/helpers/settings', () => ({ saveSysSettings: mocks.saveSysSettings }));
vi.mock('@/app/reader/utils/annotatorUtil', () => ({
  findAnnotationAtCfi: vi.fn(),
  removeBookNoteOverlays: vi.fn(),
  removeEmptyAnnotationPlaceholder: vi.fn(),
  filterBooknotes: () => [],
}));
vi.mock('@/glossa/ui/ReadingGuidePanel', () => ({
  default: ({ bookKey }: { bookKey: string }) => {
    useEffect(() => () => mocks.guideUnmount(bookKey), [bookKey]);
    return (
      <div>
        <p>Guide for {bookKey}</p>
        <button type='button' onClick={() => eventDispatcher.dispatch('navigate')}>
          View source
        </button>
      </div>
    );
  },
}));
vi.mock('@/glossa/ui/ConversationPanel', () => ({
  default: () => <div>Conversation panel</div>,
}));

const editNote: BookNote = {
  id: 'note-1',
  type: 'annotation',
  cfi: 'epubcfi(/6/2)',
  text: 'Original excerpt',
  note: 'Existing thought',
  createdAt: 1,
  updatedAt: 1,
};

beforeEach(() => {
  mocks.pinned = false;
  mocks.rtl = false;
  mocks.format = 'EPUB';
  mocks.notes = [];
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1200 });
  useNotebookStore.setState(useNotebookStore.getInitialState());
  useSidebarStore.setState({ sideBarBookKey: 'first-0' });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  document.documentElement.dir = '';
  document.documentElement.style.direction = '';
});

const openNotebook = async () => {
  render(<Notebook />);
  act(() => useNotebookStore.getState().setNotebookVisible(true));
  await screen.findByRole('tab', { name: 'Guide' });
};

describe('Notebook reading guide integration', () => {
  it('opens conversation beside the book and keeps it open when navigating to a source', async () => {
    await openNotebook();
    fireEvent.click(screen.getByRole('tab', { name: 'Conversation' }));
    await screen.findByText('Conversation panel');
    expect(screen.getByRole('group', { name: 'Notebook' }).style.position).toBe('relative');
    expect(document.querySelector('.overlay')).toBeNull();
    await act(() => eventDispatcher.dispatch('navigate'));
    expect(useNotebookStore.getState().isNotebookVisible).toBe(true);
    fireEvent.click(screen.getByRole('tab', { name: 'Guide' }));
    expect(screen.queryByText('Conversation panel')).toBeNull();
  });

  it('opens a new annotation in excerpts and preserves its draft when returning from the guide', async () => {
    await openNotebook();
    await screen.findByText('Guide for first-0');
    act(() =>
      useNotebookStore.getState().setNotebookNewAnnotation({
        key: 'selection',
        text: 'Selected words',
        page: 1,
        range: new Range(),
        index: 0,
        cfi: 'epubcfi(/6/2)',
      }),
    );
    expect(screen.getByRole('tab', { name: 'Excerpts' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    fireEvent.change(screen.getByRole('textbox', { name: '' }), { target: { value: 'New idea' } });
    fireEvent.click(screen.getByRole('tab', { name: 'Guide' }));
    expect(useNotebookStore.getState().notebookNewAnnotation?.text).toBe('Selected words');
    fireEvent.click(screen.getByRole('tab', { name: 'Excerpts' }));
    expect((screen.getByRole('textbox', { name: '' }) as HTMLTextAreaElement).value).toBe(
      'New idea',
    );
  });

  it('opens the guide by default, keeps sources visible and cancels the guide when switching to excerpts', async () => {
    await openNotebook();
    await screen.findByText('Guide for first-0');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'View source' })));
    expect(useNotebookStore.getState().isNotebookVisible).toBe(true);
    act(() => useNotebookStore.getState().setNotebookEditAnnotation({ ...editNote }));
    expect(screen.getByRole('tab', { name: 'Excerpts' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    const editor = screen.getByRole('textbox', { name: '' });
    fireEvent.change(editor, { target: { value: 'Unfinished thought' } });
    fireEvent.click(screen.getByRole('tab', { name: 'Guide' }));
    expect(await screen.findByText('Guide for first-0')).toBeTruthy();
    expect(mocks.guideUnmount).toHaveBeenCalledWith('first-0');
    fireEvent.click(screen.getByRole('tab', { name: 'Excerpts' }));
    expect((screen.getByRole('textbox', { name: '' }) as HTMLTextAreaElement).value).toBe(
      'Unfinished thought',
    );
  });

  it('isolates book content and clears an editor when switching books', async () => {
    await openNotebook();
    await screen.findByText('Guide for first-0');
    act(() => useNotebookStore.getState().setNotebookEditAnnotation({ ...editNote }));
    act(() => useSidebarStore.getState().setSideBarBookKey('second-0'));
    expect(useNotebookStore.getState().notebookEditAnnotation).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Guide' }));
    expect(await screen.findByText('Guide for second-0')).toBeTruthy();
    expect(screen.queryByText('Guide for first-0')).toBeNull();
    expect(mocks.guideUnmount).toHaveBeenCalledWith('first-0');
    expect(screen.queryByText('Original excerpt')).toBeNull();
  });

  it('keeps excerpt navigation dismissal and respects pinning, including Escape', async () => {
    await openNotebook();
    fireEvent.click(screen.getByRole('tab', { name: 'Excerpts' }));
    await act(() => eventDispatcher.dispatch('navigate'));
    expect(useNotebookStore.getState().isNotebookVisible).toBe(false);
    act(() => useNotebookStore.getState().setNotebookVisible(true));
    fireEvent.click(screen.getByRole('button', { name: 'Pin Notebook' }));
    expect(mocks.saveSysSettings).toHaveBeenCalled();
    await act(() => eventDispatcher.dispatch('navigate'));
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Excerpts' }), { key: 'Escape' });
    expect(useNotebookStore.getState().isNotebookVisible).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Unpin Notebook' }));
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Excerpts' }), { key: 'Escape' });
    expect(useNotebookStore.getState().isNotebookVisible).toBe(false);
  });

  it('supports RTL tab navigation and width controls', async () => {
    // Notebook chrome follows the interface direction even for an LTR book.
    document.documentElement.dir = 'rtl';
    document.documentElement.style.direction = 'rtl';
    await openNotebook();
    const reading = screen.getByRole('tab', { name: 'Guide' });
    fireEvent.keyDown(reading, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Excerpts' }));
    fireEvent.keyDown(document.activeElement!, { key: 'Home' });
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Conversation' }));
    fireEvent.keyDown(reading, { key: 'End' });
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Excerpts' }));
    const slider = screen.getByRole('slider', { name: 'Resize Notebook' });
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(parseFloat(useNotebookStore.getState().notebookWidth)).toBeGreaterThan(30);
    expect(slider.classList.contains('-start-2')).toBe(true);
    for (let index = 0; index < 20; index++) fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(useNotebookStore.getState().notebookWidth).toBe('45%');
    expect(screen.getByRole('group', { name: 'Notebook' }).classList.contains('end-0')).toBe(true);
  });

  it('adapts a pinned desktop panel to a dismissible full-width narrow view', async () => {
    mocks.pinned = true;
    await openNotebook();
    act(() => {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
      window.dispatchEvent(new Event('resize'));
    });
    const panel = screen.getByRole('group', { name: 'Notebook' });
    expect(panel.style.width).toBe('100%');
    expect(panel.style.position).toBe('fixed');
    expect(document.querySelector('.overlay')).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Guide' }), { key: 'Escape' });
    expect(useNotebookStore.getState().isNotebookVisible).toBe(false);
  });

  it('retains the original notebook for unsupported formats', () => {
    mocks.format = 'PDF';
    render(<Notebook />);
    act(() => useNotebookStore.getState().setNotebookVisible(true));
    expect(screen.queryByRole('tab', { name: 'Guide' })).toBeNull();
    expect(screen.getByText('No Notes')).toBeTruthy();
  });
});
