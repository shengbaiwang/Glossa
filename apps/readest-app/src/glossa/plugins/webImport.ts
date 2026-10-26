import type { AppService } from '@/types/system';
import { runPluginTask } from './runtime';

/** Only an explicit import loads the capture pipeline. Disable invalidates the entire activation. */
export async function importWebPage({
  url,
  translate,
  appService,
  signal,
  onStage,
  save,
  htmlFile,
}: {
  url: string;
  htmlFile?: string;
  translate: (key: string) => string;
  appService: AppService | null;
  signal: AbortSignal;
  onStage: (stage: string) => void;
  save: (file: File, signal: AbortSignal) => Promise<void>;
}): Promise<void> {
  let saveFailure: { error: unknown } | undefined;
  await runPluginTask(
    'webImport',
    async (activeSignal) => {
      const { clipPageWithSignInFallback } = await import('@/services/send/clipSignIn');
      activeSignal.throwIfAborted();
      let book: import('@/services/send/conversion/types').ConvertedBook | undefined;
      if (htmlFile) {
        try {
          const { invoke } = await import('@tauri-apps/api/core');
          activeSignal.throwIfAborted();
          const { html } = await invoke<{ html?: string | null }>(
            'plugin:native-bridge|read_share_clip_html',
            { payload: { fileName: htmlFile } },
          );
          activeSignal.throwIfAborted();
          if (!html) throw new Error('Shared page HTML unavailable');
          onStage('Preparing article…');
          const { convertToEpubWithWorker } = await import(
            '@/services/send/conversion/conversionWorker'
          );
          activeSignal.throwIfAborted();
          book = await convertToEpubWithWorker({ kind: 'page', html, url, signal: activeSignal });
        } catch {
          activeSignal.throwIfAborted();
        }
      }
      if (!book)
        book = await clipPageWithSignInFallback(url, translate, appService, {
          signal: activeSignal,
          onStage,
        });
      activeSignal.throwIfAborted();
      onStage('Saving to library…');
      try {
        await save(book.file, activeSignal);
      } catch (error) {
        saveFailure = { error };
      }
    },
    signal,
  );
  if (saveFailure) throw saveFailure.error;
}
