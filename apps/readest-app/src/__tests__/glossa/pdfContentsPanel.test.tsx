import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Book } from '@/types/book';
import type { BookDoc } from '@/libs/document';
import type { SystemSettings } from '@/types/settings';
import type { PDFCache } from '@/services/pdfEnhancement';
import { useSettingsStore } from '@/store/settingsStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import type { FoliateView } from '@/types/view';
import PDFContentsPanel from '@/glossa/plugins/PDFContentsPanel';

const f = vi.hoisted(() => ({
  cache: { id: 'a'.repeat(32), pages: [], revision: 0, outline: null } as PDFCache,
  prepare: vi.fn(),
  resolve: vi.fn(),
  save: vi.fn(),
  load: vi.fn(),
  records: new Map<string, unknown>(),
}));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: host }) }));
vi.mock('@/glossa/plugins/loaders', () => ({
  pluginLoaders: {
    pdfAutoContents: async () => {
      f.load();
      return { prepareContents: f.prepare };
    },
  },
}));
vi.mock('@/services/pdfEnhancement', async (original) => ({
  ...(await original<typeof import('@/services/pdfEnhancement')>()),
  supportsLocalPDF: () => true,
  openPDFCache: async () => structuredClone(f.cache),
  savePDFOutline: f.save,
}));
vi.mock('@/glossa/harness/derivedStore', async () => {
  const { createHash } = await import('node:crypto');
  return {
    hashData: async (value: unknown) =>
      createHash('sha256').update(JSON.stringify(value)).digest('hex'),
    createDerivedStore: () => ({
      load: async (key: string) => f.records.get(key) ?? null,
      save: async (key: string, value: unknown) => {
        f.records.set(key, structuredClone(value));
      },
    }),
  };
});
const host = { resolveNativeBookFilePath: f.resolve };
const book = { hash: 'fixture', title: 'Original', format: 'PDF' } as Book;
const newOutline = [{ title: 'Chapter 1 Copper', pageIndex: 4, level: 0 }];
let bookDoc: BookDoc;
beforeEach(() => {
  vi.clearAllMocks();
  f.records.clear();
  f.cache = { id: 'a'.repeat(32), pages: [], revision: 0, outline: null };
  f.resolve.mockResolvedValue('/original.pdf');
  f.prepare.mockImplementation(async () => {
    f.cache = {
      ...f.cache,
      revision: f.cache.revision + 1,
      outline: newOutline,
      generator: 'glossa-contents-3',
    };
    return { result: 'generated' };
  });
  f.save.mockImplementation(async (_source, cache: PDFCache, outline, _count, generator) => {
    if (cache.revision !== f.cache.revision) throw new Error('outline_changed');
    f.cache = { ...f.cache, outline, generator, revision: cache.revision + 1 };
    return structuredClone(f.cache);
  });
  bookDoc = {
    sections: Array.from({ length: 16 }, () => ({})),
    toc: [],
    destroy: vi.fn(),
  } as unknown as BookDoc;
  useBookDataStore.setState({
    booksData: {
      fixture: {
        id: 'fixture',
        book,
        bookDoc,
        file: null,
        config: null,
        isFixedLayout: true,
      },
    },
  });
  useSettingsStore.setState({ settings: {} as SystemSettings });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useBookDataStore.setState({ booksData: {} });
});
it('opens the printed source page for an unresolved heading without changing navigation', async () => {
  const goTo = vi.fn();
  vi.spyOn(useReaderStore.getState(), 'getView').mockReturnValue({
    goTo,
  } as unknown as FoliateView);
  f.prepare.mockResolvedValueOnce({
    result: 'unavailable',
    report: {
      code: 'pdf_contents_heading_unverified',
      issues: [{ title: '第五编 铜的历史', sourcePage: 12, reason: 'heading_unverified' }],
    },
  });
  await open();
  fireEvent.click(screen.getByRole('button', { name: 'Generate contents' }));
  fireEvent.click(await screen.findByRole('button', { name: '第五编 铜的历史' }));
  expect(goTo).toHaveBeenCalledWith(12);
  expect(bookDoc.toc).toEqual([]);
  expect(f.save).not.toHaveBeenCalled();
});
const open = async () => {
  const view = render(<PDFContentsPanel book={book} bookDoc={bookDoc} bookKey='fixture-0' />);
  await waitFor(() =>
    expect(
      (
        screen.getByRole('button', {
          name: /^(Generate|Show) contents$/,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
  return view;
};
it('only starts on a click and publishes verified contents without recreating the reader', async () => {
  await open();
  expect(f.load).not.toHaveBeenCalled();
  expect(f.prepare).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Generate contents' }));
  await screen.findByText('Contents are ready.');
  expect(bookDoc.toc?.[0]?.label).toBe('Chapter 1 Copper');
  expect(bookDoc.destroy).not.toHaveBeenCalled();
  expect(f.prepare).toHaveBeenCalledWith(
    host,
    book,
    undefined,
    expect.any(AbortSignal),
    expect.objectContaining({ notify: false }),
  );
});
it('shows verified progress during an explicit resumed attempt', async () => {
  let finish!: () => void;
  f.prepare.mockImplementation(async (_host, _book, _doc, _signal, options) => {
    options.onReport({
      algorithm: 'pdf-contents-7',
      stage: 'verification',
      state: 'running',
      updatedAt: Date.now(),
      resumed: true,
      verifiedCount: 2,
      totalCount: 5,
    });
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    return { result: 'unavailable' };
  });
  await open();
  fireEvent.click(screen.getByRole('button', { name: 'Generate contents' }));
  const progress = await screen.findByRole('progressbar', { name: 'Verifying chapter headings' });
  expect(progress.getAttribute('aria-valuenow')).toBe('40');
  expect(progress.textContent).toBe('');
  expect(screen.queryByText(/2\s*\/\s*5/)).toBeNull();
  await act(async () => finish());
});

it('reports incomplete groups as a failure and leaves existing navigation in place', async () => {
  const previous = [{ title: 'Previous chapter', pageIndex: 2, level: 0 }];
  f.cache = { ...f.cache, outline: previous, generator: 'glossa-contents-3', revision: 4 };
  bookDoc.toc = [{ label: 'Previous chapter', href: '2', id: 0, index: 2 }];
  f.prepare.mockResolvedValue({
    result: 'unavailable',
    report: {
      algorithm: 'pdf-contents-12',
      stage: 'verification',
      state: 'unavailable',
      code: 'pdf_contents_structure_incomplete',
      updatedAt: Date.now(),
    },
  });
  await open();
  fireEvent.keyDown(screen.getByRole('button', { name: 'More' }), { key: 'Enter' });
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Regenerate contents' }));
  await screen.findByText(
    'Contents groups are incomplete or inconsistent. Your existing contents are preserved.',
  );
  expect(screen.queryByText('Contents are ready.')).toBeNull();
  expect(f.cache.outline).toEqual(previous);
  expect(bookDoc.toc?.[0]?.label).toBe('Previous chapter');
  expect(f.save).not.toHaveBeenCalled();
});

it('saves one-step recovery before regenerating and restores it after reopening the panel', async () => {
  const previous = [{ title: 'Previous chapter', pageIndex: 2, level: 0 }];
  f.cache = { ...f.cache, outline: previous, generator: 'glossa-contents-3', revision: 4 };
  const view = await open();
  fireEvent.keyDown(screen.getByRole('button', { name: 'More' }), { key: 'Enter' });
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Regenerate contents' }));
  await screen.findByText('Contents are ready.');
  expect(f.records.size).toBe(1);
  view.unmount();
  await open();
  fireEvent.keyDown(screen.getByRole('button', { name: 'More' }), { key: 'Enter' });
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Restore previous contents' }));
  await screen.findByText('Previous contents restored.');
  expect(f.cache.outline).toEqual(previous);
  expect(bookDoc.toc?.[0]?.label).toBe('Previous chapter');
  expect(f.cache.generator).toBe('glossa-contents-3');
});
it('cancels active work and rejects a late result after plugin disable and re-enable', async () => {
  let finish!: () => void;
  let signal!: AbortSignal;
  f.prepare.mockImplementation(async (_host, _book, _doc, value: AbortSignal) => {
    signal = value;
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    return { result: 'generated' };
  });
  await open();
  fireEvent.click(screen.getByRole('button', { name: 'Generate contents' }));
  await waitFor(() => expect(f.prepare).toHaveBeenCalledOnce());
  act(() =>
    useSettingsStore.setState({
      settings: { officialModules: { pdfAutoContents: false } } as SystemSettings,
    }),
  );
  act(() => useSettingsStore.setState({ settings: {} as SystemSettings }));
  expect(signal.aborted).toBe(true);
  await act(async () => finish());
  expect(bookDoc.toc).toEqual([]);
  expect(f.prepare).toHaveBeenCalledOnce();
});
it('stops on Cancel or close and keeps the existing reading document intact', async () => {
  let finish!: () => void;
  let signal!: AbortSignal;
  f.prepare.mockImplementation(async (_host, _book, _doc, value: AbortSignal) => {
    signal = value;
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    return { result: 'cancelled' };
  });
  const view = await open();
  fireEvent.click(screen.getByRole('button', { name: 'Generate contents' }));
  await waitFor(() => expect(f.prepare).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(signal.aborted).toBe(true);
  await act(async () => finish());
  fireEvent.click(screen.getByRole('button', { name: 'Generate contents' }));
  await waitFor(() => expect(f.prepare).toHaveBeenCalledTimes(2));
  view.unmount();
  expect(signal.aborted).toBe(true);
  await act(async () => finish());
  expect(bookDoc.destroy).not.toHaveBeenCalled();
});
it.each([
  'pdf_contents_timeout',
  'pdf_contents_text_limit',
])('shows a bounded failure and allows a new explicit retry without publishing partial contents (%s)', async (code) => {
  f.prepare.mockResolvedValueOnce({
    result: 'unavailable',
    report: { code, canResume: true },
  });
  await open();
  fireEvent.click(screen.getByRole('button', { name: 'Generate contents' }));
  expect((await screen.findByRole('alert')).textContent).toContain('saved progress');
  expect(bookDoc.toc).toEqual([]);
  fireEvent.click(screen.getByRole('button', { name: 'Continue verification' }));
  await screen.findByText('Contents are ready.');
  expect(f.prepare).toHaveBeenCalledTimes(2);
});
it.each([
  [
    'pdf_contents_scope_unresolved',
    'The volume covered by this contents list could not be confirmed. Your existing navigation is preserved.',
  ],
  [
    'pdf_contents_heading_unverified',
    'Some chapter headings could not be verified. Your existing navigation is preserved.',
  ],
  [
    'pdf_contents_extraction_failed',
    'The printed contents could not be read completely. Your existing navigation is preserved.',
  ],
])('explains the failure stage without publishing partial contents (%s)', async (code, message) => {
  f.prepare.mockResolvedValueOnce({ result: 'unavailable', report: { code } });
  await open();
  fireEvent.click(screen.getByRole('button', { name: 'Generate contents' }));
  expect((await screen.findByRole('alert')).textContent).toContain(message);
  expect(bookDoc.toc).toEqual([]);
});
it('preserves personal contents, including a deliberately empty list', async () => {
  f.cache = { ...f.cache, revision: 3, outline: [] };
  render(<PDFContentsPanel book={book} bookDoc={bookDoc} bookKey='fixture-0' />);
  await screen.findByText('Your edited contents are preserved.');
  expect(screen.getByRole('button', { name: 'Show contents' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'More' })).toBeNull();
  expect(f.prepare).not.toHaveBeenCalled();
  expect(f.save).not.toHaveBeenCalled();
});

it('refuses to restore over a concurrent personal edit', async () => {
  f.cache = {
    ...f.cache,
    outline: [{ title: 'Earlier', pageIndex: 2, level: 0 }],
    generator: 'glossa-contents-3',
    revision: 4,
  };
  await open();
  fireEvent.keyDown(screen.getByRole('button', { name: 'More' }), { key: 'Enter' });
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Regenerate contents' }));
  await screen.findByRole('button', { name: 'More' });
  const personal = [{ title: 'Personal edit', pageIndex: 7, level: 0 }];
  f.cache = { ...f.cache, outline: personal, generator: null, revision: 6 };
  fireEvent.keyDown(screen.getByRole('button', { name: 'More' }), { key: 'Enter' });
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Restore previous contents' }));
  await screen.findByRole('alert');
  expect(f.cache.outline).toEqual(personal);
  expect(f.save).not.toHaveBeenCalled();
});

it('can retry a failed local PDF lookup without starting generation on open', async () => {
  f.resolve.mockRejectedValueOnce(new Error('private path unavailable'));
  render(<PDFContentsPanel book={book} bookDoc={bookDoc} bookKey='fixture-0' />);
  await screen.findByRole('alert');
  expect(screen.queryByText('private path unavailable')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await waitFor(() =>
    expect(
      (screen.getByRole('button', { name: 'Generate contents' }) as HTMLButtonElement).disabled,
    ).toBe(false),
  );
  expect(f.prepare).not.toHaveBeenCalled();
});
