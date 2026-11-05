import { useEffect, useRef, useState } from 'react';
import {
  Expand,
  Margins,
  MoveHorizontal,
  Minus,
  Plus,
  ChevronDown,
} from '@/components/GlossaIcons';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/primitives/dropdown-menu';
import { useReaderStore } from '@/store/readerStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { saveViewSettings } from '@/helpers/settings';
import { MAX_ZOOM_LEVEL, MIN_ZOOM_LEVEL, ZOOM_STEP } from '@/services/constants';
import type { ViewSettings } from '@/types/book';
import { preparePDFContentFit } from '@/services/pdfWorkspace';

type ZoomChange = { bookKey: string; mode: ViewSettings['zoomMode']; level: number };

export default function PDFScaleControls({ bookKey }: { bookKey: string }) {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const { getView, getViewSettings, setViewSettings } = useReaderStore();
  const { getBookData } = useBookDataStore();
  const view = getView(bookKey);
  const settings = getViewSettings(bookKey);
  const bookData = getBookData(bookKey);
  const bookDoc = bookData?.bookDoc;
  const isPDF = bookData?.book?.format === 'PDF';
  const [scale, setScale] = useState(100);
  const [draft, setDraft] = useState('100');
  const [saving, setSaving] = useState(false);
  const scaleRef = useRef(100);
  const editing = useRef(false);
  const cancelDraft = useRef(false);
  const draftChanged = useRef(false);
  const sliding = useRef(false);
  const previewFrame = useRef(0);
  const persisting = useRef(false);
  const [failed, setFailed] = useState(false);
  const [fitting, setFitting] = useState(false);
  const [fitMessage, setFitMessage] = useState<'empty' | 'failed' | null>(null);
  const fitRequest = useRef<AbortController | null>(null);
  const pending = useRef<ZoomChange | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      cancelAnimationFrame(previewFrame.current);
    };
  }, []);
  useEffect(() => {
    fitRequest.current?.abort();
    fitRequest.current = null;
    setFitting(false);
    setFitMessage(null);
    return () => {
      fitRequest.current?.abort();
      cancelAnimationFrame(previewFrame.current);
      previewFrame.current = 0;
      sliding.current = false;
      editing.current = false;
      draftChanged.current = false;
      view?.renderer?.removeAttribute('zoom-preview');
    };
  }, [bookKey, view]);
  useEffect(() => {
    if (!isPDF || !view?.renderer) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const value = view.renderer.scale;
        if (!value || !Number.isFinite(value) || sliding.current) return;
        const percent = Math.round(value * 10000) / 100;
        scaleRef.current = percent;
        setScale(percent);
        if (!editing.current) setDraft(String(percent));
      });
    };
    const resize = new ResizeObserver(update);
    const attrs = new MutationObserver(update);
    resize.observe(view.renderer);
    attrs.observe(view.renderer, {
      attributes: true,
      attributeFilter: ['zoom', 'scale-factor', 'flow', 'scroll-direction'],
    });
    view.addEventListener('relocate', update);
    view.addEventListener('load', update);
    update();
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      attrs.disconnect();
      view.removeEventListener('relocate', update);
      view.removeEventListener('load', update);
    };
  }, [isPDF, view]);
  if (!isPDF || !settings || !view) return null;
  const persist = async () => {
    // Saving never blocks another zoom gesture. Keep one writer and collapse
    // queued intermediate values, so a slow earlier write cannot finish last.
    if (persisting.current || !pending.current) return;
    persisting.current = true;
    setSaving(true);
    setFailed(false);
    try {
      while (pending.current) {
        const change: ZoomChange = pending.current;
        try {
          await saveViewSettings(
            envConfig,
            change.bookKey,
            'zoomMode',
            change.mode,
            true,
            false,
            true,
          );
          if (pending.current !== change) continue;
          await saveViewSettings(
            envConfig,
            change.bookKey,
            'zoomLevel',
            change.level,
            true,
            false,
            true,
          );
          if (pending.current === change) pending.current = null;
        } catch {
          if (pending.current !== change) continue;
          if (alive.current) setFailed(true);
          break;
        }
      }
    } finally {
      persisting.current = false;
      if (alive.current) setSaving(false);
    }
  };
  const stopFit = () => {
    fitRequest.current?.abort();
    fitRequest.current = null;
    setFitting(false);
    setFitMessage(null);
  };
  const apply = (mode: ViewSettings['zoomMode'], level: number) => {
    stopFit();
    cancelAnimationFrame(previewFrame.current);
    previewFrame.current = 0;
    sliding.current = false;
    // Mode and percentage describe one zoom. Suppress the intermediate drawing
    // so entering a percentage or choosing a fit option commits only once.
    view.renderer.setAttribute('zoom-preview', '');
    view.renderer.setAttribute('zoom', mode);
    view.renderer.setAttribute('scale-factor', level);
    view.renderer.removeAttribute('zoom-preview');
    if (mode === 'original-size') {
      scaleRef.current = level;
      setScale(level);
      setDraft(String(level));
    }
    setViewSettings(bookKey, {
      ...(getViewSettings(bookKey) ?? settings),
      zoomMode: mode,
      zoomLevel: level,
    });
    pending.current = { bookKey, mode, level };
    void persist();
  };
  const clamp = (value: number) =>
    Math.round(Math.min(MAX_ZOOM_LEVEL, Math.max(MIN_ZOOM_LEVEL, value)) * 100) / 100;
  const commitDraft = () => {
    if (!draftChanged.current) return;
    draftChanged.current = false;
    if (cancelDraft.current) {
      cancelDraft.current = false;
      return;
    }
    const value = draft.trim().replace(/%$/, '').replace(',', '.');
    const level = Number(value);
    if (!value || !Number.isFinite(level)) {
      setDraft(String(scaleRef.current));
      return;
    }
    apply('original-size', clamp(level));
  };
  const preview = (value: number) => {
    stopFit();
    const level = clamp(value);
    sliding.current = true;
    scaleRef.current = level;
    setScale(level);
    setDraft(String(level));
    // Pointer events may arrive faster than the display refreshes. Layout is
    // updated at most once per frame; disk writes wait until the gesture ends.
    if (!previewFrame.current) {
      previewFrame.current = requestAnimationFrame(() => {
        previewFrame.current = 0;
        view.renderer.setAttribute('zoom-preview', '');
        view.renderer.setAttribute('zoom', 'original-size');
        view.renderer.setAttribute('scale-factor', scaleRef.current);
      });
    }
  };
  const commitSlide = () => {
    if (sliding.current) apply('original-size', scaleRef.current);
  };
  const fitContent = async () => {
    if (!bookDoc || !view.renderer.scrollToPageRect) return;
    fitRequest.current?.abort();
    const controller = new AbortController();
    fitRequest.current = controller;
    setFitting(true);
    setFitMessage(null);
    const index = view.renderer.index;
    const top = view.renderer.scrollTop,
      left = view.renderer.scrollLeft;
    const cancel = () => {
      if (
        view.renderer.index !== index ||
        view.renderer.scrollTop !== top ||
        view.renderer.scrollLeft !== left
      )
        controller.abort();
    };
    view.addEventListener('relocate', cancel);
    view.renderer.addEventListener('scroll', cancel);
    try {
      const result = await preparePDFContentFit(
        bookDoc,
        view.renderer,
        controller.signal,
        document.getElementById(`gridcell-${bookKey}`),
      );
      if (controller.signal.aborted || !alive.current) return;
      // Detach before our own zoom/scroll; those are the accepted result.
      view.removeEventListener('relocate', cancel);
      view.renderer.removeEventListener('scroll', cancel);
      if (result) {
        apply('original-size', result.level);
        view.renderer.scrollToPageRect(result.index, result.region, result.viewport);
      } else setFitMessage('empty');
    } catch {
      if (!controller.signal.aborted && alive.current) setFitMessage('failed');
    } finally {
      view.removeEventListener('relocate', cancel);
      view.renderer.removeEventListener('scroll', cancel);
      if (fitRequest.current === controller) {
        fitRequest.current = null;
        if (alive.current) setFitting(false);
      }
    }
  };
  const adjust = (delta: number) =>
    apply('original-size', Math.min(MAX_ZOOM_LEVEL, Math.max(MIN_ZOOM_LEVEL, scale + delta)));
  return (
    <div className='glossa-pdf-scale' role='group' aria-label={_('Zoom')} aria-busy={fitting}>
      <button
        type='button'
        aria-label={_('Fit Page')}
        title={_('Fit Page')}
        aria-pressed={settings.zoomMode === 'fit-page' && settings.zoomLevel === 100}
        onClick={() => apply('fit-page', 100)}
      >
        <Expand size={16} />
      </button>
      <button
        type='button'
        aria-label={_('Fit Width')}
        title={_('Fit Width')}
        aria-pressed={settings.zoomMode === 'fit-width' && settings.zoomLevel === 100}
        onClick={() => apply('fit-width', 100)}
      >
        <MoveHorizontal size={16} />
      </button>
      <button
        type='button'
        className='glossa-pdf-scale-step'
        aria-label={_('Zoom Out')}
        title={_('Zoom Out')}
        disabled={scale <= MIN_ZOOM_LEVEL}
        onClick={() => adjust(-ZOOM_STEP)}
      >
        <Minus size={14} />
      </button>
      <DropdownMenu
        onOpenChange={(open) => {
          if (!open) {
            if (editing.current) {
              editing.current = false;
              commitDraft();
            }
            commitSlide();
          }
        }}
      >
        <DropdownMenuTrigger asChild>
          <button
            type='button'
            className='glossa-pdf-scale-value'
            aria-label={`${_('Zoom')} ${scale}%`}
            title={_('Zoom')}
          >
            {scale}%<ChevronDown size={12} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end' side='top'>
          <DropdownMenuItem onSelect={() => apply('fit-page', 100)}>
            <Expand />
            {_('Fit Page')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => apply('fit-width', 100)}>
            <MoveHorizontal />
            {_('Fit Width')}
          </DropdownMenuItem>
          {bookDoc?.getPDFImage && view.renderer.scrollToPageRect && (
            <DropdownMenuItem disabled={fitting} onSelect={() => void fitContent()}>
              <Margins />
              {_('Fit Content')}
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <div className='glossa-pdf-scale-entry'>
            <DropdownMenuItem asChild role='textbox' onSelect={(event) => event.preventDefault()}>
              <input
                type='text'
                inputMode='decimal'
                tabIndex={0}
                aria-label={_('Zoom')}
                className='glossa-pdf-scale-input eink-bordered'
                value={draft}
                onFocus={(event) => {
                  editing.current = true;
                  cancelDraft.current = false;
                  event.currentTarget.select();
                }}
                onChange={(event) => {
                  draftChanged.current = true;
                  setDraft(event.target.value);
                }}
                onBlur={() => {
                  editing.current = false;
                  commitDraft();
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    cancelDraft.current = true;
                    setDraft(String(scaleRef.current));
                    return;
                  }
                  event.stopPropagation();
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    commitDraft();
                  }
                }}
              />
            </DropdownMenuItem>
            <span aria-hidden='true'>%</span>
          </div>
          <DropdownMenuItem
            asChild
            role='slider'
            aria-valuenow={clamp(scale)}
            aria-valuemin={MIN_ZOOM_LEVEL}
            aria-valuemax={MAX_ZOOM_LEVEL}
            onSelect={(event) => event.preventDefault()}
          >
            <input
              type='range'
              tabIndex={0}
              aria-label={_('Zoom')}
              aria-valuetext={`${scale}%`}
              min={MIN_ZOOM_LEVEL}
              max={MAX_ZOOM_LEVEL}
              step='any'
              value={clamp(scale)}
              className='glossa-pdf-scale-slider'
              onChange={(event) => preview(Number(event.target.value))}
              onPointerUp={commitSlide}
              onPointerCancel={commitSlide}
              onBlur={commitSlide}
              onKeyDown={(event) => {
                if (event.key !== 'Escape') event.stopPropagation();
              }}
              onKeyUp={commitSlide}
            />
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {[50, 75, 100, 125, 150, 200, 300].map((level) => (
            <DropdownMenuItem key={level} onSelect={() => apply('original-size', level)}>
              {level}%
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <button
        type='button'
        className='glossa-pdf-scale-step'
        aria-label={_('Zoom In')}
        title={_('Zoom In')}
        disabled={scale >= MAX_ZOOM_LEVEL}
        onClick={() => adjust(ZOOM_STEP)}
      >
        <Plus size={14} />
      </button>
      {failed && (
        <div className='glossa-pdf-save-error' role='alert'>
          <span>{_('Could not save reading settings.')}</span>
          <button type='button' disabled={saving} onClick={() => void persist()}>
            {_('Retry')}
          </button>
        </div>
      )}
      {fitMessage && (
        <div className='glossa-pdf-save-error' role={fitMessage === 'failed' ? 'alert' : 'status'}>
          <span>
            {_(fitMessage === 'empty' ? 'No content to fit.' : 'Could not fit page content.')}
          </span>
          {fitMessage === 'failed' && (
            <button type='button' onClick={() => void fitContent()}>
              {_('Retry')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
