import React, { useEffect, useState } from 'react';
import clsx from 'clsx';
import {
  BookOpen,
  MoveVertical,
  ZoomOut,
  ZoomIn,
  Minus,
  Plus,
  Contrast,
  Expand,
  MoveHorizontal,
  RectangleVertical,
  Columns2,
  GalleryVertical,
  GalleryHorizontal,
} from '@/components/GlossaIcons';
import {
  MAX_ZOOM_LEVEL,
  MIN_ZOOM_LEVEL,
  ZOOM_STEP,
  MAX_CONTRAST,
  MIN_CONTRAST,
  CONTRAST_STEP,
} from '@/services/constants';
import { useEnv } from '@/context/EnvContext';
import { useReaderStore } from '@/store/readerStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { useTranslation } from '@/hooks/useTranslation';
import { getStyles } from '@/utils/style';
import { getScrollGapAttr } from '@/utils/webtoon';
import { applyPageTurnAttributes } from '@/app/reader/hooks/useCapturedTurn';
import { getMaxInlineSize } from '@/utils/config';
import { saveViewSettings } from '@/helpers/settings';
import MenuItem from '@/components/MenuItem';

const ReadingDisplayControls: React.FC<{
  bookKey: string;
  onRegisterReset: (resetFn: () => void) => void;
}> = ({ bookKey, onRegisterReset }) => {
  const _ = useTranslation();
  const iconSize = useResponsiveSize(16);
  const { envConfig, appService } = useEnv();
  const { getBookData } = useBookDataStore();
  const { getView, getViewSettings, setViewSettings } = useReaderStore();
  const bookData = getBookData(bookKey)!;
  const viewSettings = getViewSettings(bookKey)!;
  const [isScrolledMode, setScrolledMode] = useState(viewSettings!.scrolled);
  const [scrolledDirection, setScrolledDirection] = useState(
    viewSettings!.scrolledDirection ?? 'vertical',
  );
  const [webtoonMode, setWebtoonMode] = useState(viewSettings!.webtoonMode ?? false);

  const [zoomLevel, setZoomLevel] = useState(viewSettings!.zoomLevel!);
  const [contrast, setContrast] = useState(viewSettings!.contrast ?? 100);
  const [zoomMode, setZoomMode] = useState(viewSettings!.zoomMode!);
  const [spreadMode, setSpreadMode] = useState(viewSettings!.spreadMode!);
  const [keepCoverSpread, setKeepCoverSpread] = useState(viewSettings!.keepCoverSpread!);
  useEffect(() => {
    onRegisterReset(() => {
      if (!appService) return;
      const defaults = appService.getDefaultViewSettings();
      setScrolledMode(defaults.scrolled);
      setScrolledDirection(defaults.scrolledDirection ?? 'vertical');
      setWebtoonMode(defaults.webtoonMode ?? false);
      setZoomLevel(defaults.zoomLevel ?? 100);
      setContrast(defaults.contrast ?? 100);
      setZoomMode(defaults.zoomMode ?? 'fit-page');
      setSpreadMode(defaults.spreadMode ?? 'auto');
      setKeepCoverSpread(defaults.keepCoverSpread ?? false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const zoomIn = () => setZoomLevel((prev) => Math.min(prev + ZOOM_STEP, MAX_ZOOM_LEVEL));
  const zoomOut = () => setZoomLevel((prev) => Math.max(prev - ZOOM_STEP, MIN_ZOOM_LEVEL));
  const resetZoom = () => setZoomLevel(100);
  const increaseContrast = () =>
    setContrast((prev) => Math.min(prev + CONTRAST_STEP, MAX_CONTRAST));
  const decreaseContrast = () =>
    setContrast((prev) => Math.max(prev - CONTRAST_STEP, MIN_CONTRAST));
  const resetContrast = () => setContrast(100);
  const toggleScrolledMode = () => setScrolledMode(!isScrolledMode);
  const toggleWebtoonMode = () => setWebtoonMode(!webtoonMode);

  useEffect(() => {
    if (scrolledDirection === (viewSettings.scrolledDirection ?? 'vertical')) return;
    viewSettings.scrolledDirection = scrolledDirection;
    getView(bookKey)?.renderer.setAttribute('scroll-direction', scrolledDirection);
    setViewSettings(bookKey, viewSettings);
    saveViewSettings(
      envConfig,
      bookKey,
      'scrolledDirection',
      scrolledDirection,
      false,
      false,
      true,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrolledDirection]);

  useEffect(() => {
    if (isScrolledMode === viewSettings!.scrolled) return;
    viewSettings!.scrolled = isScrolledMode;
    if (!isScrolledMode && webtoonMode) setWebtoonMode(false);
    getView(bookKey)?.renderer.setAttribute('flow', isScrolledMode ? 'scrolled' : 'paginated');
    getView(bookKey)?.renderer.setAttribute(
      'max-inline-size',
      `${getMaxInlineSize(viewSettings)}px`,
    );
    getView(bookKey)?.renderer.setStyles?.(getStyles(viewSettings!));
    // `scrolled` decides which engine owns a swipe: leaving it stale keeps the
    // paginator's `turn-style` / cleared `no-swipe` from scroll flow, so the
    // paginator animates the swipe itself while the touch interceptor — which
    // recomputes eligibility live — runs a captured turn over the top, and
    // three pages slide at once.
    const view = getView(bookKey);
    if (view) applyPageTurnAttributes(view, viewSettings!, !!bookData?.isFixedLayout);
    setViewSettings(bookKey, viewSettings!);
    void saveViewSettings(envConfig, bookKey, 'scrolled', isScrolledMode, false, false, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isScrolledMode]);

  useEffect(() => {
    if (webtoonMode === viewSettings.webtoonMode) return;
    viewSettings.webtoonMode = webtoonMode;
    getView(bookKey)?.renderer.setAttribute('scroll-gap', getScrollGapAttr(webtoonMode));
    if (webtoonMode) {
      // Webtoon Mode implies scrolled flow + fit-width (scale-factor 100) so pages
      // fill the width without horizontal overflow/clipping. Reuse the existing
      // scrolled / zoomLevel effects rather than duplicating their renderer wiring.
      if (!isScrolledMode) setScrolledMode(true);
      if (zoomLevel !== 100) setZoomLevel(100);
      if (zoomMode !== 'fit-width') setZoomMode('fit-width');
      if (scrolledDirection !== 'vertical') setScrolledDirection('vertical');
      saveViewSettings(envConfig, bookKey, 'scrolled', true, false, false, true);
    }
    setViewSettings(bookKey, viewSettings);
    saveViewSettings(envConfig, bookKey, 'webtoonMode', webtoonMode, false, false, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [webtoonMode]);

  useEffect(() => {
    if (zoomLevel === viewSettings.zoomLevel) return;
    saveViewSettings(envConfig, bookKey, 'zoomLevel', zoomLevel, false, true, true);
    if (bookData.bookDoc?.rendition?.layout === 'pre-paginated') {
      getView(bookKey)?.renderer.setAttribute('scale-factor', zoomLevel);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoomLevel]);

  useEffect(() => {
    if (contrast === viewSettings.contrast) return;
    saveViewSettings(envConfig, bookKey, 'contrast', contrast, false, true, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contrast]);

  useEffect(() => {
    if (zoomMode === viewSettings.zoomMode) return;
    viewSettings.zoomMode = zoomMode;
    getView(bookKey)?.renderer.setAttribute('zoom', zoomMode);
    setViewSettings(bookKey, viewSettings);
    saveViewSettings(envConfig, bookKey, 'zoomMode', zoomMode, false, false, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoomMode]);

  useEffect(() => {
    if (spreadMode === viewSettings.spreadMode) return;
    viewSettings.spreadMode = spreadMode;
    getView(bookKey)?.renderer.setAttribute('spread', spreadMode);
    setViewSettings(bookKey, viewSettings);
    saveViewSettings(envConfig, bookKey, 'spreadMode', spreadMode, false, false, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spreadMode]);

  useEffect(() => {
    if (keepCoverSpread === viewSettings.keepCoverSpread) return;
    if (!bookData?.bookDoc?.sections?.length) return;
    viewSettings.keepCoverSpread = keepCoverSpread;
    const coverSide = bookData.bookDoc.dir === 'rtl' ? 'right' : 'left';
    bookData.bookDoc.sections[0]!.pageSpread = keepCoverSpread ? '' : coverSide;
    getView(bookKey)?.renderer.setAttribute('spread', spreadMode);
    setViewSettings(bookKey, viewSettings);
    saveViewSettings(envConfig, bookKey, 'keepCoverSpread', keepCoverSpread, false, false, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keepCoverSpread]);

  return (
    <div className='glossa-reading-display-controls my-4'>
      {bookData.bookDoc?.rendition?.layout === 'pre-paginated' && (
        <>
          <div
            title={_('Zoom Level')}
            className={clsx('flex items-center justify-between rounded-md')}
          >
            <button
              type='button'
              aria-label={_('Zoom Out')}
              title={_('Zoom Out')}
              disabled={zoomLevel <= MIN_ZOOM_LEVEL}
              onClick={zoomOut}
              className={clsx(
                'touch-target glossa-icon-button',
                zoomLevel <= MIN_ZOOM_LEVEL && 'btn-disabled text-gray-400',
              )}
            >
              <ZoomOut />
            </button>
            <button
              type='button'
              aria-label={_('Reset Zoom')}
              title={_('Reset Zoom')}
              className={clsx(
                'touch-target hover:bg-base-300 text-base-content h-8 min-h-8 w-[50%] rounded-md p-1 text-center',
              )}
              onClick={resetZoom}
            >
              {Math.round(zoomLevel)}%
            </button>
            <button
              type='button'
              aria-label={_('Zoom In')}
              title={_('Zoom In')}
              disabled={zoomLevel >= MAX_ZOOM_LEVEL}
              onClick={zoomIn}
              className={clsx(
                'touch-target glossa-icon-button',
                zoomLevel >= MAX_ZOOM_LEVEL && 'btn-disabled text-gray-400',
              )}
            >
              <ZoomIn />
            </button>
          </div>

          <div
            title={_('Contrast')}
            className={clsx('mt-2 flex items-center justify-between rounded-md')}
          >
            <button
              type='button'
              aria-label={_('Decrease Contrast')}
              title={_('Decrease Contrast')}
              disabled={contrast <= MIN_CONTRAST}
              onClick={decreaseContrast}
              className={clsx(
                'touch-target glossa-icon-button',
                contrast <= MIN_CONTRAST && 'btn-disabled text-gray-400',
              )}
            >
              <Minus />
            </button>
            <button
              type='button'
              aria-label={_('Reset Contrast')}
              title={_('Reset Contrast')}
              className={clsx(
                'touch-target hover:bg-base-300 text-base-content flex h-8 min-h-8 w-[50%] items-center justify-center gap-1 rounded-md p-1 text-center',
              )}
              onClick={resetContrast}
            >
              <Contrast size={16} />
              {Math.round(contrast)}%
            </button>
            <button
              type='button'
              aria-label={_('Increase Contrast')}
              title={_('Increase Contrast')}
              disabled={contrast >= MAX_CONTRAST}
              onClick={increaseContrast}
              className={clsx(
                'touch-target glossa-icon-button',
                contrast >= MAX_CONTRAST && 'btn-disabled text-gray-400',
              )}
            >
              <Plus />
            </button>
          </div>

          <>
            <div
              title={_('Zoom Mode')}
              className={clsx('my-2 flex items-center justify-between rounded-md')}
            >
              <button
                type='button'
                aria-pressed={!isScrolledMode && spreadMode === 'none'}
                aria-label={_('Single Page')}
                title={_('Single Page')}
                onClick={() => {
                  setSpreadMode('none');
                  if (isScrolledMode) setScrolledMode(false);
                }}
                className={clsx(
                  'touch-target glossa-icon-button',
                  !isScrolledMode && spreadMode === 'none' && 'bg-base-300/75',
                )}
              >
                <RectangleVertical />
              </button>
              <button
                type='button'
                aria-pressed={!isScrolledMode && spreadMode === 'auto'}
                aria-label={_('Auto Spread')}
                title={_('Auto Spread')}
                onClick={() => {
                  setSpreadMode('auto');
                  if (isScrolledMode) setScrolledMode(false);
                }}
                className={clsx(
                  'touch-target glossa-icon-button',
                  !isScrolledMode && spreadMode === 'auto' && 'bg-base-300/75',
                )}
              >
                <Columns2 />
              </button>
              <button
                type='button'
                aria-pressed={isScrolledMode && scrolledDirection === 'vertical'}
                aria-label={_('Vertical Scrolling')}
                title={_('Vertical Scrolling')}
                onClick={() => {
                  setScrolledDirection('vertical');
                  if (!isScrolledMode) setScrolledMode(true);
                }}
                className={clsx(
                  'touch-target glossa-icon-button',
                  isScrolledMode && scrolledDirection === 'vertical' && 'bg-base-300/75',
                )}
              >
                <GalleryVertical />
              </button>
              <button
                type='button'
                aria-pressed={isScrolledMode && scrolledDirection === 'horizontal'}
                aria-label={_('Horizontal Scrolling')}
                title={_('Horizontal Scrolling')}
                onClick={() => {
                  if (webtoonMode) setWebtoonMode(false);
                  setScrolledDirection('horizontal');
                  if (!isScrolledMode) setScrolledMode(true);
                }}
                className={clsx(
                  'touch-target glossa-icon-button',
                  isScrolledMode && scrolledDirection === 'horizontal' && 'bg-base-300/75',
                )}
              >
                <GalleryHorizontal />
              </button>
              <div className='bg-base-300 mx-2 h-6 w-[1px]' />
              <button
                type='button'
                aria-pressed={zoomMode === 'fit-page'}
                aria-label={_('Fit Page')}
                title={_('Fit Page')}
                onClick={setZoomMode.bind(null, 'fit-page')}
                className={clsx(
                  'touch-target glossa-icon-button',
                  zoomMode === 'fit-page' && 'bg-base-300/75',
                )}
              >
                <Expand />
              </button>
              <button
                type='button'
                aria-pressed={zoomMode === 'fit-width'}
                aria-label={_('Fit Width')}
                title={_('Fit Width')}
                onClick={setZoomMode.bind(null, 'fit-width')}
                className={clsx(
                  'touch-target glossa-icon-button',
                  zoomMode === 'fit-width' && 'bg-base-300/75',
                )}
              >
                <MoveHorizontal />
              </button>
            </div>

            <MenuItem
              label={_('Separate Cover Page')}
              Icon={<BookOpen size={iconSize} />}
              toggled={keepCoverSpread}
              onClick={() => setKeepCoverSpread(!keepCoverSpread)}
              disabled={spreadMode === 'none'}
            />
            <MenuItem
              label={_('Webtoon Mode')}
              Icon={<GalleryVertical size={iconSize} />}
              toggled={webtoonMode}
              onClick={toggleWebtoonMode}
            />
          </>
          <hr aria-hidden='true' className='border-base-300 my-1' />
        </>
      )}

      {!bookData.isFixedLayout && (
        <MenuItem
          label={_('Scrolled Mode')}
          shortcut='Shift+J'
          Icon={<MoveVertical size={iconSize} />}
          toggled={isScrolledMode}
          onClick={toggleScrolledMode}
        />
      )}
    </div>
  );
};
export default ReadingDisplayControls;
