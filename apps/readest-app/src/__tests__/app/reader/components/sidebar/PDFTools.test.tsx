import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import PDFTools from '@/app/reader/components/sidebar/PDFTools';
import type { BookDoc } from '@/libs/document';
import { useNotebookStore } from '@/store/notebookStore';
import { useSidebarStore } from '@/store/sidebarStore';

const mocks = vi.hoisted(() => ({
  cache: { id: 'a'.repeat(32), pages: [] as number[], outline: null, revision: 0 },
  start: vi.fn(),
  wait: vi.fn(),
  cancel: vi.fn(),
  save: vi.fn(),
  exportCopy: vi.fn(),
  exportCancel: vi.fn(),
  destination: vi.fn(),
  read: vi.fn(),
  recreate: vi.fn(),
  setConfig: vi.fn(),
  saveConfig: vi.fn(),
  settings: { officialModules: { pdfAutoContents: true } },
  appService: { resolveNativeBookFilePath: vi.fn(async () => '/original.pdf') },
}));
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: mocks.destination }));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {}, appService: mocks.appService }),
}));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: {
    getState: () => ({
      getBookData: () => ({ book: { hash: 'a', format: 'PDF' } }),
      getConfig: () => ({ updatedAt: 1, location: 'old', booknotes: [{ id: 'keep' }] }),
      setConfig: mocks.setConfig,
      saveConfig: mocks.saveConfig,
    }),
  },
}));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: {
    getState: () => ({
      getView: () => ({ lastLocation: { cfi: 'current-page-cfi' }, goTo: vi.fn() }),
      recreateViewer: mocks.recreate,
    }),
  },
}));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: Object.assign(() => ({ settings: mocks.settings }), {
    getState: () => ({ settings: mocks.settings }),
  }),
}));
vi.mock('@/services/pdfEnhancement', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/pdfEnhancement')>()),
  openPDFCache: vi.fn(async () => ({ ...mocks.cache })),
  getPDFOCRStatus: vi.fn(async () => null),
  startPDFOCR: mocks.start,
  waitForPDFOCR: mocks.wait,
  cancelPDFOCR: mocks.cancel,
  savePDFOutline: mocks.save,
  readOCRPage: mocks.read,
  exportPDFCopy: mocks.exportCopy,
  cancelPDFExport: mocks.exportCancel,
}));
const doc = {
  sections: [{}, {}, {}],
  pageList: [{ label: 'i' }, { label: '1' }, { label: '2' }],
  getPDFText: async (index: number) =>
    [
      'Chapter 1 Reading .... 1\nChapter 2 Evidence .... 2',
      'Chapter 1 Reading',
      'Chapter 2 Evidence',
    ][index],
} as unknown as BookDoc;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.settings.officialModules.pdfAutoContents = true;
  mocks.exportCopy.mockReset().mockResolvedValue(undefined);
  mocks.destination.mockReset().mockResolvedValue('/reading-copy.pdf');
  mocks.read.mockReset().mockResolvedValue(null);
  mocks.cache.pages = [];
  mocks.start.mockImplementation(async (_source, _id, pages: number[]) => {
    mocks.cache.pages = pages;
    return {
      cacheId: mocks.cache.id,
      state: 'running',
      completed: 0,
      total: pages.length,
      error: null,
    };
  });
  mocks.wait.mockImplementation(async (_id, _signal, update) => {
    const done = {
      cacheId: mocks.cache.id,
      state: 'completed',
      completed: 3,
      total: 3,
      error: null,
    };
    update(done);
    return done;
  });
  mocks.save.mockImplementation(async (_source, _cache, outline) => ({
    ...mocks.cache,
    outline,
    revision: 1,
  }));
});
afterEach(cleanup);
async function mount(bookDoc = doc) {
  render(<PDFTools bookKey='a-view' bookDoc={bookDoc} />);
  await waitFor(() =>
    expect(
      (screen.getByRole('menuitem', { name: 'Recognize text' }) as HTMLButtonElement).disabled,
    ).toBe(false),
  );
}
it('recognizes and applies on request while preserving current reading location and notes', async () => {
  await mount();
  expect(mocks.start).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('menuitem', { name: 'Recognize text' }));
  await waitFor(() => expect(mocks.recreate).toHaveBeenCalledTimes(1));
  expect(mocks.saveConfig.mock.calls[0]![2]).toMatchObject({
    location: 'current-page-cfi',
    booknotes: [{ id: 'keep' }],
  });
});
it('cancels the native task without applying or removing personal data', async () => {
  mocks.wait.mockImplementation(
    async (_id, signal: AbortSignal) =>
      new Promise((resolve) => {
        signal.addEventListener('abort', () => resolve({ state: 'cancelled' }), { once: true });
      }),
  );
  await mount();
  fireEvent.click(screen.getByRole('menuitem', { name: 'Recognize text' }));
  await screen.findByText('Recognizing text 0/3');
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(mocks.cancel).toHaveBeenCalledWith(mocks.cache.id));
  expect(mocks.recreate).not.toHaveBeenCalled();
  expect(mocks.saveConfig).not.toHaveBeenCalled();
});
it('cancels a task that finishes starting after the user cancelled preparation', async () => {
  let started!: (value: unknown) => void;
  mocks.start.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        started = resolve;
      }),
  );
  await mount();
  fireEvent.click(screen.getByRole('menuitem', { name: 'Recognize text' }));
  await waitFor(() => expect(mocks.start).toHaveBeenCalled());
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  started({ cacheId: mocks.cache.id, state: 'running', completed: 0, total: 3, error: null });
  await waitFor(() => expect(mocks.cancel).toHaveBeenCalledTimes(1));
  expect(mocks.wait).not.toHaveBeenCalled();
  expect(mocks.recreate).not.toHaveBeenCalled();
});

it('exports a separate reading copy only after choosing a destination', async () => {
  await mount();
  expect(mocks.exportCopy).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('menuitem', { name: 'Export reading copy' }));
  await waitFor(() =>
    expect(mocks.exportCopy).toHaveBeenCalledWith(
      '/original.pdf',
      mocks.cache.id,
      '/reading-copy.pdf',
      [],
    ),
  );
  expect(mocks.recreate).not.toHaveBeenCalled();
  expect(mocks.save).not.toHaveBeenCalled();
});
it('does not export when the native save dialog is cancelled', async () => {
  mocks.destination.mockResolvedValueOnce(null);
  await mount();
  fireEvent.click(screen.getByRole('menuitem', { name: 'Export reading copy' }));
  await waitFor(() => expect(mocks.destination).toHaveBeenCalled());
  expect(mocks.exportCopy).not.toHaveBeenCalled();
});
it('keeps the source and personal state intact when exporting fails', async () => {
  mocks.exportCopy.mockRejectedValueOnce(new Error('pdf_export_exists'));
  await mount();
  fireEvent.click(screen.getByRole('menuitem', { name: 'Export reading copy' }));
  await screen.findByRole('alert');
  expect(mocks.recreate).not.toHaveBeenCalled();
  expect(mocks.saveConfig).not.toHaveBeenCalled();
});

it('cancels export independently of text recognition and preserves all records', async () => {
  let finish!: () => void;
  mocks.exportCopy.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  await mount();
  fireEvent.click(screen.getByRole('menuitem', { name: 'Export reading copy' }));
  await screen.findByText('Exporting PDF copy');
  await waitFor(() => expect(mocks.exportCopy).toHaveBeenCalled());
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(mocks.exportCancel).toHaveBeenCalledWith(mocks.cache.id));
  expect(mocks.cancel).not.toHaveBeenCalled();
  expect(mocks.saveConfig).not.toHaveBeenCalled();
  finish();
});

it('offers optional actions without a repair form, saved-pages panel or apply step', async () => {
  await mount();
  expect(screen.queryByRole('button', { name: 'Repair contents' })).toBeNull();
  expect(screen.queryByRole('spinbutton')).toBeNull();
  expect(screen.queryByText('Saved pages')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Apply recognized text' })).toBeNull();
});

it('opens the enabled contents plugin in the existing right sidebar without starting work', async () => {
  useNotebookStore.setState({ isNotebookVisible: false, notebookActiveTab: 'notes' });
  await mount();
  fireEvent.click(screen.getByRole('menuitem', { name: 'Contents generator' }));
  expect(useNotebookStore.getState()).toMatchObject({
    isNotebookVisible: true,
    notebookActiveTab: 'pdfAutoContents',
  });
  expect(useSidebarStore.getState().sideBarBookKey).toBe('a-view');
  expect(mocks.start).not.toHaveBeenCalled();
  expect(mocks.save).not.toHaveBeenCalled();
});

it('hides the contents plugin command when disabled while retaining core PDF actions', async () => {
  mocks.settings.officialModules.pdfAutoContents = false;
  await mount();
  expect(screen.queryByRole('menuitem', { name: 'Contents generator' })).toBeNull();
  expect(screen.getByRole('menuitem', { name: 'Recognize text' })).toBeTruthy();
  expect(screen.getByRole('menuitem', { name: 'Export reading copy' })).toBeTruthy();
});
