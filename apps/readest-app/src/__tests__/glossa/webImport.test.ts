import { beforeEach, expect, it, vi } from 'vitest';
import { useSettingsStore } from '@/store/settingsStore';
import type { SystemSettings } from '@/types/settings';
import { importWebPage } from '@/glossa/plugins/webImport';
const f = vi.hoisted(() => ({ clip: vi.fn() }));
vi.mock('@/services/send/clipSignIn', () => ({ clipPageWithSignInFallback: f.clip }));
vi.mock('@/services/send/pageAcquisition', () => ({ fetchWebPage: vi.fn() }));
import { fetchWebPage } from '@/services/send/pageAcquisition';
const book = { file: new File(['original fixture'], 'article.epub'), title: 'Article', author: '' };
beforeEach(() => {
  useSettingsStore.setState({ settings: {} as SystemSettings });
  f.clip.mockReset().mockResolvedValue(book);
});
const setup = () => ({
  url: 'https://example.com/article',
  translate: (key: string) => key,
  appService: null,
  signal: new AbortController().signal,
  onStage: vi.fn(),
  save: vi.fn().mockResolvedValue(undefined),
});
it('does no work while disabled or already aborted', async () => {
  const options = setup();
  useSettingsStore.setState({
    settings: { officialModules: { webImport: false } } as SystemSettings,
  });
  await importWebPage(options);
  expect(f.clip).not.toHaveBeenCalled();
  useSettingsStore.setState({ settings: {} as SystemSettings });
  await importWebPage({ ...options, signal: AbortSignal.abort() });
  expect(f.clip).not.toHaveBeenCalled();
  expect(options.save).not.toHaveBeenCalled();
});
it('runs only after activation and saves through the existing core callback', async () => {
  const options = setup();
  await importWebPage(options);
  expect(options.save).toHaveBeenCalledExactlyOnceWith(book.file, expect.any(AbortSignal));
  expect(options.onStage).toHaveBeenLastCalledWith('Saving to library…');
});
it('invalidates a late capture across disable and immediate re-enable without automatically resuming', async () => {
  let finish!: (value: typeof book) => void;
  f.clip.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const options = setup();
  const pending = importWebPage(options);
  await vi.waitFor(() => expect(f.clip).toHaveBeenCalledOnce());
  const signal = f.clip.mock.calls[0]![3].signal as AbortSignal;
  useSettingsStore.setState({
    settings: { officialModules: { webImport: false } } as SystemSettings,
  });
  useSettingsStore.setState({
    settings: { officialModules: { webImport: true } } as SystemSettings,
  });
  expect(signal.aborted).toBe(true);
  finish(book);
  await pending;
  expect(options.save).not.toHaveBeenCalled();
  expect(f.clip).toHaveBeenCalledOnce();
  await importWebPage(options);
  expect(options.save).toHaveBeenCalledOnce();
});
it('keeps persistence failure visible for retry', async () => {
  const options = setup();
  options.save.mockRejectedValueOnce(new Error('disk full'));
  await expect(importWebPage(options)).rejects.toThrow('disk full');
  await importWebPage(options);
  expect(options.save).toHaveBeenCalledTimes(2);
});

it('does not disguise a persistence failure as cancellation', async () => {
  let fail!: (error: Error) => void;
  const controller = new AbortController();
  const options = { ...setup(), signal: controller.signal };
  options.save.mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        fail = reject;
      }),
  );
  const pending = importWebPage(options);
  const result = pending.then(
    () => null,
    (error) => error,
  );
  await vi.waitFor(() => expect(options.save).toHaveBeenCalledOnce());
  controller.abort();
  fail(new Error('disk full'));
  expect(await result).toMatchObject({ message: 'disk full' });
});

it('reports resource warnings only after a successful persistent import', async () => {
  const options = setup();
  const onWarnings = vi.fn();
  const warnings = [{ code: 'missing_assets' as const, count: 2 }];
  f.clip.mockResolvedValue({ ...book, warnings });
  options.save.mockRejectedValueOnce(new Error('disk full'));
  await expect(importWebPage({ ...options, onWarnings })).rejects.toThrow('disk full');
  expect(onWarnings).not.toHaveBeenCalled();
  await importWebPage({ ...options, onWarnings });
  expect(onWarnings).toHaveBeenCalledExactlyOnceWith(warnings);
});

it('reuses prepared bytes after save failure, and invalidates them when settings change', async () => {
  const retryToken = {};
  const options = { ...setup(), retryToken };
  options.save.mockRejectedValueOnce(new Error('disk full'));
  await expect(importWebPage(options)).rejects.toThrow('disk full');
  await importWebPage(options);
  expect(f.clip).toHaveBeenCalledOnce();
  options.save.mockRejectedValueOnce(new Error('disk full'));
  await expect(importWebPage(options)).rejects.toThrow('disk full');
  useSettingsStore.setState({
    settings: { officialModules: { webImport: false } } as SystemSettings,
  });
  useSettingsStore.setState({
    settings: { officialModules: { webImport: true } } as SystemSettings,
  });
  await importWebPage(options);
  expect(f.clip).toHaveBeenCalledTimes(3);
});

it('offers a full-text PDF only for an identified abstract and fetches it after explicit choice', async () => {
  const pdf = new File(['%PDF-1.7'], 'paper.pdf', { type: 'application/pdf' });
  f.clip.mockResolvedValueOnce({
    ...book,
    source: {
      scope: 'abstract',
      originalUrl: 'https://example.com/article',
      url: 'https://example.org/abstract',
      pdfUrl: 'https://example.org/paper.pdf',
    },
  });
  vi.mocked(fetchWebPage).mockResolvedValueOnce({
    kind: 'file',
    file: pdf,
    title: 'paper',
    url: 'https://cdn.example.org/full-paper.pdf',
  });
  const options = setup();
  const onFullText = vi.fn().mockResolvedValueOnce(true);
  await importWebPage({ ...options, onFullText });
  expect(onFullText).toHaveBeenCalledWith('https://example.org/paper.pdf', expect.any(AbortSignal));
  expect(options.save).toHaveBeenCalledExactlyOnceWith(pdf, expect.any(AbortSignal), {
    originalUrl: 'https://example.com/article',
    referrerUrl: 'https://example.org/abstract',
    url: 'https://cdn.example.org/full-paper.pdf',
  });
});

it('keeps the abstract when the user declines the PDF', async () => {
  vi.mocked(fetchWebPage).mockClear();
  f.clip.mockResolvedValueOnce({
    ...book,
    source: { scope: 'abstract', pdfUrl: 'https://example.org/paper.pdf' },
  });
  const options = setup();
  await importWebPage({ ...options, onFullText: vi.fn().mockResolvedValueOnce(false) });
  expect(fetchWebPage).not.toHaveBeenCalled();
  expect(options.save).toHaveBeenCalledWith(book.file, expect.any(AbortSignal));
});
