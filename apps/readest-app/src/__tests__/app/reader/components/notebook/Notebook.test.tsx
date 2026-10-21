import { useEffect } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Notebook from '@/app/reader/components/notebook/Notebook';
import { useNotebookStore } from '@/store/notebookStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { DropdownProvider } from '@/context/DropdownContext';
import { eventDispatcher } from '@/utils/event';
import type { BookNote } from '@/types/book';

const mocks = vi.hoisted(() => ({
  language: 'en',
  rtl: false,
  format: 'EPUB',
  officialModules: {} as { conversation?: boolean; mindmap?: boolean },
  mindmapUnmount: vi.fn(),
  conversationUnmount: vi.fn(),
  saveConfig: vi.fn(),
  updateBooknotes: vi.fn((_: string, notes: BookNote[]) => ({ booknotes: notes })),
  bubbleTransition: vi.fn(),
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
    settings: {
      globalReadSettings: { notebookWidth: '30%' },
      officialModules: mocks.officialModules,
    },
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
    saveConfig: mocks.saveConfig,
    updateBooknotes: mocks.updateBooknotes,
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
vi.mock('@/app/reader/utils/annotatorUtil', () => ({
  applyNoteBubbleTransition: mocks.bubbleTransition,
  decideNoteBubbleTransition: vi.fn(() => 'remove'),
  findAnnotationAtCfi: (notes: BookNote[], cfi: string) =>
    notes.findIndex((note) => note.cfi === cfi && !note.deletedAt),
  removeBookNoteOverlays: vi.fn(),
  removeEmptyAnnotationPlaceholder: vi.fn(),
  filterBooknotes: () => [],
}));
vi.mock('@/glossa/ui/ConversationPanel', () => ({
  default: ({ bookKey }: { bookKey: string }) => {
    useEffect(() => () => mocks.conversationUnmount(bookKey), [bookKey]);
    return (
      <div>
        <p>Conversation panel</p>
        <p>Conversation for {bookKey}</p>
        <button type='button' onClick={() => eventDispatcher.dispatch('navigate')}>
          View source
        </button>
      </div>
    );
  },
}));
vi.mock('@/app/reader/components/sidebar/BooknoteView', () => ({
  default: ({
    bookKey,
    noteEditor,
  }: {
    bookKey: string;
    noteEditor?: { id: string; content: React.ReactNode };
  }) => (
    <div>
      Annotations for {bookKey}
      {noteEditor?.content}
    </div>
  ),
}));
vi.mock('@/glossa/ui/MindmapPanel', () => ({
  default: ({ onAsk }: { onAsk?: () => void }) => {
    useEffect(() => () => mocks.mindmapUnmount(), []);
    return <div>Mind map panel{onAsk && <button onClick={onAsk}>Ask about idea</button>}</div>;
  },
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
  mocks.rtl = false;
  mocks.format = 'EPUB';
  mocks.officialModules = {};
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
  render(
    <DropdownProvider>
      <Notebook />
    </DropdownProvider>,
  );
  act(() => useNotebookStore.getState().setNotebookVisible(true));
  await screen.findByRole('tab', { name: 'Conversation' });
};

describe('Notebook reading assistant integration', () => {
  it('shows existing annotations in the right notes workspace instead of an empty state', async () => {
    mocks.notes = [editNote];
    await openNotebook();
    fireEvent.click(screen.getByRole('tab', { name: 'Notes' }));
    expect(screen.getByText('Annotations for first-0')).toBeTruthy();
    expect(screen.queryByText('No Notes')).toBeNull();
  });
  it('uses one destination row, with pane actions separate from the active reading tool', async () => {
    await openNotebook();
    const tabs = screen.getByRole('tablist', { name: 'Notebook' });
    const header = document.querySelector('.notebook-header');
    expect(header?.contains(tabs)).toBe(true);
    expect(screen.queryByRole('heading', { name: 'Conversation' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'View Options' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Pin Notebook' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Show Search Bar' })).toBeNull();
    expect(header?.contains(screen.getByRole('button', { name: 'Close' }))).toBe(true);
    fireEvent.click(screen.getByRole('tab', { name: 'Notes' }));
    const search = screen.getByRole('button', { name: 'Show Search Bar' });
    expect(header?.contains(search)).toBe(false);
    expect(screen.queryByText('Capture an idea as you read')).toBeNull();
  });

  it('keeps one active tab and its controlled panel as keyboard navigation changes tools', async () => {
    await openNotebook();
    const conversation = screen.getByRole('tab', { name: 'Conversation' });
    fireEvent.keyDown(conversation, { key: 'ArrowRight' });
    const map = screen.getByRole('tab', { name: 'Mind map' });
    expect(document.activeElement).toBe(map);
    expect(map.getAttribute('aria-selected')).toBe('true');
    expect(conversation.getAttribute('aria-selected')).toBe('false');
    expect(conversation.tabIndex).toBe(-1);
    const activePanel = screen.getByRole('tabpanel', { name: 'Mind map' });
    expect(map.getAttribute('aria-controls')).toBe(activePanel.id);
    fireEvent.click(map);
    expect(useNotebookStore.getState().isNotebookVisible).toBe(true);
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1);
  });

  it('closes the docked panel directly with Escape', async () => {
    await openNotebook();
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Conversation' }), { key: 'Escape' });
    expect(useNotebookStore.getState().isNotebookVisible).toBe(false);
  });

  it('presents named icon destinations without visible text labels', async () => {
    await openNotebook();
    for (const name of ['Conversation', 'Mind map', 'Notes']) {
      const tab = screen.getByRole('tab', { name });
      expect(tab.textContent).toBe('');
      expect(tab.querySelector('svg')).toBeTruthy();
      expect(tab.title).toBe(name);
    }
  });

  it('removes the guide tab and opens conversation by default', async () => {
    await openNotebook();
    expect(screen.queryByRole('tab', { name: 'Guide' })).toBeNull();
    expect(screen.getByRole('tab', { name: 'Conversation' }).getAttribute('aria-selected')).toBe(
      'true',
    );
  });

  it('opens conversation beside the book and keeps it open when navigating to a source', async () => {
    await openNotebook();
    fireEvent.click(screen.getByRole('tab', { name: 'Conversation' }));
    await screen.findByText('Conversation panel');
    expect(screen.getByRole('group', { name: 'Notebook' }).style.position).toBe('relative');
    expect(document.querySelector('.overlay')).toBeNull();
    await act(() => eventDispatcher.dispatch('navigate'));
    expect(useNotebookStore.getState().isNotebookVisible).toBe(true);
    fireEvent.click(screen.getByRole('tab', { name: 'Notes' }));
    expect(screen.queryByText('Conversation panel')).toBeNull();
  });

  it('opens the mind map beside the book and keeps it visible during source navigation', async () => {
    await openNotebook();
    fireEvent.click(screen.getByRole('tab', { name: 'Mind map' }));
    await screen.findByText('Mind map panel');
    const panel = screen.getByRole('group', { name: 'Notebook' });
    expect(panel.style.position).toBe('relative');
    await act(() => eventDispatcher.dispatch('navigate'));
    expect(useNotebookStore.getState().isNotebookVisible).toBe(true);
    fireEvent.click(screen.getByRole('tab', { name: 'Conversation' }));
    expect(screen.queryByText('Mind map panel')).toBeNull();
  });

  it('opens a new annotation in excerpts and preserves its draft when returning from conversation', async () => {
    await openNotebook();
    await screen.findByText('Conversation for first-0');
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
    expect(screen.getByRole('tab', { name: 'Notes' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.change(screen.getByRole('textbox', { name: '' }), { target: { value: 'New idea' } });
    fireEvent.click(screen.getByRole('tab', { name: 'Conversation' }));
    expect(useNotebookStore.getState().notebookNewAnnotation?.text).toBe('Selected words');
    fireEvent.click(screen.getByRole('tab', { name: 'Notes' }));
    expect((screen.getByRole('textbox', { name: '' }) as HTMLTextAreaElement).value).toBe(
      'New idea',
    );
  });

  it('opens conversation by default, keeps sources visible and cancels conversation when switching to excerpts', async () => {
    await openNotebook();
    await screen.findByText('Conversation for first-0');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'View source' })));
    expect(useNotebookStore.getState().isNotebookVisible).toBe(true);
    act(() => useNotebookStore.getState().setNotebookEditAnnotation({ ...editNote }));
    expect(screen.getByRole('tab', { name: 'Notes' }).getAttribute('aria-selected')).toBe('true');
    const editor = screen.getByRole('textbox', { name: '' });
    fireEvent.change(editor, { target: { value: 'Unfinished thought' } });
    fireEvent.click(screen.getByRole('tab', { name: 'Conversation' }));
    expect(await screen.findByText('Conversation for first-0')).toBeTruthy();
    expect(mocks.conversationUnmount).toHaveBeenCalledWith('first-0');
    fireEvent.click(screen.getByRole('tab', { name: 'Notes' }));
    expect((screen.getByRole('textbox', { name: '' }) as HTMLTextAreaElement).value).toBe(
      'Unfinished thought',
    );
  });

  it('isolates book content and clears an editor when switching books', async () => {
    await openNotebook();
    await screen.findByText('Conversation for first-0');
    act(() => useNotebookStore.getState().setNotebookEditAnnotation({ ...editNote }));
    act(() => useSidebarStore.getState().setSideBarBookKey('second-0'));
    expect(useNotebookStore.getState().notebookEditAnnotation).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Conversation' }));
    expect(await screen.findByText('Conversation for second-0')).toBeTruthy();
    expect(screen.queryByText('Conversation for first-0')).toBeNull();
    expect(mocks.conversationUnmount).toHaveBeenCalledWith('first-0');
    expect(screen.queryByText('Original excerpt')).toBeNull();
  });

  it('stays docked beside the text when following sources on wide windows', async () => {
    await openNotebook();
    fireEvent.click(screen.getByRole('tab', { name: 'Notes' }));
    expect(screen.getByRole('group', { name: 'Notebook' }).style.position).toBe('relative');
    expect(document.querySelector('.overlay')).toBeNull();
    await act(() => eventDispatcher.dispatch('navigate'));
    expect(useNotebookStore.getState().isNotebookVisible).toBe(true);
  });

  it('supports RTL tab navigation and width controls', async () => {
    // Notebook chrome follows the interface direction even for an LTR book.
    document.documentElement.dir = 'rtl';
    document.documentElement.style.direction = 'rtl';
    await openNotebook();
    const reading = screen.getByRole('tab', { name: 'Conversation' });
    fireEvent.keyDown(reading, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Mind map' }));
    fireEvent.keyDown(document.activeElement!, { key: 'Home' });
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Conversation' }));
    fireEvent.keyDown(reading, { key: 'End' });
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Notes' }));
    const slider = screen.getByRole('slider', { name: 'Resize Notebook' });
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(parseFloat(useNotebookStore.getState().notebookWidth)).toBeGreaterThan(30);
    expect(slider.classList.contains('-start-2')).toBe(true);
    for (let index = 0; index < 20; index++) fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(useNotebookStore.getState().notebookWidth).toBe('45%');
    expect(screen.getByRole('group', { name: 'Notebook' }).classList.contains('end-0')).toBe(true);
  });

  it('adapts to a dismissible full-width sheet on narrow windows', async () => {
    await openNotebook();
    act(() => {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
      window.dispatchEvent(new Event('resize'));
    });
    const panel = screen.getByRole('group', { name: 'Notebook' });
    expect(panel.style.width).toBe('100%');
    expect(panel.style.position).toBe('fixed');
    expect(document.querySelector('.overlay')).toBeTruthy();
    // Following a source dismisses the sheet so the destination is visible.
    act(() => useNotebookStore.getState().setNotebookVisible(true));
    await act(() => eventDispatcher.dispatch('navigate'));
    expect(useNotebookStore.getState().isNotebookVisible).toBe(false);
    act(() => useNotebookStore.getState().setNotebookVisible(true));
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Conversation' }), { key: 'Escape' });
    expect(useNotebookStore.getState().isNotebookVisible).toBe(false);
  });

  it('retains the original notebook for unsupported formats', () => {
    mocks.format = 'PDF';
    render(<Notebook />);
    act(() => useNotebookStore.getState().setNotebookVisible(true));
    expect(screen.queryByRole('tab', { name: 'Conversation' })).toBeNull();
    expect(screen.getByText('No Notes')).toBeTruthy();
  });
});

it('keeps annotations visible while editing and preserves the original page when clearing a note', async () => {
  mocks.notes = [{ ...editNote, page: 42, style: 'highlight' }];
  await openNotebook();
  act(() => useNotebookStore.getState().setNotebookEditAnnotation({ ...mocks.notes[0]! }));
  expect(screen.getByText('Annotations for first-0')).toBeTruthy();
  expect(screen.getByText('Original excerpt')).toBeTruthy();
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(mocks.notes[0]).toMatchObject({ page: 42, note: '', style: 'highlight' });
  expect(mocks.updateBooknotes).toHaveBeenCalled();
  expect(mocks.saveConfig).toHaveBeenCalled();
  expect(mocks.bubbleTransition).toHaveBeenCalled();
  expect(useNotebookStore.getState().notebookEditAnnotation).toBeNull();
  expect(screen.getByText('Annotations for first-0')).toBeTruthy();
});

it('saves one cross-page note with the first anchor and both fragments, even after its frames leave', async () => {
  await openNotebook();
  const first = 'epubcfi(/6/2!/4/2,/1:0,/1:5)';
  const second = 'epubcfi(/6/4!/4/2,/1:0,/1:4)';
  mocks.notes = [{ ...editNote, cfi: first, pdfRanges: [first, second], text: 'Alpha\nBeta' }];
  act(() =>
    useNotebookStore.getState().setNotebookNewAnnotation({
      key: 'first-0',
      cfi: first,
      pdfRanges: [first, second],
      text: 'Alpha\nBeta',
      page: 1,
      index: 1,
      range: document.createRange(),
    }),
  );
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Both pages matter' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(mocks.updateBooknotes).toHaveBeenCalledWith('first-0', [
    expect.objectContaining({
      cfi: first,
      pdfRanges: [first, second],
      text: 'Alpha\nBeta',
      note: 'Both pages matter',
    }),
  ]);
});

describe('official reading modules', () => {
  it('unmounts a disabled active module and keeps keyboard navigation on available tabs', async () => {
    const panel = render(
      <DropdownProvider>
        <Notebook />
      </DropdownProvider>,
    );
    act(() => useNotebookStore.getState().setNotebookVisible(true));
    await screen.findByText('Conversation panel');
    mocks.officialModules = { conversation: false };
    panel.rerender(
      <DropdownProvider>
        <Notebook />
      </DropdownProvider>,
    );
    await screen.findByText('Mind map panel');
    expect(mocks.conversationUnmount).toHaveBeenCalledWith('first-0');
    expect(screen.queryByRole('tab', { name: 'Conversation' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Ask about idea' })).toBeNull();
    expect(useNotebookStore.getState().notebookActiveTab).toBe('mindmap');
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Mind map' }), { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Notes' }).getAttribute('aria-selected')).toBe('true');
  });

  it('retains notes when both modules are disabled and can reopen a reenabled module', async () => {
    mocks.notes = [editNote];
    const panel = render(
      <DropdownProvider>
        <Notebook />
      </DropdownProvider>,
    );
    act(() => useNotebookStore.getState().setNotebookVisible(true));
    await screen.findByText('Conversation panel');
    fireEvent.click(screen.getByRole('tab', { name: 'Mind map' }));
    await screen.findByText('Mind map panel');
    mocks.officialModules = { conversation: false, mindmap: false };
    panel.rerender(
      <DropdownProvider>
        <Notebook />
      </DropdownProvider>,
    );
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.getByText('Annotations for first-0')).toBeTruthy();
    expect(mocks.mindmapUnmount).toHaveBeenCalledOnce();
    expect(useNotebookStore.getState().notebookActiveTab).toBe('notes');
    mocks.officialModules = { conversation: true, mindmap: false };
    panel.rerender(
      <DropdownProvider>
        <Notebook />
      </DropdownProvider>,
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Conversation' }));
    await screen.findByText('Conversation for first-0');
    expect(screen.queryByRole('tab', { name: 'Mind map' })).toBeNull();
    expect(mocks.notes).toEqual([editNote]);
  });
});
