import type { AppService } from '@/types/system';
import type { BookWebSource } from '@/types/book';
import { runPluginTask } from './runtime';
import type { ClipTaskOptions } from '@/services/send/clipSignIn';
import type { ConvertedBook } from '@/services/send/conversion/types';
import { eventDispatcher } from '@/utils/event';
import { useSettingsStore } from '@/store/settingsStore';

const preparedRetries = new WeakMap<
  object,
  {
    url: string;
    book: ConvertedBook;
    settings: ReturnType<typeof useSettingsStore.getState>['settings'];
  }
>();

export interface WebImportFeedback {
  onRecovery?: ClipTaskOptions['onRecovery'];
  onWarnings?: (warnings: NonNullable<ConvertedBook['warnings']>) => void;
  onFullText?: (pdfUrl: string, signal: AbortSignal) => Promise<boolean>;
  /** Dialog-owned identity: conversion is reusable only after a failed save,
   * with the same URL and unchanged plugin/settings state. */
  retryToken?: object;
}

/** Only an explicit import loads the capture pipeline. Disable invalidates the entire activation. */
export async function importWebPage({
  url,
  translate,
  appService,
  signal,
  onStage,
  onRecovery,
  onWarnings,
  onFullText,
  retryToken,
  save,
  htmlFile,
}: {
  url: string;
  htmlFile?: string;
  translate: (key: string) => string;
  appService: AppService | null;
  signal: AbortSignal;
  onStage: (stage: string) => void;
  save: (file: File, signal: AbortSignal, source?: BookWebSource) => Promise<void>;
} & WebImportFeedback): Promise<void> {
  let saveFailure: { error: unknown } | undefined;
  await runPluginTask(
    'webImport',
    async (activeSignal) => {
      const { clipPageWithSignInFallback } = await import('@/services/send/clipSignIn');
      activeSignal.throwIfAborted();
      const cached = retryToken ? preparedRetries.get(retryToken) : undefined;
      let book =
        cached?.url === url && cached.settings === useSettingsStore.getState().settings
          ? cached.book
          : undefined;
      const reusedPreparedBook = !!book;
      if (retryToken) preparedRetries.delete(retryToken);
      if (!book && htmlFile) {
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
          book = await convertToEpubWithWorker({
            kind: 'page',
            html,
            url,
            captureMethod: 'shared',
            onStage,
            signal: activeSignal,
          });
        } catch {
          activeSignal.throwIfAborted();
        }
      }
      if (!book)
        book = await clipPageWithSignInFallback(url, translate, appService, {
          signal: activeSignal,
          onStage,
          onRecovery,
        });
      activeSignal.throwIfAborted();
      if (
        !reusedPreparedBook &&
        book.source?.scope === 'abstract' &&
        book.source.pdfUrl &&
        onFullText
      ) {
        const fullText = await onFullText(book.source.pdfUrl, activeSignal);
        activeSignal.throwIfAborted();
        if (fullText) {
          onStage('Loading full-text PDF…');
          const { fetchWebPage } = await import('@/services/send/pageAcquisition');
          const result = await fetchWebPage(book.source.pdfUrl, activeSignal);
          if (result.kind !== 'file')
            throw new Error(
              'The full-text link did not return a PDF. Import the abstract or open the source page.',
            );
          book = {
            file: result.file,
            title: result.title,
            author: '',
            webSource: {
              originalUrl: book.source.originalUrl || url,
              referrerUrl: book.source.url || url,
              url: result.url,
            },
          };
        }
      }
      activeSignal.throwIfAborted();
      onStage('Saving to library…');
      try {
        const source =
          book.webSource ||
          (book.source?.originalUrl && book.source.url
            ? { originalUrl: book.source.originalUrl, url: book.source.url }
            : undefined);
        if (source) await save(book.file, activeSignal, source);
        else await save(book.file, activeSignal);
        if (!activeSignal.aborted && book.warnings?.length) {
          if (onWarnings) onWarnings(book.warnings);
          else
            eventDispatcher.dispatch('toast', {
              type: 'info',
              message: translate(
                book.warnings.some((warning) => warning.code === 'partial_content')
                  ? 'Imported an excerpt or abstract; the full article was not available.'
                  : 'Imported. Some images could not be saved.',
              ),
            });
        }
      } catch (error) {
        saveFailure = { error };
        if (retryToken && !activeSignal.aborted)
          preparedRetries.set(retryToken, {
            url,
            book,
            settings: useSettingsStore.getState().settings,
          });
      }
    },
    signal,
  );
  if (saveFailure) throw saveFailure.error;
}
