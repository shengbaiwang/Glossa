import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FolderOpen } from '@/components/GlossaIcons';
import { useTranslation } from '@/hooks/useTranslation';
import { getFilename } from '@/utils/path';
import { SUPPORTED_BOOK_EXTS } from '@/services/constants';
import type { FileItem } from '@/types/system';
import Dialog from '@/components/Dialog';

export interface ImportFromFolderResult {
  directory: string;
  /** Reuse the preview's file list; direct ingress may scan on import. */
  files?: FileItem[];
  flatten: boolean;
}

export interface FolderImportOptions {
  signal?: AbortSignal;
  onProgress?: (completed: number, total: number) => void;
}

interface ImportFromFolderDialogProps {
  initialDirectory: string;
  initialFolderMode?: 'keep' | 'flatten';
  onPickDirectory: () => Promise<string | undefined>;
  onScanDirectory: (directory: string, signal: AbortSignal) => Promise<FileItem[]>;
  onCancel: () => void;
  onConfirm: (
    result: ImportFromFolderResult,
    signal: AbortSignal,
    onProgress: (completed: number, total: number) => void,
  ) => Promise<void>;
}

type Scan =
  | { directory: string; status: 'scanning' | 'error' }
  | { directory: string; status: 'ready'; files: FileItem[] };

const ImportFromFolderDialog: React.FC<ImportFromFolderDialogProps> = ({
  initialDirectory,
  initialFolderMode = 'keep',
  onPickDirectory,
  onScanDirectory,
  onCancel,
  onConfirm,
}) => {
  const _ = useTranslation();
  const [directory, setDirectory] = useState(initialDirectory);
  const [keepGroups, setKeepGroups] = useState(initialFolderMode === 'keep');
  const [scan, setScan] = useState<Scan | null>(null);
  const [retry, setRetry] = useState(0);
  const [picking, setPicking] = useState(false);
  const [pickError, setPickError] = useState(false);
  const [importError, setImportError] = useState(false);
  const [progress, setProgress] = useState<{ completed: number; total: number } | null>(null);
  const [stopping, setStopping] = useState(false);
  const scanController = useRef<AbortController | null>(null);
  const importController = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      scanController.current?.abort();
      importController.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!directory) return;
    const controller = new AbortController();
    scanController.current = controller;
    setScan({ directory, status: 'scanning' });
    setImportError(false);
    void (async () => {
      try {
        const files = await onScanDirectory(directory, controller.signal);
        if (controller.signal.aborted) return;
        // Native scans filter extensions; the JS fallback may return all files.
        const supported = files.filter((file) =>
          SUPPORTED_BOOK_EXTS.includes(file.path.split('.').pop()?.toLowerCase() ?? ''),
        );
        setScan({ directory, status: 'ready', files: supported });
      } catch {
        if (!controller.signal.aborted) setScan({ directory, status: 'error' });
      }
    })();
    return () => controller.abort();
  }, [directory, retry, onScanDirectory]);

  const files = scan?.directory === directory && scan.status === 'ready' ? scan.files : null;
  const hasSubfolders = files?.some((file) => /[\\/]/.test(file.path)) ?? false;
  const importing = progress !== null;
  const canImport = !!files?.length && !picking && !importing;

  // Dialog retains keyboard listeners for its lifetime. Read current refs so
  // Escape / Android Back also stop an in-flight import safely.
  const handleClose = useCallback(() => {
    if (importController.current) {
      importController.current.abort();
      setStopping(true);
      return;
    }
    scanController.current?.abort();
    onCancelRef.current();
  }, []);

  const handlePickDirectory = async () => {
    if (picking || importController.current) return;
    setPicking(true);
    setPickError(false);
    try {
      const picked = await onPickDirectory();
      if (!mounted.current) return;
      if (picked) {
        setDirectory(picked);
        if (picked === directory) setRetry((value) => value + 1);
      }
    } catch {
      if (mounted.current) setPickError(true);
    } finally {
      if (mounted.current) setPicking(false);
    }
  };

  const handleConfirm = async () => {
    if (!canImport || !files || importController.current) return;
    const controller = new AbortController();
    importController.current = controller;
    setImportError(false);
    setStopping(false);
    setProgress({ completed: 0, total: files.length });
    try {
      await onConfirm(
        { directory, files, flatten: !hasSubfolders || !keepGroups },
        controller.signal,
        (completed, total) => {
          if (mounted.current) setProgress({ completed, total });
        },
      );
      if (mounted.current) onCancelRef.current();
    } catch (error) {
      if (mounted.current) {
        if (controller.signal.aborted && error instanceof Error && error.name === 'AbortError')
          onCancelRef.current();
        else setImportError(true);
      }
    } finally {
      importController.current = null;
      if (mounted.current) {
        setProgress(null);
        setStopping(false);
      }
    }
  };

  return (
    <Dialog
      isOpen
      title={_('Import Books')}
      snapHeight={0.5}
      onClose={handleClose}
      boxClassName='glossa-folder-import-dialog sm:min-w-[420px] sm:max-w-[480px] sm:h-auto sm:max-h-[90%]'
      contentClassName='!px-6 !py-2'
    >
      <form
        className='flex flex-col gap-4 pt-2 pb-2'
        onSubmit={(event) => {
          event.preventDefault();
          void handleConfirm();
        }}
      >
        <button
          type='button'
          onClick={() => void handlePickDirectory()}
          disabled={picking || importing}
          className='eink-bordered border-base-300 bg-base-200/40 hover:bg-base-200/70 flex min-h-14 w-full items-center gap-3 rounded-lg px-3 py-3 text-start text-sm disabled:opacity-45'
          title={directory || _('Choose a folder')}
          aria-label={directory ? _('Change') : _('Choose a folder')}
        >
          <FolderOpen aria-hidden='true' className='text-base-content/70 h-5 w-5 shrink-0' />
          <span className='min-w-0 flex-1'>
            <span className='block truncate font-medium'>
              {directory
                ? getFilename(directory.replace(/[\\/]+$/, '')) || directory
                : _('Choose a folder')}
            </span>
            {directory && (
              <span className='text-base-content/60 mt-0.5 block truncate text-xs' dir='auto'>
                {directory}
              </span>
            )}
          </span>
          {picking ? (
            <span className='loading loading-spinner loading-xs' aria-hidden='true' />
          ) : (
            directory && (
              <span className='text-base-content/65 shrink-0 text-xs'>{_('Change')}</span>
            )
          )}
        </button>

        {directory && (
          <div
            className='text-base-content/70 flex min-h-6 items-center gap-2 text-sm'
            role='status'
            aria-live='polite'
            aria-atomic='true'
          >
            {progress ? (
              stopping ? (
                _('Stopping…')
              ) : (
                _('Importing {{completed}} of {{total}} books…', progress)
              )
            ) : scan?.directory !== directory || scan.status === 'scanning' ? (
              <>
                <span className='loading loading-spinner loading-xs' aria-hidden='true' />
                {_('Scanning folder…')}
              </>
            ) : scan.status === 'ready' ? (
              scan.files.length ? (
                _('Found {{count}} books', { count: scan.files.length })
              ) : (
                _('No books found in this folder.')
              )
            ) : null}
          </div>
        )}

        {(pickError ||
          importError ||
          (scan?.directory === directory && scan.status === 'error')) && (
          <div className='flex flex-wrap items-center justify-between gap-2 text-sm' role='alert'>
            <span>
              {importError
                ? _('Couldn’t finish importing. Please try again.')
                : pickError
                  ? _('Couldn’t open the folder picker. Please try again.')
                  : _('Couldn’t read this folder. Choose it again or try another location.')}
            </span>
            {!importError && (
              <button
                type='button'
                className='btn btn-ghost btn-sm'
                onClick={() => {
                  if (pickError) {
                    void handlePickDirectory();
                    return;
                  }
                  setPickError(false);
                  setRetry((value) => value + 1);
                }}
              >
                {_('Try again')}
              </button>
            )}
          </div>
        )}

        {hasSubfolders && (
          <label className='flex min-h-11 cursor-pointer items-center gap-3 rounded-lg text-sm'>
            <input
              type='checkbox'
              className='checkbox checkbox-sm'
              checked={keepGroups}
              disabled={importing}
              onChange={(event) => setKeepGroups(event.target.checked)}
            />
            <span>{_('Keep subfolder groups')}</span>
          </label>
        )}

        <div className='mt-1 flex justify-end gap-2'>
          <button
            type='button'
            className='btn btn-ghost btn-sm eink-bordered'
            disabled={stopping}
            onClick={handleClose}
          >
            {_('Cancel')}
          </button>
          <button type='submit' className='btn btn-contrast btn-sm' disabled={!canImport}>
            {files?.length ? _('Import {{count}} books', { count: files.length }) : _('Import')}
          </button>
        </div>
      </form>
    </Dialog>
  );
};

export default ImportFromFolderDialog;
