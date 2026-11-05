import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Book } from '@/types/book';
import type { SystemSettings } from '@/types/settings';
import { useSettingsStore } from '@/store/settingsStore';
import {
  recognizeImportedBookMetadata,
  runBookMetadataRecognition,
} from '@/glossa/plugins/metadataRecognition';

const f = vi.hoisted(() => ({ recognize: vi.fn() }));
vi.mock('@/glossa/metadata/recognize', () => ({ recognizeBookMetadata: f.recognize }));
const book = { hash: 'fixture', format: 'EPUB' } as Book;
const env = { getAppService: vi.fn() };
const result = { version: 1, fingerprint: 'fixture', candidates: [], complete: true };
const enabled = (value: boolean) =>
  useSettingsStore.setState({
    settings: { officialModules: { metadataRecognition: value } } as SystemSettings,
  });
beforeEach(() => {
  enabled(true);
  f.recognize.mockReset().mockResolvedValue(result);
});
afterEach(() => enabled(true));

it('refuses disabled plugins without loading a book', async () => {
  enabled(false);
  await expect(runBookMetadataRecognition(book, env)).rejects.toMatchObject({ name: 'AbortError' });
  expect(f.recognize).not.toHaveBeenCalled();
});

it('requires explicit import opt-in and a live local book before automatic recognition', async () => {
  const imported = { ...book, downloadedAt: 1 };
  await recognizeImportedBookMetadata(imported, env);
  expect(f.recognize).not.toHaveBeenCalled();
  useSettingsStore.setState({
    settings: {
      metadataRecognitionOnImport: true,
      officialModules: { metadataRecognition: false },
    } as SystemSettings,
  });
  await recognizeImportedBookMetadata(imported, env);
  expect(f.recognize).not.toHaveBeenCalled();
  useSettingsStore.setState({ settings: { metadataRecognitionOnImport: true } as SystemSettings });
  await recognizeImportedBookMetadata({ ...imported, deletedAt: 1 }, env);
  await recognizeImportedBookMetadata(book, env);
  expect(f.recognize).not.toHaveBeenCalled();
  await recognizeImportedBookMetadata(imported, env);
  expect(f.recognize).toHaveBeenCalledOnce();
});

it('serializes manual and automatic recognition without retaining open documents', async () => {
  let finish!: (value: typeof result) => void;
  f.recognize.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const first = runBookMetadataRecognition(book, env);
  await vi.waitFor(() => expect(f.recognize).toHaveBeenCalledOnce());
  const second = runBookMetadataRecognition({ ...book, hash: 'second' }, env);
  await Promise.resolve();
  expect(f.recognize).toHaveBeenCalledOnce();
  finish(result);
  expect(await first).toEqual(result);
  expect(await second).toEqual(result);
  expect(f.recognize).toHaveBeenCalledTimes(2);
});

it('cancels queued and active tasks on disable and never revives them', async () => {
  let finish!: (value: typeof result) => void;
  let signal!: AbortSignal;
  f.recognize.mockImplementationOnce((_book, _env, value) => {
    signal = value;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  const first = runBookMetadataRecognition(book, env);
  const rejectedFirst = expect(first).rejects.toMatchObject({ name: 'AbortError' });
  await vi.waitFor(() => expect(f.recognize).toHaveBeenCalledOnce());
  const second = runBookMetadataRecognition({ ...book, hash: 'queued' }, env);
  const rejectedSecond = expect(second).rejects.toMatchObject({ name: 'AbortError' });
  enabled(false);
  enabled(true);
  expect(signal.aborted).toBe(true);
  finish(result);
  await rejectedFirst;
  await rejectedSecond;
  expect(f.recognize).toHaveBeenCalledOnce();
  await expect(runBookMetadataRecognition(book, env)).resolves.toEqual(result);
});

it('honors explicit cancellation and permits a later retry', async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    runBookMetadataRecognition(book, env, { signal: controller.signal }),
  ).rejects.toMatchObject({ name: 'AbortError' });
  expect(f.recognize).not.toHaveBeenCalled();
  await expect(runBookMetadataRecognition(book, env)).resolves.toEqual(result);
});
