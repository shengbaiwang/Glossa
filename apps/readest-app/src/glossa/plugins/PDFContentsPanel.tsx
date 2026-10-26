import { useEffect, useRef, useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { useNotebookStore } from '@/store/notebookStore';
import type { ReadingPanelProps } from '@/glossa/ui/ReadingPassagePanel';
import {
  openPDFCache,
  outlineToTOC,
  supportsLocalPDF,
  type PDFCache,
} from '@/services/pdfEnhancement';
import type { PDFContentsReport } from '@/services/pdfAutoContents';
import { pluginLoaders } from './loaders';
import { runPluginTask } from './runtime';
import { previousPDFContents, rememberPDFContents, restorePDFContents } from './pdfContentsHistory';

const stages: Record<PDFContentsReport['stage'], string> = {
  open: 'Preparing contents',
  embedded: 'Checking existing contents',
  discovery: 'Finding contents pages',
  extraction: 'Reading contents',
  ocr: 'Recognizing text',
  verification: 'Verifying chapter headings',
  save: 'Saving contents',
};
function failure(report?: PDFContentsReport) {
  if (report?.code === 'pdf_contents_structure_incomplete')
    return 'Contents groups are incomplete or inconsistent. Your existing contents are preserved.';
  if (report?.code === 'outline_changed' || report?.code === 'source_changed')
    return 'The PDF or contents changed. Open this panel again to retry.';
  if (report?.code === 'pdf_contents_timeout' || report?.code === 'pdf_contents_ocr_limit')
    return 'Generation reached its limit. Try again to continue from saved progress.';
  if (report?.code?.endsWith('_limit'))
    return 'This PDF exceeds automatic contents limits. Page navigation is available.';
  if (report?.stage === 'save') return 'Contents could not be saved. Try again.';
  return 'A reliable contents list could not be verified. Your existing navigation is preserved.';
}

export default function PDFContentsPanel(props: ReadingPanelProps) {
  return <PDFContentsBook key={`${props.book.hash}:${props.bookKey}`} {...props} />;
}
function PDFContentsBook({ book, bookDoc, bookKey }: ReadingPanelProps) {
  const _ = useTranslation();
  const { appService } = useEnv();
  const [attempt, setAttempt] = useState(0);
  const [ready, setReady] = useState(false);
  const [source, setSource] = useState<string | null>(null);
  const [cache, setCache] = useState<PDFCache | null>(null);
  const [canRestore, setCanRestore] = useState(false);
  const [working, setWorking] = useState(false);
  const [report, setReport] = useState<PDFContentsReport>();
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const operation = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const supported = supportsLocalPDF();
  const personal = cache && !cache.generator && (cache.outline !== null || cache.revision > 0);
  const generated = !!cache?.outline?.length && !!cache.generator;
  const count = bookDoc.sections.length;

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    setReady(false);
    setError('');
    if (supported)
      void (async () => {
        try {
          const path = await appService?.resolveNativeBookFilePath(book);
          if (controller.signal.aborted) return;
          if (!path) throw new Error('pdf_source_unavailable');
          const current = await openPDFCache(path, false, {
            bookId: book.hash,
            revision: book.removal?.revision ?? 0,
          });
          const previous =
            current &&
            (await previousPDFContents(current, count, {
              bookId: book.hash,
              revision: book.removal?.revision ?? 0,
            }).catch(() => null));
          if (controller.signal.aborted) return;
          setSource(path);
          setCache(current);
          setCanRestore(!!previous);
          setReady(true);
        } catch {
          if (!controller.signal.aborted) setError('Could not open this PDF. Try again.');
        }
      })();
    return () => {
      mounted.current = false;
      controller.abort();
      operation.current?.abort();
    };
  }, [book, appService, count, supported, attempt]);

  const publish = async (current: PDFCache, signal: AbortSignal) => {
    if (signal.aborted) return;
    if (current.outline) {
      const toc = outlineToTOC(current.outline, count);
      const views = useReaderStore.getState().getViewsById(book.hash);
      await Promise.all(
        views.filter((view) => view.book === bookDoc).map((view) => view.updateTOC?.(toc, signal)),
      );
      if (signal.aborted) return;
      // The core owns the live document; keep its renderer, selections and position intact.
      useBookDataStore.setState((state) => {
        const data = state.getBookData(bookKey);
        if (!data || data.bookDoc !== bookDoc) return state;
        bookDoc.toc = toc;
        bookDoc.pdfCache = current;
        return { booksData: { ...state.booksData, [data.id]: { ...data } } };
      });
    }
    setCache(current);
  };
  const run = async (restore = false) => {
    if (operation.current || !source || !appService) return;
    const controller = new AbortController();
    operation.current = controller;
    setWorking(true);
    setReport(undefined);
    setError('');
    setMessage('');
    try {
      await runPluginTask(
        'pdfAutoContents',
        async (signal) => {
          const current = await openPDFCache(source, false, {
            bookId: book.hash,
            revision: book.removal?.revision ?? 0,
          });
          if (signal.aborted) return;
          if (restore) {
            if (!current) throw new Error('outline_changed');
            const restored = await restorePDFContents(source, current, count, signal, {
              bookId: book.hash,
              revision: book.removal?.revision ?? 0,
            });
            if (!signal.aborted) {
              await publish(restored, signal);
              if (signal.aborted) return;
              setCanRestore(false);
              setMessage('Previous contents restored.');
            }
            return;
          }
          if (current && !current.generator && (current.outline !== null || current.revision > 0)) {
            await publish(current, signal);
            if (signal.aborted) return;
            setMessage('Your edited contents are preserved.');
            return;
          }
          if (current)
            await rememberPDFContents(current, count, signal, {
              bookId: book.hash,
              revision: book.removal?.revision ?? 0,
            });
          if (signal.aborted) return;
          const plugin = await pluginLoaders.pdfAutoContents();
          if (signal.aborted) return;
          // Use an owned parser so cancellation never destroys the reading document.
          const outcome = await plugin.prepareContents(appService, book, undefined, signal, {
            regenerate: !!current?.outline?.length,
            notify: false,
            onReport: (next) => {
              if (!signal.aborted) setReport(next);
            },
          });
          if (signal.aborted) return;
          if (outcome.result === 'generated' || outcome.result === 'preserved') {
            const saved = await openPDFCache(source, false, {
              bookId: book.hash,
              revision: book.removal?.revision ?? 0,
            });
            const previous =
              saved &&
              (await previousPDFContents(saved, count, {
                bookId: book.hash,
                revision: book.removal?.revision ?? 0,
              }).catch(() => null));
            if (signal.aborted) return;
            if (saved) await publish(saved, signal);
            if (signal.aborted) return;
            setCanRestore(!!previous);
            setMessage('Contents are ready.');
          } else setError(failure(outcome.report));
        },
        controller.signal,
      );
    } catch {
      if (!controller.signal.aborted && mounted.current)
        setError(
          restore
            ? 'Could not restore contents. Your current contents are unchanged.'
            : 'Contents generation failed. Try again. Your existing navigation is preserved.',
        );
    } finally {
      if (operation.current === controller) {
        operation.current = null;
        if (mounted.current) setWorking(false);
      }
    }
  };
  return (
    <section
      className='flex h-full flex-col gap-4 overflow-y-auto p-4'
      aria-label={_('Contents generator')}
    >
      {!supported ? (
        <p role='status'>{_('Contents generation is available on macOS.')}</p>
      ) : (
        <>
          <div className='flex flex-wrap items-center gap-2'>
            <button
              type='button'
              className='btn btn-sm btn-contrast min-h-11'
              disabled={!ready || working || !!personal}
              onClick={() => void run()}
            >
              {_(
                error && ready
                  ? 'Try again'
                  : generated
                    ? 'Regenerate contents'
                    : 'Generate contents',
              )}
            </button>
            {working && (
              <button
                type='button'
                className='btn btn-ghost btn-sm eink-bordered min-h-11'
                onClick={() => {
                  operation.current?.abort();
                  setMessage('Generation stopped. Saved progress is available for retry.');
                }}
              >
                {_('Cancel')}
              </button>
            )}
            {canRestore && !working && (
              <button
                type='button'
                className='btn btn-ghost btn-sm eink-bordered min-h-11'
                onClick={() => void run(true)}
              >
                {_('Restore previous contents')}
              </button>
            )}
          </div>
          {working && (
            <p role='status' aria-live='polite'>
              {_(report ? stages[report.stage] : 'Preparing contents')}
              {!!report?.totalCount && ` · ${report.verifiedCount ?? 0}/${report.totalCount}`}
              {report?.resumed && ` · ${_('Continuing from saved progress')}`}
            </p>
          )}
          {!working && !ready && !error && <p role='status'>{_('Loading...')}</p>}
          {personal && <p role='status'>{_('Your edited contents are preserved.')}</p>}
          {message && (
            <p role='status' aria-live='polite'>
              {_(message)}
            </p>
          )}
          {error && (
            <div role='alert'>
              <p>{_(error)}</p>
              {!ready && (
                <button
                  type='button'
                  className='glossa-button min-h-11'
                  onClick={() => setAttempt((value) => value + 1)}
                >
                  {_('Try again')}
                </button>
              )}
            </div>
          )}
          {(generated || personal) && !working && (
            <button
              type='button'
              className='glossa-button min-h-11 self-start'
              onClick={() => {
                const sidebar = useSidebarStore.getState();
                const store = useBookDataStore.getState();
                const config = store.getConfig(bookKey);
                if (config?.viewSettings)
                  store.setConfig(bookKey, {
                    viewSettings: { ...config.viewSettings, sideBarTab: 'toc' },
                  });
                sidebar.setSideBarBookKey(bookKey);
                sidebar.setSearchBarVisible(false);
                sidebar.setSideBarVisible(true);
                if (window.innerWidth < 640) useNotebookStore.getState().setNotebookVisible(false);
              }}
            >
              {_('Show contents')}
            </button>
          )}
        </>
      )}
    </section>
  );
}
