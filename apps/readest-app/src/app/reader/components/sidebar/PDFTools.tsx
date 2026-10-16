import { useEffect, useRef, useState } from 'react';
import type { BookDoc } from '@/libs/document';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { useSettingsStore } from '@/store/settingsStore';
import {
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  Pencil,
  Trash2,
} from '@/components/GlossaIcons';
import {
  buildOutlineCandidates,
  changeOutlineLevel,
  moveOutlineBranch,
  removeOutlineEntry,
  cancelPDFOCR,
  getPDFOCRStatus,
  OCRPageText,
  openPDFCache,
  readOCRPage,
  savePDFOutline,
  startPDFOCR,
  waitForPDFOCR,
  type OutlineCandidate,
  type PDFCache,
  type PDFOCRStatus,
  type PDFOutlineEntry,
} from '@/services/pdfEnhancement';

const errorKey = (error: unknown) => {
  const code = error instanceof Error ? error.message : String(error);
  if (code.includes('pdf_ocr_busy')) return 'Another PDF is being recognized';
  if (code.includes('pdf_source_changed')) return 'The PDF changed. Reopen it before retrying.';
  if (code.includes('pdf_outline_conflict'))
    return 'The outline changed in another window. Reopen it before saving.';
  if (code.includes('limit')) return 'Processing limit reached. Use fewer pages or retry later.';
  return 'PDF processing failed. Saved progress is available for retry.';
};

export default function PDFTools({ bookKey, bookDoc }: { bookKey: string; bookDoc: BookDoc }) {
  const _ = useTranslation();
  const { appService, envConfig } = useEnv();
  const [cache, setCache] = useState<PDFCache | null>(bookDoc.pdfCache ?? null);
  const [status, setStatus] = useState<PDFOCRStatus | null>(null);
  const [working, setWorking] = useState(false);
  const [cancellable, setCancellable] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<OutlineCandidate[]>([]);
  const [editRow, setEditRow] = useState<number | null>(null);
  const [rename, setRename] = useState('');
  const [ready, setReady] = useState(false);
  const [offset, setOffset] = useState(0);
  const [first, setFirst] = useState(1);
  const [last, setLast] = useState(Math.min(12, bookDoc.sections.length));
  const [history, setHistory] = useState<OutlineCandidate[][]>([]);
  const [savedUndo, setSavedUndo] = useState<{ outline: PDFOutlineEntry[] | null } | null>(null);
  const dragIndex = useRef<number | null>(null);
  const operation = useRef<AbortController | null>(null);
  const source = useRef<string | null>(null);
  const pageCount = bookDoc.sections.length;

  useEffect(() => {
    const controller = new AbortController();
    operation.current = controller;
    source.current = null;
    const load = async () => {
      const book = useBookDataStore.getState().getBookData(bookKey)?.book;
      if (!book || !appService) return;
      const path = await appService.resolveNativeBookFilePath(book);
      if (controller.signal.aborted || !path) return;
      source.current = path;
      setReady(true);
      const existing = await openPDFCache(path);
      if (controller.signal.aborted) return;
      setCache(existing);
      if (existing) {
        const active = await getPDFOCRStatus(existing.id);
        if (controller.signal.aborted) return;
        setStatus(active);
        if (active?.state === 'running') {
          setWorking(true);
          setCancellable(true);
          await waitForPDFOCR(existing.id, controller.signal, setStatus);
          if (!controller.signal.aborted) {
            setCache(await openPDFCache(path));
            setWorking(false);
          }
        }
      }
    };
    void load().catch((e) => {
      if (!controller.signal.aborted) {
        setError(errorKey(e));
        setWorking(false);
      }
    });
    return () => {
      controller.abort();
      operation.current?.abort();
    }; // The native task continues while reading elsewhere.
  }, [bookKey, appService]);

  const getCache = async () => {
    if (!source.current) throw new Error('pdf_unavailable');
    const current = await openPDFCache(source.current, true);
    if (!current) throw new Error('pdf_unavailable');
    setCache(current);
    return current;
  };
  const recognize = async (pages: number[], controller: AbortController) => {
    const current = await getCache();
    if (controller.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    const started = await startPDFOCR(source.current!, current.id, pages);
    if (controller.signal.aborted) {
      await cancelPDFOCR(started.cacheId);
      throw new DOMException('Cancelled', 'AbortError');
    }
    setStatus(started);
    const done = await waitForPDFOCR(current.id, controller.signal, setStatus);
    if (done.state === 'cancelled') throw new DOMException('Cancelled', 'AbortError');
    if (done.state !== 'completed') throw new Error(done.error ?? 'pdf_worker_failed');
    const refreshed = await getCache();
    return refreshed;
  };
  const run = async (task: (controller: AbortController) => Promise<void>, canCancel = false) => {
    operation.current?.abort();
    const controller = new AbortController();
    operation.current = controller;
    setWorking(true);
    setCancellable(canCancel);
    setError('');
    try {
      await task(controller);
    } catch (e) {
      if (!controller.signal.aborted && !(e instanceof DOMException && e.name === 'AbortError'))
        setError(errorKey(e));
    } finally {
      if (!controller.signal.aborted) setWorking(false);
    }
  };
  const cancel = async () => {
    operation.current?.abort();
    try {
      if (cache) {
        await cancelPDFOCR(cache.id);
        setStatus(await getPDFOCRStatus(cache.id));
      }
      setWorking(false);
    } catch (e) {
      setError(errorKey(e));
    }
  };
  const reload = async () => {
    const signal = operation.current?.signal;
    const store = useBookDataStore.getState();
    const current = store.getConfig(bookKey);
    if (current) {
      const location = useReaderStore.getState().getView(bookKey)?.lastLocation?.cfi;
      const updated = { ...current, ...(location ? { location } : {}) };
      store.setConfig(bookKey, updated);
      await store.saveConfig(envConfig, bookKey, updated, useSettingsStore.getState().settings);
    }
    if (!signal?.aborted) useReaderStore.getState().recreateViewer(envConfig, bookKey);
  };
  const change = (next: OutlineCandidate[]) => {
    setHistory((previous) => [...previous.slice(-19), draft]);
    setDraft(next);
  };
  const update = (index: number, patch: Partial<OutlineCandidate>) =>
    change(
      draft.map((entry, i) => (i === index ? { ...entry, ...patch, verified: false } : entry)),
    );
  const move = (from: number, to: number) => {
    const next = moveOutlineBranch(draft, from, to);
    if (next !== draft) change(next);
  };
  const scan = async (controller: AbortController) => {
    if (
      !Number.isInteger(first) ||
      !Number.isInteger(last) ||
      first < 1 ||
      last < first ||
      last > pageCount ||
      last - first >= 24
    )
      throw new Error('pdf_page_limit');
    let current = await recognize(
      Array.from({ length: last - first + 1 }, (_, i) => first - 1 + i),
      controller,
    );
    const text = async (index: number) => {
      const native = await bookDoc.getPDFText?.(index);
      return native?.trim() ? native : OCRPageText(await readOCRPage(current.id, index));
    };
    const lines: string[] = [];
    for (let i = first - 1; i < last; i++) {
      if (controller.signal.aborted) return;
      lines.push(...(await text(i)).split('\n'));
    }
    const labels =
      bookDoc.pageList?.map((p) => p.label) ??
      Array.from({ length: pageCount }, (_, i) => String(i + 1));
    const initial = buildOutlineCandidates(lines, labels, new Map(), offset);
    if (!initial.length) {
      setError('No matching contents entries. Check the contents pages and printed page labels.');
      return;
    }
    const targets = [...new Set(initial.map((item) => item.pageIndex))];
    if (targets.length > 48) throw new Error('pdf_page_limit');
    current = await recognize(targets, controller);
    const texts = new Map<number, string>();
    for (const index of targets) {
      if (controller.signal.aborted) return;
      texts.set(index, await text(index));
    }
    if (!controller.signal.aborted) change(buildOutlineCandidates(lines, labels, texts, offset));
  };
  const apply = async (outline: PDFOutlineEntry[] | null, remember = true) => {
    const signal = operation.current?.signal;
    const current = cache ?? (await getCache());
    const saved = await savePDFOutline(source.current!, current, outline, pageCount);
    if (signal?.aborted) return;
    if (remember) setSavedUndo({ outline: current.outline });
    setCache(saved);
    setEditing(false);
    await reload();
  };
  const statusText =
    status?.state === 'completed'
      ? _('Text recognition complete')
      : status?.state === 'cancelled'
        ? _('Cancelled')
        : status?.state === 'failed'
          ? _('Recognition interrupted')
          : _('Recognizing text');

  return (
    <div className='glossa-pdf-tools'>
      <div className='glossa-pdf-actions'>
        <button
          type='button'
          disabled={!ready || working || pageCount > 5000}
          onClick={() =>
            void run(async (controller) => {
              await recognize(
                Array.from({ length: pageCount }, (_, i) => i),
                controller,
              );
            }, true)
          }
        >
          {status?.state === 'failed' || status?.state === 'cancelled'
            ? _('Retry text recognition')
            : _('Recognize text')}
        </button>
        <button
          type='button'
          disabled={!ready || working}
          aria-expanded={editing}
          onClick={() => {
            setEditing(!editing);
            if (!editing && !draft.length && cache?.outline)
              setDraft(cache.outline.map((e) => ({ ...e, verified: false })));
          }}
        >
          {_('Repair contents')}
        </button>
      </div>
      {(status || working) && (
        <div role='status' aria-live='polite' className='glossa-pdf-status'>
          <span>
            {status ? `${statusText} ${status.completed}/${status.total}` : _('Processing PDF')}
          </span>
          {working && cancellable ? (
            <button type='button' onClick={() => void cancel()}>
              {_('Cancel')}
            </button>
          ) : (
            !!cache?.pages.length && (
              <button
                type='button'
                disabled={working}
                onClick={() => void run(async () => reload())}
              >
                {_('Apply recognized text')}
              </button>
            )
          )}
        </div>
      )}
      {!status && !working && !!cache?.pages.length && (
        <div className='glossa-pdf-status'>
          <span>
            {_('Saved pages')}: {cache.pages.length}
          </span>
          <button type='button' disabled={working} onClick={() => void run(async () => reload())}>
            {_('Apply recognized text')}
          </button>
        </div>
      )}
      {error && (
        <p role='alert' className='glossa-pdf-error'>
          {_(error)}
        </p>
      )}
      {savedUndo && (
        <button
          type='button'
          disabled={working}
          onClick={() =>
            void run(async () => {
              await apply(savedUndo.outline, false);
              setSavedUndo(null);
            })
          }
        >
          {_('Undo contents change')}
        </button>
      )}
      {editing && (
        <div className='glossa-pdf-outline'>
          <div className='glossa-pdf-actions'>
            <label>
              {_('Contents pages')}{' '}
              <input
                aria-label={_('First contents page')}
                type='number'
                min={1}
                max={pageCount}
                value={first}
                onChange={(e) => setFirst(e.target.valueAsNumber)}
              />
            </label>
            <span aria-hidden='true'>–</span>
            <input
              aria-label={_('Last contents page')}
              type='number'
              min={first}
              max={pageCount}
              value={last}
              onChange={(e) => setLast(e.target.valueAsNumber)}
            />
            <label>
              {_('Printed page offset')}{' '}
              <input
                type='number'
                min={-pageCount}
                max={pageCount}
                value={offset}
                aria-label={_('Printed page offset')}
                onChange={(e) => setOffset(e.target.valueAsNumber)}
              />
            </label>
            <button type='button' disabled={working} onClick={() => void run(scan, true)}>
              {_('Recognize contents')}
            </button>
          </div>
          <ol>
            {draft.map((entry, index) => (
              <li
                key={index}
                style={{ paddingInlineStart: `${entry.level * 12}px` }}
                draggable={!working && editRow === null}
                onDragStart={(e) => {
                  dragIndex.current = index;
                  e.dataTransfer.setData('text/x-glossa-pdf-outline', String(index));
                }}
                onDragOver={(e) => {
                  if (dragIndex.current !== null) e.preventDefault();
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragIndex.current !== null) {
                    const from = dragIndex.current;
                    let end = from + 1;
                    while (end < draft.length && draft[end]!.level > draft[from]!.level) end++;
                    if (index < from || index >= end) move(from, index);
                  }
                  dragIndex.current = null;
                }}
                onDragEnd={() => {
                  dragIndex.current = null;
                }}
              >
                <div className='glossa-pdf-outline-row'>
                  {editRow === index ? (
                    <input
                      autoFocus
                      aria-label={_('Chapter title')}
                      value={rename}
                      maxLength={500}
                      disabled={working}
                      onChange={(e) => setRename(e.target.value)}
                      onBlur={() => {
                        if (rename.trim()) update(index, { title: rename.trim() });
                        setEditRow(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') e.currentTarget.blur();
                        if (e.key === 'Escape') {
                          setEditRow(null);
                        }
                      }}
                    />
                  ) : (
                    <button
                      type='button'
                      className='glossa-pdf-title'
                      title={_('Double-click to rename')}
                      onClick={() =>
                        void useReaderStore
                          .getState()
                          .getView(bookKey)
                          ?.goTo(JSON.stringify([entry.pageIndex, { name: 'Fit' }]))
                      }
                      onDoubleClick={() => {
                        if (working) return;
                        setRename(entry.title);
                        setEditRow(index);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'F2' && !working) {
                          e.preventDefault();
                          setRename(entry.title);
                          setEditRow(index);
                        }
                      }}
                    >
                      {entry.title}
                      {!entry.verified && (
                        <span className='glossa-pdf-unverified'>{_('Check')}</span>
                      )}
                    </button>
                  )}
                  <input
                    type='number'
                    aria-label={_('Destination page')}
                    title={_('PDF page number')}
                    min={1}
                    max={pageCount}
                    value={entry.pageIndex + 1}
                    disabled={working}
                    onChange={(e) => update(index, { pageIndex: e.target.valueAsNumber - 1 })}
                  />
                </div>
                <div className='glossa-pdf-row-actions'>
                  <button
                    type='button'
                    aria-label={_('Rename')}
                    disabled={working}
                    onClick={() => {
                      setRename(entry.title);
                      setEditRow(index);
                    }}
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    type='button'
                    aria-label={_('Move up')}
                    disabled={index === 0 || working}
                    onClick={() => move(index, index - 1)}
                  >
                    <ChevronUp size={14} />
                  </button>
                  <button
                    type='button'
                    aria-label={_('Move down')}
                    disabled={index === draft.length - 1 || working}
                    onClick={() => move(index, index + 1)}
                  >
                    <ChevronDown size={14} />
                  </button>
                  <button
                    type='button'
                    aria-label={_('Outdent')}
                    disabled={entry.level === 0 || working}
                    onClick={() => change(changeOutlineLevel(draft, index, -1))}
                  >
                    <ChevronLeft size={14} />
                  </button>
                  <button
                    type='button'
                    aria-label={_('Indent')}
                    disabled={
                      index === 0 ||
                      entry.level >= Math.min(5, draft[index - 1]!.level + 1) ||
                      working
                    }
                    onClick={() => change(changeOutlineLevel(draft, index, 1))}
                  >
                    <ChevronRight size={14} />
                  </button>
                  <button
                    type='button'
                    aria-label={_('Delete')}
                    disabled={working}
                    onClick={() => change(removeOutlineEntry(draft, index))}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </li>
            ))}
          </ol>
          <div className='glossa-pdf-actions'>
            <button
              type='button'
              disabled={working}
              onClick={() =>
                change([
                  ...draft,
                  { title: _('New chapter'), pageIndex: 0, level: 0, verified: false },
                ])
              }
            >
              {_('Add chapter')}
            </button>
            <button
              type='button'
              disabled={!history.length || working}
              onClick={() => {
                setDraft(history[history.length - 1]!);
                setHistory(history.slice(0, -1));
              }}
            >
              {_('Undo')}
            </button>
            <button
              type='button'
              className='btn-contrast'
              disabled={!draft.length || working}
              onClick={() => void run(async () => apply(draft))}
            >
              {_('Apply')}
            </button>
            <button
              type='button'
              disabled={!cache?.outline || working}
              onClick={() => void run(async () => apply(null))}
            >
              {_('Restore original contents')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
