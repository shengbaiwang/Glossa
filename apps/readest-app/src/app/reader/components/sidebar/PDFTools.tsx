import { useEffect, useRef, useState } from 'react';
import type { BookDoc } from '@/libs/document';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { useSettingsStore } from '@/store/settingsStore';
import { Download, Type } from '@/components/GlossaIcons';
import MenuItem from '@/components/MenuItem';
import {
  cancelPDFExport,
  exportPDFCopy,
  openPDFCache,
  type PDFOCRStatus,
} from '@/services/pdfEnhancement';
import { recognizePDFPages } from '@/services/pdfOCR';
import { preparePDFAnnotations } from '@/services/pdfWorkspace';

/** Optional whole-document actions live in the existing book menu. */
export default function PDFTools({ bookKey, bookDoc }: { bookKey: string; bookDoc: BookDoc }) {
  const _ = useTranslation();
  const { appService, envConfig } = useEnv();
  const [working, setWorking] = useState<'ocr' | 'export' | null>(null);
  const [status, setStatus] = useState<PDFOCRStatus | null>(null);
  const [error, setError] = useState('');
  const operation = useRef<AbortController | null>(null);
  const active = useRef<{ id: string; kind: 'ocr' | 'export' } | null>(null);
  const cancel = async () => {
    operation.current?.abort();
    const task = active.current;
    active.current = null;
    if (task) {
      try {
        if (task.kind === 'export') await cancelPDFExport(task.id);
      } catch {
        /* The worker may already have finished. */
      }
    }
    setWorking(null);
  };
  useEffect(
    () => () => {
      operation.current?.abort();
      const task = active.current;
      if (task?.kind === 'export') void cancelPDFExport(task.id).catch(() => {});
    },
    [],
  );
  const run = async (kind: 'ocr' | 'export') => {
    if (operation.current && !operation.current.signal.aborted) return;
    const controller = new AbortController();
    operation.current = controller;
    setWorking(kind);
    setStatus(null);
    setError('');
    try {
      const book = useBookDataStore.getState().getBookData(bookKey)?.book;
      const source = book && (await appService?.resolveNativeBookFilePath(book));
      if (!source || controller.signal.aborted) return;
      const cache = await openPDFCache(source, true);
      if (!cache || controller.signal.aborted) return;
      if (kind === 'export') {
        const { save } = await import('@tauri-apps/plugin-dialog');
        const destination = await save({
          defaultPath: 'Glossa-reading-copy.pdf',
          filters: [{ name: 'PDF', extensions: ['pdf'] }],
        });
        if (!destination || controller.signal.aborted) return;
        active.current = { id: cache.id, kind };
        const annotations = await preparePDFAnnotations(
          bookDoc,
          useBookDataStore.getState().getConfig(bookKey)?.booknotes ?? [],
          controller.signal,
        );
        if (!controller.signal.aborted)
          await exportPDFCopy(source, cache.id, destination, annotations);
      } else {
        const done = await recognizePDFPages(
          source,
          cache.id,
          bookDoc.sections.map((_, index) => index),
          controller.signal,
          setStatus,
        );
        if (done.state !== 'completed') throw new Error(done.error ?? 'pdf_recognition_failed');
        if (controller.signal.aborted) return;
        const store = useBookDataStore.getState();
        const current = store.getConfig(bookKey);
        if (current) {
          const location = useReaderStore.getState().getView(bookKey)?.lastLocation?.cfi;
          const updated = { ...current, ...(location ? { location } : {}) };
          store.setConfig(bookKey, updated);
          await store.saveConfig(envConfig, bookKey, updated, useSettingsStore.getState().settings);
        }
        if (!controller.signal.aborted)
          useReaderStore.getState().recreateViewer(envConfig, bookKey);
      }
    } catch (e) {
      if (!controller.signal.aborted) {
        const code = e instanceof Error ? e.message : String(e);
        setError(
          code.includes('pdf_export_exists')
            ? 'Choose a new filename for the PDF copy.'
            : kind === 'export'
              ? 'Could not export the PDF copy. Your original and notes are unchanged.'
              : 'PDF processing failed. Saved progress is available for retry.',
        );
      }
    } finally {
      if (operation.current === controller) {
        operation.current = null;
        active.current = null;
        setWorking(null);
      }
    }
  };
  return (
    <>
      <MenuItem
        label={_('Recognize text')}
        Icon={<Type size={16} />}
        disabled={!!working || bookDoc.sections.length > 5000}
        onClick={() => void run('ocr')}
      />
      <MenuItem
        label={_('Export reading copy')}
        Icon={<Download size={16} />}
        disabled={!!working}
        onClick={() => void run('export')}
      />
      {working && (
        <li className='px-3 py-2' role='status' aria-live='polite'>
          <span>
            {working === 'export'
              ? _('Exporting PDF copy')
              : `${_('Recognizing text')}${status ? ` ${status.completed}/${status.total}` : ''}`}
          </span>
          <button
            type='button'
            className='btn btn-ghost btn-sm eink-bordered'
            onClick={() => void cancel()}
          >
            {_('Cancel')}
          </button>
        </li>
      )}
      {error && (
        <li className='px-3 py-2' role='alert'>
          {_(error)}
        </li>
      )}
    </>
  );
}
