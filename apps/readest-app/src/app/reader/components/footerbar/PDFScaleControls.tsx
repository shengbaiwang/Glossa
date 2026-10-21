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
} from '@/components/primitives/dropdown-menu';
import { useReaderStore } from '@/store/readerStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { saveViewSettings } from '@/helpers/settings';
import { MAX_ZOOM_LEVEL, MIN_ZOOM_LEVEL, ZOOM_STEP } from '@/services/constants';
import type { ViewSettings } from '@/types/book';
import { preparePDFContentFit } from '@/services/pdfWorkspace';

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
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const [fitting, setFitting] = useState(false);
  const [fitMessage, setFitMessage] = useState<'empty' | 'failed' | null>(null);
  const fitRequest = useRef<AbortController | null>(null);
  const pending = useRef<{ mode: ViewSettings['zoomMode']; level: number } | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    fitRequest.current?.abort();
    fitRequest.current = null;
    setFitting(false);
    setFitMessage(null);
    return () => {
      fitRequest.current?.abort();
    };
  }, [bookKey, view]);
  useEffect(() => {
    if (!isPDF || !view?.renderer) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const value = view.renderer.scale;
        if (value && Number.isFinite(value)) setScale(Math.round(value * 100));
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
    const change = pending.current;
    if (!change) return;
    setSaving(true);
    setFailed(false);
    try {
      await saveViewSettings(envConfig, bookKey, 'zoomMode', change.mode, true, false, true);
      await saveViewSettings(envConfig, bookKey, 'zoomLevel', change.level, true, false, true);
    } catch {
      if (alive.current) setFailed(true);
    } finally {
      if (alive.current) setSaving(false);
    }
  };
  const apply = (mode: ViewSettings['zoomMode'], level: number) => {
    fitRequest.current?.abort();
    fitRequest.current = null;
    setFitting(false);
    setFitMessage(null);
    view.renderer.setAttribute('zoom', mode);
    view.renderer.setAttribute('scale-factor', level);
    setViewSettings(bookKey, {
      ...(getViewSettings(bookKey) ?? settings),
      zoomMode: mode,
      zoomLevel: level,
    });
    pending.current = { mode, level };
    void persist();
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
        disabled={saving}
        onClick={() => apply('fit-page', 100)}
      >
        <Expand size={16} />
      </button>
      <button
        type='button'
        aria-label={_('Fit Width')}
        title={_('Fit Width')}
        aria-pressed={settings.zoomMode === 'fit-width' && settings.zoomLevel === 100}
        disabled={saving}
        onClick={() => apply('fit-width', 100)}
      >
        <MoveHorizontal size={16} />
      </button>
      <button
        type='button'
        className='glossa-pdf-scale-step'
        aria-label={_('Zoom Out')}
        title={_('Zoom Out')}
        disabled={saving || scale <= MIN_ZOOM_LEVEL}
        onClick={() => adjust(-ZOOM_STEP)}
      >
        <Minus size={14} />
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type='button'
            className='glossa-pdf-scale-value'
            aria-label={`${_('Zoom')} ${scale}%`}
            title={_('Zoom')}
            disabled={saving}
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
        disabled={saving || scale >= MAX_ZOOM_LEVEL}
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
