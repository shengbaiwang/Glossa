import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import {
  Moon,
  Sun,
  SunMoon,
  ZoomOut,
  ZoomIn,
  Radio,
  Minus,
  Contrast,
  CloudOff,
  RefreshCw,
  Expand,
  MoveHorizontal,
  RectangleVertical,
  Columns2,
  GalleryVertical,
  GalleryHorizontal,
} from 'lucide-react';
import clsx from 'clsx';
import React, { useEffect } from 'react';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

import {
  MAX_ZOOM_LEVEL,
  MIN_ZOOM_LEVEL,
  ZOOM_STEP,
  MAX_CONTRAST,
  MIN_CONTRAST,
  CONTRAST_STEP,
} from '@/services/constants';
import { useEnv } from '@/context/EnvContext';
import { useAuth } from '@/context/AuthContext';
import { useThemeStore } from '@/store/themeStore';
import { useReaderStore } from '@/store/readerStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useTranslation } from '@/hooks/useTranslation';
import { getStyles } from '@/utils/style';
import { navigateToLogin } from '@/utils/nav';
import { getScrollGapAttr } from '@/utils/webtoon';
import { applyPageTurnAttributes } from '@/app/reader/hooks/useCapturedTurn';
import { eventDispatcher } from '@/utils/event';
import { getMaxInlineSize } from '@/utils/config';
import { nextThemeMode } from '@/utils/ambientLight';
import dayjs from 'dayjs';
import { saveViewSettings } from '@/helpers/settings';
import { tauriHandleToggleFullScreen } from '@/utils/window';
import { Check, Info, Plus, Highlight, X } from '@/components/GlossaIcons';
import { getReadingQuickAction } from '@/utils/annotationToolbar';
import QuickActionMenu from './annotator/QuickActionMenu';
import MenuItem from '@/components/MenuItem';
import Menu from '@/components/Menu';

interface ViewMenuProps {
  bookKey: string;
  setIsDropdownOpen?: (open: boolean) => void;
  onShowMetaHashDialog?: () => void;
  onCloseBook?: () => void;
}

const ViewMenu: React.FC<ViewMenuProps> = ({
  bookKey,
  setIsDropdownOpen,
  onShowMetaHashDialog,
  onCloseBook,
}) => {
  const _ = useTranslation();
  const iconSize = useResponsiveSize(16);
  const router = useRouter();
  const { user } = useAuth();
  const { envConfig, appService } = useEnv();
  const { getConfig, getBookData } = useBookDataStore();
  const { setSettingsDialogOpen, setSettingsDialogBookKey } = useSettingsStore();
  const { getView, getViewSettings, getViewState, setViewSettings } = useReaderStore();
  const config = getConfig(bookKey)!;
  const bookData = getBookData(bookKey)!;
  const viewSettings = getViewSettings(bookKey)!;
  const viewState = getViewState(bookKey);

  const { themeMode, isDarkMode, setThemeMode } = useThemeStore();
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
  const [invertImgColorInDark, setInvertImgColorInDark] = useState(
    viewSettings!.invertImgColorInDark,
  );
  const [applyThemeToPDF, setApplyThemeToPDF] = useState(viewSettings!.applyThemeToPDF!);

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

  const openFontLayoutMenu = () => {
    setIsDropdownOpen?.(false);
    setSettingsDialogBookKey(bookKey);
    setSettingsDialogOpen(true);
  };

  const cycleThemeMode = () => {
    setThemeMode(nextThemeMode(themeMode, !!appService?.hasAmbientLightSensor));
  };

  const handleFullScreen = () => {
    tauriHandleToggleFullScreen();
    setIsDropdownOpen?.(false);
  };

  const handleSync = () => {
    if (!user) {
      navigateToLogin(router);
      setIsDropdownOpen?.(false);
    } else {
      eventDispatcher.dispatch('sync-book-progress', { bookKey });
    }
  };

  const toggleAutoScroll = () => {
    setIsDropdownOpen?.(false);
    eventDispatcher.dispatch('autoscroll-toggle', { bookKey });
  };

  useEffect(() => {
    if (scrolledDirection === (viewSettings.scrolledDirection ?? 'vertical')) return;
    viewSettings.scrolledDirection = scrolledDirection;
    getView(bookKey)?.renderer.setAttribute('scroll-direction', scrolledDirection);
    setViewSettings(bookKey, viewSettings);
    saveViewSettings(envConfig, bookKey, 'scrolledDirection', scrolledDirection, true, false);
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
      if (scrolledDirection !== 'vertical') setScrolledDirection('vertical');
      saveViewSettings(envConfig, bookKey, 'scrolled', true, false, false);
    }
    setViewSettings(bookKey, viewSettings);
    saveViewSettings(envConfig, bookKey, 'webtoonMode', webtoonMode, false, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [webtoonMode]);

  useEffect(() => {
    if (zoomLevel === viewSettings.zoomLevel) return;
    saveViewSettings(envConfig, bookKey, 'zoomLevel', zoomLevel, true, true);
    if (bookData.bookDoc?.rendition?.layout === 'pre-paginated') {
      getView(bookKey)?.renderer.setAttribute('scale-factor', zoomLevel);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoomLevel]);

  useEffect(() => {
    if (contrast === viewSettings.contrast) return;
    saveViewSettings(envConfig, bookKey, 'contrast', contrast, true, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contrast]);

  useEffect(() => {
    if (invertImgColorInDark === viewSettings.invertImgColorInDark) return;
    saveViewSettings(envConfig, bookKey, 'invertImgColorInDark', invertImgColorInDark, true, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invertImgColorInDark]);

  useEffect(() => {
    if (applyThemeToPDF === viewSettings.applyThemeToPDF) return;
    saveViewSettings(envConfig, bookKey, 'applyThemeToPDF', applyThemeToPDF, true, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyThemeToPDF]);

  useEffect(() => {
    if (zoomMode === viewSettings.zoomMode) return;
    viewSettings.zoomMode = zoomMode;
    getView(bookKey)?.renderer.setAttribute('zoom', zoomMode);
    setViewSettings(bookKey, viewSettings);
    saveViewSettings(envConfig, bookKey, 'zoomMode', zoomMode, true, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoomMode]);

  useEffect(() => {
    if (spreadMode === viewSettings.spreadMode) return;
    viewSettings.spreadMode = spreadMode;
    getView(bookKey)?.renderer.setAttribute('spread', spreadMode);
    setViewSettings(bookKey, viewSettings);
    saveViewSettings(envConfig, bookKey, 'spreadMode', spreadMode, true, false);
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
    saveViewSettings(envConfig, bookKey, 'keepCoverSpread', keepCoverSpread, true, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keepCoverSpread]);

  const lastSyncTime = Math.max(
    config?.lastSyncedAtConfig || 0,
    config?.lastSyncedAtNotes || 0,
    config?.lastPushedAtConfig || 0,
    config?.lastPushedAtNotes || 0,
  );

  return (
    <Menu
      className={clsx(
        'view-menu dropdown-content dropdown-right no-triangle z-20 mt-1.5 border',
        'bgcolor-base-200 shadow-2xl',
      )}
      onCancel={() => setIsDropdownOpen?.(false)}
    >
      {bookData.bookDoc?.rendition?.layout === 'pre-paginated' && (
        <>
          <div
            title={_('Zoom Level')}
            className={clsx('flex items-center justify-between rounded-md')}
          >
            <button
              title={_('Zoom Out')}
              onClick={zoomOut}
              className={clsx(
                'hover:bg-base-300 text-base-content rounded-full p-2',
                zoomLevel <= MIN_ZOOM_LEVEL && 'btn-disabled text-gray-400',
              )}
            >
              <ZoomOut />
            </button>
            <button
              title={_('Reset Zoom')}
              className={clsx(
                'hover:bg-base-300 text-base-content h-8 min-h-8 w-[50%] rounded-md p-1 text-center',
              )}
              onClick={resetZoom}
            >
              {Math.round(zoomLevel)}%
            </button>
            <button
              title={_('Zoom In')}
              onClick={zoomIn}
              className={clsx(
                'hover:bg-base-300 text-base-content rounded-full p-2',
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
              title={_('Decrease Contrast')}
              onClick={decreaseContrast}
              className={clsx(
                'hover:bg-base-300 text-base-content rounded-full p-2',
                contrast <= MIN_CONTRAST && 'btn-disabled text-gray-400',
              )}
            >
              <Minus />
            </button>
            <button
              title={_('Reset Contrast')}
              className={clsx(
                'hover:bg-base-300 text-base-content flex h-8 min-h-8 w-[50%] items-center justify-center gap-1 rounded-md p-1 text-center',
              )}
              onClick={resetContrast}
            >
              <Contrast size={16} />
              {Math.round(contrast)}%
            </button>
            <button
              title={_('Increase Contrast')}
              onClick={increaseContrast}
              className={clsx(
                'hover:bg-base-300 text-base-content rounded-full p-2',
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
                title={_('Single Page')}
                onClick={() => {
                  setSpreadMode('none');
                  if (isScrolledMode) setScrolledMode(false);
                }}
                className={clsx(
                  'hover:bg-base-300 text-base-content rounded-full p-2',
                  !isScrolledMode && spreadMode === 'none' && 'bg-base-300/75',
                )}
              >
                <RectangleVertical />
              </button>
              <button
                title={_('Auto Spread')}
                onClick={() => {
                  setSpreadMode('auto');
                  if (isScrolledMode) setScrolledMode(false);
                }}
                className={clsx(
                  'hover:bg-base-300 text-base-content rounded-full p-2',
                  !isScrolledMode && spreadMode === 'auto' && 'bg-base-300/75',
                )}
              >
                <Columns2 />
              </button>
              <button
                title={_('Vertical Scrolling')}
                onClick={() => {
                  setScrolledDirection('vertical');
                  if (!isScrolledMode) setScrolledMode(true);
                }}
                className={clsx(
                  'hover:bg-base-300 text-base-content rounded-full p-2',
                  isScrolledMode && scrolledDirection === 'vertical' && 'bg-base-300/75',
                )}
              >
                <GalleryVertical />
              </button>
              <button
                title={_('Horizontal Scrolling')}
                onClick={() => {
                  if (webtoonMode) setWebtoonMode(false);
                  setScrolledDirection('horizontal');
                  if (!isScrolledMode) setScrolledMode(true);
                }}
                className={clsx(
                  'hover:bg-base-300 text-base-content rounded-full p-2',
                  isScrolledMode && scrolledDirection === 'horizontal' && 'bg-base-300/75',
                )}
              >
                <GalleryHorizontal />
              </button>
              <div className='bg-base-300 mx-2 h-6 w-[1px]' />
              <button
                title={_('Fit Page')}
                onClick={setZoomMode.bind(null, 'fit-page')}
                className={clsx(
                  'hover:bg-base-300 text-base-content rounded-full p-2',
                  zoomMode === 'fit-page' && 'bg-base-300/75',
                )}
              >
                <Expand />
              </button>
              <button
                title={_('Fit Width')}
                onClick={setZoomMode.bind(null, 'fit-width')}
                className={clsx(
                  'hover:bg-base-300 text-base-content rounded-full p-2',
                  zoomMode === 'fit-width' && 'bg-base-300/75',
                )}
              >
                <MoveHorizontal />
              </button>
            </div>

            <MenuItem
              label={_('Separate Cover Page')}
              Icon={keepCoverSpread ? <Check size={iconSize} aria-hidden='true' /> : undefined}
              onClick={() => setKeepCoverSpread(!keepCoverSpread)}
              disabled={spreadMode === 'none'}
            />
            <MenuItem label={_('Webtoon Mode')} toggled={webtoonMode} onClick={toggleWebtoonMode} />
          </>
          <hr aria-hidden='true' className='border-base-300 my-1' />
        </>
      )}

      <MenuItem label={_('Font & Layout')} shortcut='Shift+F' onClick={openFontLayoutMenu} />

      {viewSettings.enableAnnotationQuickActions && (
        <MenuItem
          label={_('Selection Actions')}
          Icon={<Highlight size={iconSize} aria-hidden='true' />}
        >
          <QuickActionMenu
            menuClassName='glossa-reader-inline-menu !relative !m-0 !w-full !border-0 !shadow-none'
            selectedAction={getReadingQuickAction(viewSettings.annotationQuickAction)}
            onActionSelect={(action) => {
              const nextAction =
                getReadingQuickAction(viewSettings.annotationQuickAction) === action
                  ? null
                  : action;
              saveViewSettings(
                envConfig,
                bookKey,
                'annotationQuickAction',
                nextAction,
                false,
                true,
              );
            }}
            setIsDropdownOpen={setIsDropdownOpen}
          />
        </MenuItem>
      )}

      {!bookData.isFixedLayout && (
        <MenuItem
          label={_('Scrolled Mode')}
          shortcut='Shift+J'
          Icon={isScrolledMode ? <Check size={iconSize} aria-hidden='true' /> : undefined}
          onClick={toggleScrolledMode}
        />
      )}

      <MenuItem
        label={_('Auto Scroll')}
        shortcut='Shift+A'
        Icon={
          viewState?.autoScrollEnabled ? <Check size={iconSize} aria-hidden='true' /> : undefined
        }
        onClick={toggleAutoScroll}
        disabled={!isScrolledMode}
      />

      <hr aria-hidden='true' className='border-base-300 my-1' />

      <MenuItem
        label={
          !user
            ? _('Sign in to Sync')
            : lastSyncTime
              ? _('Synced {{time}}', {
                  time: dayjs(lastSyncTime).fromNow(),
                })
              : _('Never synced')
        }
        Icon={
          user ? (
            <RefreshCw
              size={iconSize}
              className={viewState?.syncing ? 'animate-reverse-spin' : ''}
              aria-hidden='true'
            />
          ) : (
            <CloudOff size={iconSize} aria-hidden='true' />
          )
        }
        onClick={handleSync}
        siblings={
          <button
            aria-label={_('Sync Info')}
            title={_('Sync Info')}
            className='hover:bg-base-300 text-base-content/70 mx-1 rounded-md px-2'
            onClick={() => {
              setIsDropdownOpen?.(false);
              onShowMetaHashDialog?.();
            }}
          >
            <Info size={16} />
          </button>
        }
      />

      <hr aria-hidden='true' className='border-base-300 my-1' />

      {appService?.hasWindow && <MenuItem label={_('Fullscreen')} onClick={handleFullScreen} />}
      <MenuItem
        label={
          themeMode === 'dark'
            ? _('Dark Mode')
            : themeMode === 'light'
              ? _('Light Mode')
              : themeMode === 'ambient'
                ? _('Ambient Mode')
                : _('Auto Mode')
        }
        Icon={
          themeMode === 'dark' ? (
            <Moon size={iconSize} aria-hidden='true' />
          ) : themeMode === 'light' ? (
            <Sun size={iconSize} aria-hidden='true' />
          ) : themeMode === 'ambient' ? (
            <Radio size={iconSize} aria-hidden='true' />
          ) : (
            <SunMoon size={iconSize} aria-hidden='true' />
          )
        }
        onClick={cycleThemeMode}
      />
      {bookData.book?.format === 'PDF' && appService?.supportsCanvasContext2DFilter && (
        <MenuItem
          label={_('Apply Theme Colors to PDF')}
          Icon={applyThemeToPDF ? <Check size={iconSize} aria-hidden='true' /> : undefined}
          onClick={() => setApplyThemeToPDF(!applyThemeToPDF)}
        />
      )}
      <MenuItem
        label={_('Invert Image In Dark Mode')}
        disabled={!isDarkMode}
        Icon={invertImgColorInDark ? <Check size={iconSize} aria-hidden='true' /> : undefined}
        onClick={() => setInvertImgColorInDark(!invertImgColorInDark)}
      />

      {onCloseBook && (
        <>
          <hr aria-hidden='true' className='border-base-300 my-1' />
          <MenuItem
            label={_('Close Book')}
            Icon={<X size={iconSize} aria-hidden='true' />}
            onClick={() => {
              setIsDropdownOpen?.(false);
              onCloseBook();
            }}
          />
        </>
      )}
    </Menu>
  );
};

export default ViewMenu;
