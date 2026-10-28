import { beforeEach, expect, it, vi } from 'vitest';
import type { Book } from '@/types/book';
import type { BookDoc } from '@/libs/document';
import { prepareContents } from '@/glossa/plugins/pdfAutoContents';

const f = vi.hoisted(() => ({
  prepare: vi.fn(),
  open: vi.fn(),
  load: vi.fn(),
  resolve: vi.fn(),
  cache: vi.fn(),
  close: vi.fn(),
  destroy: vi.fn(),
}));

vi.mock('@/services/pdfEnhancement', () => ({
  supportsLocalPDF: () => true,
  openPDFCache: f.cache,
}));
vi.mock('@/services/pdfAutoContents', () => ({ preparePDFContents: f.prepare }));
vi.mock('@/libs/document', () => ({
  DocumentLoader: class {
    open = f.open;
  },
}));

const host = { resolveNativeBookFilePath: f.resolve, loadBookContent: f.load };
const book = (hash: string) => ({ hash, title: hash, format: 'PDF' }) as Book;
const options = { notify: false };
const run = (hash: string, signal = new AbortController().signal) =>
  prepareContents(host, book(hash), undefined, signal, options);

beforeEach(() => {
  vi.clearAllMocks();
  f.resolve.mockImplementation(async (value: Book) => `/${value.hash}.pdf`);
  f.load.mockResolvedValue({ file: { close: f.close } });
  f.cache.mockResolvedValue({ id: 'cache', revision: 0, outline: null });
  f.open.mockResolvedValue({ book: { destroy: f.destroy } as unknown as BookDoc });
  f.prepare.mockResolvedValue('generated');
});

it('opens only the active document and releases it before admitting the next task', async () => {
  let finish!: () => void;
  f.prepare.mockImplementationOnce(
    () =>
      new Promise<string>((resolve) => {
        finish = () => resolve('generated');
      }),
  );
  const first = run('first');
  await vi.waitFor(() => expect(f.prepare).toHaveBeenCalledOnce());
  const second = run('second');
  const third = run('third');
  await Promise.resolve();
  expect(f.load).toHaveBeenCalledOnce();
  expect(f.resolve).toHaveBeenCalledOnce();
  finish();
  expect(await first).toEqual({ result: 'generated', report: undefined });
  await Promise.all([second, third]);
  expect(f.load).toHaveBeenCalledTimes(3);
  expect(f.destroy).toHaveBeenCalledTimes(3);
  expect(f.close).toHaveBeenCalledTimes(3);
  expect(f.destroy.mock.invocationCallOrder[0]).toBeLessThan(f.load.mock.invocationCallOrder[1]!);
});

it('cancels a queued descriptor promptly without opening its source', async () => {
  let finish!: () => void;
  f.prepare.mockImplementationOnce(
    () =>
      new Promise<string>((resolve) => {
        finish = () => resolve('generated');
      }),
  );
  const first = run('first');
  await vi.waitFor(() => expect(f.prepare).toHaveBeenCalledOnce());
  const controller = new AbortController();
  const cancelled = run('cancelled', controller.signal);
  controller.abort();
  await expect(cancelled).resolves.toEqual({ result: 'cancelled' });
  expect(f.load).toHaveBeenCalledOnce();
  finish();
  await first;
  await expect(run('next')).resolves.toMatchObject({ result: 'generated' });
  expect(f.resolve.mock.calls.map(([value]) => value.hash)).toEqual(['first', 'next']);
});

it('holds the active slot until a parser opened after cancellation has finished closing', async () => {
  let opened!: (document: { book: BookDoc }) => void;
  let closed!: () => void;
  f.open.mockImplementationOnce(
    () =>
      new Promise<{ book: BookDoc }>((resolve) => {
        opened = resolve;
      }),
  );
  f.destroy.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        closed = resolve;
      }),
  );
  const controller = new AbortController();
  const first = run('cancel-opening', controller.signal);
  await vi.waitFor(() => expect(f.open).toHaveBeenCalledOnce());
  controller.abort();
  const second = run('next');
  opened({ book: { destroy: f.destroy } as unknown as BookDoc });
  await vi.waitFor(() => expect(f.destroy).toHaveBeenCalledOnce());
  expect(f.load).toHaveBeenCalledOnce();
  expect(f.prepare).not.toHaveBeenCalled();
  closed();
  await expect(first).resolves.toMatchObject({ result: 'cancelled' });
  await expect(second).resolves.toMatchObject({ result: 'generated' });
  expect(f.load).toHaveBeenCalledTimes(2);
  expect(f.close).toHaveBeenCalledTimes(2);
});

it('releases an unsuccessful document and continues the queue without destroying personal outlines', async () => {
  f.prepare.mockRejectedValueOnce(new Error('fixture recognition failed'));
  const results = await Promise.all([run('failure'), run('next')]);
  expect(results.map((result) => result.result)).toEqual(['unavailable', 'generated']);
  expect(f.destroy).toHaveBeenCalledTimes(2);
  f.cache.mockResolvedValue({ id: 'cache', revision: 5, outline: [] });
  await expect(run('personal')).resolves.toEqual({ result: 'preserved' });
  expect(f.load).toHaveBeenCalledTimes(2);
});
