import type { Book } from '@/types/book';
import type { EnvConfigType } from '@/services/environment';
import type { MetadataRecognition } from '@/glossa/metadata/types';
import { useSettingsStore } from '@/store/settingsStore';
import { isPluginEnabled } from './registry';
import { runPluginTask } from './runtime';

export interface MetadataRecognitionOptions {
  signal?: AbortSignal;
  expanded?: boolean;
  onStage?: (stage: string) => void;
}

// Queue descriptors only; the document opens after admission and is released by
// the runner. An aborted activation stays aborted even after the plugin is enabled.
let pending: Promise<unknown> = Promise.resolve();
const cancelled = () => new DOMException('Cancelled', 'AbortError');
const until = (task: Promise<void>, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const abort = () => reject(cancelled());
    signal.addEventListener('abort', abort, { once: true });
    task.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    if (signal.aborted) abort();
  });

export async function runBookMetadataRecognition(
  book: Book,
  envConfig: EnvConfigType,
  options: MetadataRecognitionOptions = {},
): Promise<MetadataRecognition> {
  let result: MetadataRecognition | undefined;
  let completed = false;
  await runPluginTask(
    'metadataRecognition',
    async (signal) => {
      const task = pending.then(async () => {
        signal.throwIfAborted();
        const { recognizeBookMetadata } = await import('@/glossa/metadata/recognize');
        signal.throwIfAborted();
        result = await recognizeBookMetadata(book, envConfig, signal, options);
        signal.throwIfAborted();
        completed = true;
      });
      pending = task.catch(() => {});
      await until(task, signal);
    },
    options.signal,
  );
  if (!completed || !result) throw cancelled();
  const { eventDispatcher } = await import('@/utils/event');
  void eventDispatcher.dispatch('book-metadata-recognized', { bookHash: book.hash });
  return result;
}

/** The import pipeline invokes this only after persistence and parser cleanup. */
export async function recognizeImportedBookMetadata(
  book: Book,
  envConfig: EnvConfigType,
  signal?: AbortSignal,
): Promise<void> {
  const settings = useSettingsStore.getState().settings;
  if (
    settings.metadataRecognitionOnImport !== true ||
    !isPluginEnabled(settings, 'metadataRecognition') ||
    signal?.aborted ||
    book.deletedAt ||
    !book.downloadedAt
  )
    return;
  try {
    await runBookMetadataRecognition(book, envConfig, { signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    const [{ default: i18n }, { eventDispatcher }] = await Promise.all([
      import('i18next'),
      import('@/utils/event'),
    ]);
    void eventDispatcher.dispatch('toast', {
      type: 'error',
      message: i18n.t('Couldn’t recognize book metadata. Open book information to retry.'),
    });
  }
}
