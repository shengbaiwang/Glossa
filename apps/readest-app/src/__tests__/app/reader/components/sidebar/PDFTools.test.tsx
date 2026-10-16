import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import PDFTools from '@/app/reader/components/sidebar/PDFTools';
import type { BookDoc } from '@/libs/document';

const mocks = vi.hoisted(() => ({
  cache: { id: 'a'.repeat(32), pages: [] as number[], outline: null, revision: 0 },
  start: vi.fn(),
  wait: vi.fn(),
  cancel: vi.fn(),
  save: vi.fn(),
  recreate: vi.fn(),
  setConfig: vi.fn(),
  saveConfig: vi.fn(),
  appService: { resolveNativeBookFilePath: vi.fn(async () => '/original.pdf') },
}));
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
  useSettingsStore: { getState: () => ({ settings: {} }) },
}));
vi.mock('@/services/pdfEnhancement', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/pdfEnhancement')>()),
  openPDFCache: vi.fn(async () => ({ ...mocks.cache })),
  getPDFOCRStatus: vi.fn(async () => null),
  startPDFOCR: mocks.start,
  waitForPDFOCR: mocks.wait,
  cancelPDFOCR: mocks.cancel,
  savePDFOutline: mocks.save,
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
async function mount() {
  render(<PDFTools bookKey='a-view' bookDoc={doc} />);
  await waitFor(() =>
    expect(
      (screen.getByRole('button', { name: 'Recognize text' }) as HTMLButtonElement).disabled,
    ).toBe(false),
  );
}
it('starts only on request and saves current reading location and notes before applying OCR', async () => {
  await mount();
  expect(mocks.start).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Recognize text' }));
  await screen.findByText('Text recognition complete 3/3');
  fireEvent.click(screen.getByRole('button', { name: 'Apply recognized text' }));
  await waitFor(() => expect(mocks.recreate).toHaveBeenCalled());
  expect(mocks.saveConfig.mock.calls[0]![2]).toMatchObject({
    location: 'current-page-cfi',
    booknotes: [{ id: 'keep' }],
  });
});
it('keeps contents as a draft, supports inline rename cancellation and undo, and applies explicitly', async () => {
  await mount();
  fireEvent.click(screen.getByRole('button', { name: 'Repair contents' }));
  fireEvent.click(screen.getByRole('button', { name: 'Recognize contents' }));
  const chapter = await screen.findByRole('button', { name: 'Chapter 1 Reading' });
  expect(mocks.save).not.toHaveBeenCalled();
  fireEvent.keyDown(chapter, { key: 'F2' });
  const title = screen.getByRole('textbox', { name: 'Chapter title' });
  fireEvent.change(title, { target: { value: 'Discard this rename' } });
  fireEvent.keyDown(title, { key: 'Escape' });
  expect(screen.queryByText('Discard this rename')).toBeNull();
  fireEvent.doubleClick(screen.getByRole('button', { name: 'Chapter 1 Reading' }));
  const renamed = screen.getByRole('textbox', { name: 'Chapter title' });
  fireEvent.change(renamed, { target: { value: 'My chapter' } });
  fireEvent.blur(renamed);
  expect(screen.getByRole('button', { name: /My chapter/ })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
  expect(screen.getByRole('button', { name: 'Chapter 1 Reading' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalled());
  expect(mocks.save.mock.calls[0]![2]).toHaveLength(2);
});
it('keeps an editable draft when saving fails', async () => {
  mocks.save.mockRejectedValueOnce(new Error('disk full'));
  await mount();
  fireEvent.click(screen.getByRole('button', { name: 'Repair contents' }));
  fireEvent.click(screen.getByRole('button', { name: 'Add chapter' }));
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  await screen.findByRole('alert');
  expect(screen.getByRole('button', { name: /New chapter/ })).toBeTruthy();
  expect(mocks.recreate).not.toHaveBeenCalled();
});
it('cancels the native task without applying or removing personal data', async () => {
  mocks.wait.mockImplementation(
    async (_id, signal: AbortSignal) =>
      new Promise((resolve) => {
        signal.addEventListener('abort', () => resolve({ state: 'cancelled' }), { once: true });
      }),
  );
  await mount();
  fireEvent.click(screen.getByRole('button', { name: 'Recognize text' }));
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
  fireEvent.click(screen.getByRole('button', { name: 'Recognize text' }));
  await waitFor(() => expect(mocks.start).toHaveBeenCalled());
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  started({ cacheId: mocks.cache.id, state: 'running', completed: 0, total: 3, error: null });
  await waitFor(() => expect(mocks.cancel).toHaveBeenCalledTimes(2));
  expect(mocks.wait).not.toHaveBeenCalled();
  expect(mocks.recreate).not.toHaveBeenCalled();
});
