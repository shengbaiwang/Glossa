import { useEffect, useRef, useState } from 'react';
import { VirtuosoGrid, type VirtuosoGridHandle } from 'react-virtuoso';
import { LayoutGrid, Ellipsis, Square, CheckSquare2 } from '@/components/GlossaIcons';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/primitives/dropdown-menu';
import type { BookDoc } from '@/libs/document';
import { useReaderStore } from '@/store/readerStore';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { Dialog, DialogContent, DialogTitle } from '@/components/primitives/dialog';
import { writeTextToClipboard } from '@/utils/clipboard';
import { copyPDFImage, selectPDFRegion, type PDFRegion } from '@/services/pdfWorkspace';

export default function PDFPages({ bookDoc, bookKey }: { bookDoc: BookDoc; bookKey: string }) {
  const _ = useTranslation();
  const { appService } = useEnv();
  const gridRef = useRef<VirtuosoGridHandle>(null);
  const urls = useRef(new Map<number, string>());
  const [visible, setVisible] = useState({ startIndex: 0, endIndex: 0 });
  const [menuOpen, setMenuOpen] = useState(false);
  const [multiSelect, setMultiSelect] = useState(false);
  const [overview, setOverview] = useState(false);
  const [images, setImages] = useState<Record<number, string>>({});
  const [error, setError] = useState('');
  const [thumbnailError, setThumbnailError] = useState(false);
  const [thumbnailAttempt, setThumbnailAttempt] = useState(0);
  const pendingFocus = useRef<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const sidebar = useRef<HTMLDivElement>(null);
  const [selecting, setSelecting] = useState(false);
  const [selection, setSelection] = useState<{
    index: number;
    region: PDFRegion;
    text: string;
  } | null>(null);
  const [first, setFirst] = useState<number | null>(null);
  const [last, setLast] = useState<number | null>(null);
  const count = bookDoc.sections.length;
  const view = useReaderStore((s) => s.getView(bookKey));
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    const cache = urls.current;
    return () => {
      active.current = false;
      cache.forEach(URL.revokeObjectURL);
      cache.clear();
    };
  }, []);
  const currentPage = () => Math.max(0, view?.renderer?.index ?? view?.renderer?.primaryIndex ?? 0);
  const [current, setCurrent] = useState(currentPage);
  const [focused, setFocused] = useState(currentPage);
  const gridRoot = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const update = () =>
      setCurrent(Math.max(0, view?.renderer?.index ?? view?.renderer?.primaryIndex ?? 0));
    update();
    view?.addEventListener('relocate', update);
    return () => view?.removeEventListener('relocate', update);
  }, [view]);
  useEffect(() => {
    setFocused(current);
    const frame = requestAnimationFrame(() =>
      gridRef.current?.scrollToIndex({ index: current, align: 'center' }),
    );
    return () => cancelAnimationFrame(frame);
  }, [current, overview]);
  useEffect(() => {
    const target = pendingFocus.current;
    if (target === null) return;
    const button = gridRoot.current?.querySelector<HTMLButtonElement>(
      `button[data-pdf-page="${target}"]`,
    );
    if (button) {
      button.focus({ preventScroll: true });
      pendingFocus.current = null;
    }
  }, [focused, visible, overview]);
  useEffect(() => {
    let cancelled = false;
    const cache = urls.current;
    for (const [index, url] of cache) {
      if (index < visible.startIndex || index > visible.endIndex) {
        URL.revokeObjectURL(url);
        cache.delete(index);
      }
    }
    setImages(Object.fromEntries(cache));
    setThumbnailError(false);
    void (async () => {
      let failed = false;
      for (let i = visible.startIndex; i <= Math.min(visible.endIndex, count - 1); i++) {
        if (cache.has(i)) continue;
        try {
          const blob = await bookDoc.getPDFImage!(i, 180);
          if (cancelled) return;
          cache.set(i, URL.createObjectURL(blob));
          setImages(Object.fromEntries(cache));
        } catch {
          if (cancelled) return;
          failed = true;
        }
      }
      if (!cancelled) setThumbnailError(failed);
    })();
    return () => {
      cancelled = true;
    };
  }, [bookDoc, count, visible, thumbnailAttempt]);
  useEffect(() => {
    if (!selecting || !view?.renderer) return;
    return selectPDFRegion(
      view.renderer,
      (index, region, text) => {
        setSelection({ index, region, text });
        setSelecting(false);
      },
      () => setSelecting(false),
    );
  }, [selecting, view]);
  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    setCopied(false);
    setError('');
    try {
      await task();
    } catch {
      if (active.current) setError('PDF action failed. Please retry.');
    } finally {
      if (active.current) setBusy(false);
    }
  };
  const copyText = async (text: string) => {
    if (!(await writeTextToClipboard(text))) throw new Error('clipboard');
    if (active.current) setCopied(true);
  };
  const saveRegion = async () => {
    if (!selection) return;
    const blob = await bookDoc.getPDFImage!(selection.index, 2400, selection.region);
    const saved = await appService?.saveFile(
      `page-${selection.index + 1}.png`,
      await blob.arrayBuffer(),
      { mimeType: 'image/png' },
    );
    if (!saved) return;
  };
  const pageLabel = (index: number) => bookDoc.pageList?.[index]?.label ?? String(index + 1);
  const printedLabel = (index: number) =>
    pageLabel(index) !== String(index + 1)
      ? _('Printed page {{page}}', { page: pageLabel(index) })
      : '';
  const clearPages = () => {
    setFirst(null);
    setLast(null);
    setMultiSelect(false);
  };
  const controls = (
    <>
      <div className='glossa-pdf-pages-toolbar'>
        <div className='glossa-pdf-page-position'>
          <span>
            {count ? current + 1 : 0} / {count}
          </span>
          {printedLabel(current) && (
            <span className='glossa-pdf-printed-page'>{printedLabel(current)}</span>
          )}
        </div>
        {!overview && (
          <button
            type='button'
            className='glossa-pdf-icon-action'
            aria-label={_('Page overview')}
            title={_('Page overview')}
            onClick={() => setOverview(true)}
          >
            <LayoutGrid size={18} />
          </button>
        )}
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <button
              type='button'
              className='glossa-pdf-icon-action'
              aria-label={_('Page actions')}
              title={_('Page actions')}
            >
              <Ellipsis size={18} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end'>
            <DropdownMenuItem
              onSelect={() => {
                setOverview(false);
                setSelection(null);
                setSelecting(!selecting);
              }}
            >
              <Square />
              {_(selecting ? 'Cancel area selection' : 'Select area')}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                if (multiSelect) clearPages();
                else setMultiSelect(true);
              }}
            >
              <CheckSquare2 />
              {_(multiSelect ? 'Cancel page selection' : 'Select pages')}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => gridRef.current?.scrollToIndex({ index: current, align: 'center' })}
            >
              <LayoutGrid />
              {_('Current page')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {multiSelect && (
        <div className='glossa-pdf-actions'>
          <span>{_('Select pages')}</span>
          <button type='button' onClick={clearPages}>
            {_('Done')}
          </button>
        </div>
      )}
      {selecting && (
        <p role='status'>{_('Drag on the page to select a column or image. Escape cancels.')}</p>
      )}
      {selection && (
        <div className='glossa-pdf-actions'>
          <button
            type='button'
            disabled={busy || !selection.text}
            onClick={() => void run(() => copyText(selection.text))}
          >
            {_('Copy area text')}
          </button>
          <button
            type='button'
            disabled={busy}
            onClick={() =>
              void run(async () => {
                if (selection)
                  await copyPDFImage(
                    await bookDoc.getPDFImage!(selection.index, 2400, selection.region),
                  );
                if (active.current) setCopied(true);
              })
            }
          >
            {_('Copy area image')}
          </button>
          <button type='button' disabled={busy} onClick={() => void run(saveRegion)}>
            {_('Save area image')}
          </button>
          <button type='button' onClick={() => setSelection(null)}>
            {_('Clear')}
          </button>
        </div>
      )}
      {first !== null && last !== null && (
        <div className='glossa-pdf-actions'>
          <span>
            {Math.min(first, last) + 1}–{Math.max(first, last) + 1}
          </span>
          <button
            type='button'
            disabled={busy || Math.abs(last - first) >= 24}
            onClick={() =>
              void run(async () => {
                const text: string[] = [];
                let chars = 0;
                for (let i = Math.min(first, last); i <= Math.max(first, last); i++) {
                  if (!active.current) return;
                  const value = await bookDoc.getPDFText!(i);
                  chars += value.length;
                  if (chars > 100000) throw new Error('limit');
                  text.push(value);
                }
                if (active.current) await copyText(text.join('\n\n'));
              })
            }
          >
            {_('Copy selected pages')}
          </button>
          <button
            type='button'
            onClick={() => {
              setFirst(null);
              setLast(null);
            }}
          >
            {_('Clear')}
          </button>
        </div>
      )}
      {thumbnailError && (
        <div className='glossa-pdf-actions' role='alert'>
          <span>{_('Could not render PDF pages')}</span>
          <button type='button' onClick={() => setThumbnailAttempt((value) => value + 1)}>
            {_('Retry')}
          </button>
        </div>
      )}
      {error && <p role='alert'>{_(error)}</p>}
      {copied && <p role='status'>{_('Copied')}</p>}
      {first !== null && last !== null && Math.abs(last - first) >= 24 && (
        <p role='alert'>{_('Processing limit reached. Use fewer pages or retry later.')}</p>
      )}
    </>
  );
  const grid = (
    <VirtuosoGrid
      ref={gridRef}
      scrollerRef={(element) => {
        gridRoot.current = element as HTMLDivElement | null;
      }}
      className='glossa-pdf-page-scroller'
      totalCount={count}
      initialTopMostItemIndex={current}
      overscan={200}
      listClassName='glossa-pdf-page-grid'
      itemClassName='glossa-pdf-page-tile'
      rangeChanged={setVisible}
      itemContent={(index) => (
        <>
          <button
            type='button'
            data-pdf-page={index}
            tabIndex={index === focused ? 0 : -1}
            onFocus={() => setFocused(index)}
            aria-current={index === current ? 'page' : undefined}
            aria-label={`${_('Page')} ${index + 1}${printedLabel(index) ? `, ${printedLabel(index)}` : ''}`}
            onClick={() => {
              setOverview(false);
              void view?.goTo(index);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && multiSelect) {
                event.stopPropagation();
                clearPages();
                return;
              }
              const columns = getComputedStyle(
                event.currentTarget.closest('.glossa-pdf-page-grid')!,
              ).gridTemplateColumns.split(' ').length;
              const direction = getComputedStyle(event.currentTarget).direction === 'rtl' ? -1 : 1;
              const offset = {
                ArrowLeft: -direction,
                ArrowRight: direction,
                ArrowUp: -columns,
                ArrowDown: columns,
              }[event.key];
              const target =
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? count - 1
                    : offset !== undefined
                      ? Math.max(0, Math.min(count - 1, index + offset))
                      : null;
              if (target !== null) {
                event.preventDefault();
                pendingFocus.current = target;
                setFocused(target);
                gridRef.current?.scrollToIndex({ index: target, align: 'center' });
              }
            }}
          >
            <div className='glossa-pdf-thumbnail'>
              {images[index] ? (
                <img src={images[index]} alt='' draggable={false} />
              ) : (
                <span aria-hidden='true'>…</span>
              )}
            </div>
            <span className='glossa-pdf-thumbnail-label'>{index + 1}</span>
            {printedLabel(index) && (
              <span className='glossa-pdf-printed-page'>{printedLabel(index)}</span>
            )}
          </button>
          {multiSelect && (
            <input
              type='checkbox'
              aria-label={`${_('Select page')} ${index + 1}`}
              checked={
                first !== null &&
                last !== null &&
                index >= Math.min(first, last) &&
                index <= Math.max(first, last)
              }
              onChange={(e) => {
                if (!e.target.checked) {
                  setFirst(null);
                  setLast(null);
                } else if (first === null) {
                  setFirst(index);
                  setLast(index);
                } else setLast(index);
              }}
            />
          )}
        </>
      )}
    />
  );
  return (
    <>
      {!overview && (
        <div
          ref={sidebar}
          className='glossa-pdf-pages'
          onContextMenu={(event) => {
            event.preventDefault();
            setMenuOpen(true);
          }}
        >
          {controls}
          {grid}
        </div>
      )}
      <Dialog open={overview} onOpenChange={setOverview}>
        <DialogContent
          className='glossa-pdf-pages glossa-pdf-overview'
          aria-describedby={undefined}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            requestAnimationFrame(() =>
              sidebar.current?.querySelector<HTMLButtonElement>('[aria-label]')?.focus(),
            );
          }}
        >
          <DialogTitle className='sr-only'>{_('Page overview')}</DialogTitle>
          {controls}
          {grid}
        </DialogContent>
      </Dialog>
    </>
  );
}
