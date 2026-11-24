import { getReadingQuickAction } from '@/utils/annotationToolbar';
import clsx from 'clsx';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { LibraryBig, Ellipsis, Clock, Bookmark } from '@/components/GlossaIcons';

import { Insets } from '@/types/misc';
import { useEnv } from '@/context/EnvContext';
import { useThemeStore } from '@/store/themeStore';
import { useReaderStore } from '@/store/readerStore';
import { useNotebookStore } from '@/store/notebookStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useTrafficLightStore } from '@/store/trafficLightStore';
import { useTrafficLight } from '@/hooks/useTrafficLight';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { useSpatialNavigation } from '@/app/reader/hooks/useSpatialNavigation';
import { annotationToolQuickActions } from './annotator/AnnotationTools';
import { AnnotationToolType } from '@/types/annotator';
import { saveViewSettings } from '@/helpers/settings';
import { getHeaderTriggerHeight } from '@/utils/insets';
import Dropdown from '@/components/Dropdown';
import MenuItem from '@/components/MenuItem';
import { Overlay } from '@/components/Overlay';
import { useLongPress } from '@/hooks/useLongPress';
import ReaderToolbarSettings, {
  useReaderToolbarLayout,
  type ReaderTool,
} from '@/components/settings/ReaderToolbarSettings';
import ReaderCommandItem from './ReaderCommandItem';
import WindowButtons from '@/components/WindowButtons';
import QuickActionMenu from './annotator/QuickActionMenu';
import SidebarToggler from './SidebarToggler';
import BookmarkToggler from './BookmarkToggler';
import NotebookToggler from './NotebookToggler';
import SettingsToggler from './SettingsToggler';

import ViewMenu from './ViewMenu';
import { useBookDataStore } from '@/store/bookDataStore';
import { useSettingsStore } from '@/store/settingsStore';
import { isPluginEnabled } from '@/glossa/plugins/registry';
import { supportsReadingTime } from '@/glossa/plugins/readingActivity';

const ReadingTimePanel = React.lazy(() => import('@/glossa/plugins/ReadingTimePanel'));

interface HeaderBarProps {
  bookKey: string;
  bookTitle: string;
  isTopLeft: boolean;
  isHoveredAnim: boolean;
  gridInsets: Insets;
  screenInsets: Insets;
  onCloseBook: (bookKey: string) => void;
  onGoToLibrary: () => void;
  onDropdownOpenChange?: (isOpen: boolean) => void;
}

const HeaderBar: React.FC<HeaderBarProps> = ({
  bookKey,
  bookTitle,
  isTopLeft,
  isHoveredAnim,
  gridInsets,
  screenInsets,
  onCloseBook,
  onGoToLibrary,
  onDropdownOpenChange,
}) => {
  const _ = useTranslation();
  const { envConfig, appService } = useEnv();
  const headerRef = useRef<HTMLDivElement>(null);
  const { isTrafficLightVisible } = useTrafficLight(headerRef);
  const { trafficLightInFullscreen, setTrafficLightVisibility } = useTrafficLightStore();
  const { bookKeys, hoveredBookKey } = useReaderStore();
  const { systemUIVisible, statusBarHeight } = useThemeStore();
  const { isSideBarVisible, getIsSideBarVisible, sideBarBookKey } = useSidebarStore();
  const { isNotebookVisible } = useNotebookStore();
  const { getView, getViewSettings, setHoveredBookKey } = useReaderStore();
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [customizing, setCustomizing] = useState(false);
  const customizeRef = useRef<HTMLDivElement>(null);
  const customizeTrigger = useRef<HTMLElement | null>(null);
  const { layout } = useReaderToolbarLayout();
  const [headerWidth, setHeaderWidth] = useState(0);
  const view = getView(bookKey);
  const viewSettings = getViewSettings(bookKey)!;
  const iconSize18 = useResponsiveSize(18);
  const { getBookData } = useBookDataStore();
  const { settings } = useSettingsStore();
  const format = getBookData(bookKey)?.book?.format;
  const showReadingTime =
    !!format && supportsReadingTime(appService, format) && isPluginEnabled(settings, 'readingTime');

  const docs = view?.renderer.getContents() ?? [];
  const pointerInDoc = docs.some(({ doc }) => doc?.body?.style.cursor === 'pointer');

  const enableAnnotationQuickActions = viewSettings?.enableAnnotationQuickActions;
  const annotationQuickActionButton =
    annotationToolQuickActions.find(
      (button) => button.type === viewSettings?.annotationQuickAction,
    ) || annotationToolQuickActions[0]!;
  const annotationQuickAction = getReadingQuickAction(viewSettings?.annotationQuickAction);
  const AnnotationToolQuickActionIcon = annotationQuickActionButton.Icon;

  const handleToggleDropdown = (isOpen: boolean) => {
    setIsDropdownOpen(isOpen);
    onDropdownOpenChange?.(isOpen);
    if (!isOpen && !headerRef.current?.contains(document.activeElement)) setHoveredBookKey('');
  };

  const openCustomization = () => {
    customizeTrigger.current =
      headerRef.current?.querySelector<HTMLElement>('[data-book-actions] button') ?? null;
    setCustomizing(true);
  };
  const closeCustomization = () => {
    setCustomizing(false);
    customizeTrigger.current?.focus({ preventScroll: true });
  };
  const { handlers: customizePress } = useLongPress({ onLongPress: openCustomization }, []);
  useEffect(() => {
    if (customizing) customizeRef.current?.focus();
  }, [customizing]);

  const handleAnnotationQuickActionSelect = (action: AnnotationToolType | null) => {
    if (viewSettings?.annotationQuickAction === action) action = null;
    saveViewSettings(envConfig, bookKey, 'annotationQuickAction', action, false, true);
  };

  useEffect(() => {
    if (!appService?.hasTrafficLight) return;

    if (hoveredBookKey === bookKey && isTopLeft) {
      setTrafficLightVisibility(true);
    } else if (!hoveredBookKey) {
      setTimeout(() => {
        if (!getIsSideBarVisible()) {
          setTrafficLightVisibility(false);
        }
      }, 100);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appService, hoveredBookKey]);

  useEffect(() => {
    const header = headerRef.current;
    if (!header) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setHeaderWidth(entry.contentRect.width);
    });
    observer.observe(header);
    return () => observer.disconnect();
  }, []);

  // Check if mouse is outside header area to avoid false positive event of MouseLeave when clicking inside header on Windows
  const isMouseOutsideHeader = useCallback((clientX: number, clientY: number) => {
    if (!headerRef.current) return true;

    const rect = headerRef.current.getBoundingClientRect();
    return (
      clientX <= rect.left || clientX >= rect.right || clientY <= rect.top || clientY >= rect.bottom
    );
  }, []);

  const isHeaderCompact = headerWidth > 0 && headerWidth < 350;
  const insets = window.innerWidth < 640 ? screenInsets : gridInsets;
  const isHeaderVisible = hoveredBookKey === bookKey || isDropdownOpen || customizing;
  const isMobile = appService?.isMobile || window.innerWidth < 640;
  const triggerHeight = viewSettings ? getHeaderTriggerHeight(gridInsets.top, viewSettings) : 0;

  useSpatialNavigation(headerRef, isHeaderVisible);
  const trafficLightInHeader =
    appService?.hasTrafficLight && !trafficLightInFullscreen && !isSideBarVisible && isTopLeft;
  const handleCloseBook = () => {
    setHoveredBookKey(null);
    onCloseBook(bookKey);
  };
  const windowButtonVisible =
    appService?.hasWindowBar && !isTrafficLightVisible && !trafficLightInHeader;

  const toolbarTools: Record<ReaderTool, React.ReactNode> = {
    annotation:
      enableAnnotationQuickActions && annotationQuickAction ? (
        <Dropdown
          label={_('Instant {{action}}', { action: _(annotationQuickActionButton.label) })}
          className='exclude-title-bar-mousedown dropdown-bottom dropdown-center'
          menuClassName='!relative'
          buttonClassName={clsx(
            'glossa-icon-button btn btn-ghost h-8 min-h-8 w-8 p-0',
            viewSettings?.annotationQuickAction && 'bg-base-300/50',
          )}
          toggleButton={<AnnotationToolQuickActionIcon size={iconSize18} />}
          onToggle={handleToggleDropdown}
        >
          <QuickActionMenu
            selectedAction={viewSettings.annotationQuickAction}
            onActionSelect={handleAnnotationQuickActionSelect}
          />
        </Dropdown>
      ) : null,
    readingTime: showReadingTime ? (
      <Dropdown
        label={_('Reading time')}
        containerClassName='h-8'
        className='exclude-title-bar-mousedown dropdown-bottom dropdown-end'
        buttonClassName='glossa-icon-button btn btn-ghost h-8 min-h-8 w-8 p-0'
        toggleButton={<Clock size={iconSize18} aria-hidden='true' />}
        onToggle={handleToggleDropdown}
      >
        <div
          aria-label={_('Reading time')}
          className='glossa-group-card dropdown-content no-triangle z-20 mt-2 shadow-2xl'
          role='region'
        >
          <React.Suspense fallback={<p role='status'>{_('Loading...')}</p>}>
            <ReadingTimePanel bookKey={bookKey} />
          </React.Suspense>
        </div>
      </Dropdown>
    ) : null,
    bookmark: <BookmarkToggler bookKey={bookKey} hidden={layout.hidden.includes('bookmark')} />,
    appearance: !isHeaderCompact ? <SettingsToggler bookKey={bookKey} /> : null,
  };
  const fallbackTools = (close: () => void) => (
    <>
      {layout.hidden.includes('bookmark') && (
        <ReaderCommandItem
          id='bookmark'
          bookKey={bookKey}
          icon={<Bookmark size={16} />}
          onClose={close}
        />
      )}
      {layout.hidden.includes('readingTime') && showReadingTime && (
        <MenuItem label={_('Reading time')} Icon={<Clock size={16} />}>
          <React.Suspense fallback={<p role='status'>{_('Loading...')}</p>}>
            <ReadingTimePanel bookKey={bookKey} />
          </React.Suspense>
        </MenuItem>
      )}
      {layout.hidden.includes('annotation') && toolbarTools.annotation && (
        <MenuItem
          label={_('Annotation Actions')}
          Icon={<AnnotationToolQuickActionIcon size={16} />}
        >
          <QuickActionMenu
            menuClassName='!static !m-0 !w-full !border-0 !shadow-none'
            selectedAction={viewSettings.annotationQuickAction}
            onActionSelect={handleAnnotationQuickActionSelect}
            setIsDropdownOpen={close}
          />
        </MenuItem>
      )}
    </>
  );

  return (
    <div
      className={clsx(
        // pointer-events-none: the wrapper is as tall as its safe-area
        // padding, so on notch devices its box covers the top inset strip and
        // swallowed long presses on text rendered there (#5429) — children
        // that take input restore pointer-events themselves.
        'pointer-events-none left-0 top-0 w-full',
        isHeaderVisible && 'bg-base-100',
        window.innerWidth < 640 ? 'fixed z-20' : 'absolute',
      )}
      style={{
        paddingTop: appService?.hasSafeAreaInset ? `${insets.top}px` : '0px',
      }}
    >
      {/*
        Hover trigger area. Mobile has no hover and toggles the bars by tapping
        the page (usePagination), so this must not take pointer events there —
        it used to be a fixed 44px tall, the same as the default page-header
        margin, so with the page header off (compact 16px margin) it covered the
        first line of text and swallowed long presses on it (#5429). Mirrors the
        footer's trigger. Its height now tracks the content top on every
        platform, so the strip can never reach past where the text starts and
        block a selection (#4977).
      */}
      <div
        role='none'
        tabIndex={-1}
        className={clsx(
          'absolute top-0 z-10 w-full',
          isMobile || pointerInDoc ? 'pointer-events-none' : 'pointer-events-auto',
        )}
        style={{ height: `${triggerHeight}px` }}
        onClick={() => setHoveredBookKey(bookKey)}
        onMouseEnter={() => !appService?.isMobile && setHoveredBookKey(bookKey)}
        onTouchStart={() => !appService?.isMobile && setHoveredBookKey(bookKey)}
      />
      <div
        className={clsx(
          'bg-base-100 absolute left-0 right-0 top-0 z-10',
          appService?.hasRoundedWindow && 'rounded-window-top-right',
          isHeaderVisible ? 'visible' : 'hidden',
        )}
        style={{
          height: systemUIVisible ? `${Math.max(insets.top, statusBarHeight)}px` : '0px',
        }}
      />
      <div
        ref={headerRef}
        role='banner'
        aria-label={_('Header Bar')}
        className={clsx(
          `header-bar glossa-reader-header bg-base-100 absolute top-0 z-10 flex h-11 w-full items-center pr-4`,
          `transition-[opacity,margin-top] duration-300`,
          trafficLightInHeader ? 'pl-20' : isSideBarVisible ? 'ps-4' : 'ps-4 sm:ps-1.5',
          appService?.hasRoundedWindow && 'rounded-window-top-right',
          !isSideBarVisible && appService?.hasRoundedWindow && 'rounded-window-top-left',
          isHoveredAnim && 'hover-bar-anim',
          isHeaderVisible ? 'pointer-events-auto visible' : 'pointer-events-none opacity-0',
          isDropdownOpen && 'header-bar-pinned',
        )}
        style={{
          marginTop: systemUIVisible
            ? `${Math.max(insets.top, statusBarHeight)}px`
            : `${insets.top}px`,
        }}
        onFocus={() => !appService?.isMobile && setHoveredBookKey(bookKey)}
        onMouseLeave={(e) => {
          if (!appService?.isMobile && isMouseOutsideHeader(e.clientX, e.clientY)) {
            setHoveredBookKey('');
          }
        }}
      >
        <div className='header-tools-start bg-base-100 sidebar-bookmark-toggler z-20 flex h-full min-w-0 items-center gap-x-3 pe-2 max-[350px]:gap-x-2'>
          {/* h-full so this scroller spans the whole bar: `overflow-x-auto`
              also clips vertically, and shrink-wrapped to the 32px icons it
              cut the buttons' touch halos back down to 32px (#5401). */}
          {/* no-scrollbar: the overlay scrollbar of `overflow-x-auto` owns a
              hit-test strip at the scroller's bottom edge on Android, which
              cut the touch halos short of the 44px target (#5401) —
              `scrollbar-width: none` alone does not remove that strip. */}
          <div className='no-scrollbar flex h-full min-w-0 items-center gap-x-3 overflow-x-auto max-[350px]:gap-x-2'>
            {(!isSideBarVisible || sideBarBookKey !== bookKey) && (
              <div className='hidden sm:flex'>
                <SidebarToggler bookKey={bookKey} />
              </div>
            )}
            <button
              title={_('Go to Library')}
              aria-label={_('Go to Library')}
              type='button'
              className='glossa-reader-library-button glossa-icon-button touch-target btn btn-ghost hidden h-8 min-h-8 p-0 sm:flex'
              onClick={onGoToLibrary}
            >
              <LibraryBig size={iconSize18} aria-hidden='true' />
            </button>
          </div>
        </div>

        <div
          role='contentinfo'
          aria-label={_('Title') + ' - ' + bookTitle}
          className={clsx(
            'header-title z-15 bg-base-100 pointer-events-none hidden flex-1 items-center justify-center sm:flex',
            !windowButtonVisible && 'absolute inset-0',
            isHeaderCompact && '!hidden',
          )}
        >
          <div
            aria-hidden='true'
            className={clsx(
              'glossa-reader-book-title line-clamp-1 text-center text-xs font-medium',
              !windowButtonVisible && 'max-w-[50%]',
            )}
          >
            {bookTitle}
          </div>
        </div>

        <div
          className='header-tools-end bg-base-100 z-20 ms-auto flex h-full min-w-max items-center gap-x-3 ps-2 max-[350px]:gap-x-2'
          onPointerDown={(event) => {
            if (!customizing && event.pointerType !== 'mouse') customizePress.onPointerDown(event);
          }}
          onPointerMove={customizePress.onPointerMove}
          onPointerUp={customizePress.onPointerUp}
          onPointerCancel={customizePress.onPointerCancel}
          onPointerLeave={customizePress.onPointerLeave}
          onClickCapture={
            customizing
              ? (event) => {
                  if (
                    !customizeRef.current?.contains(event.target as Node) &&
                    !(event.target as HTMLElement).closest('.overlay')
                  ) {
                    event.preventDefault();
                    event.stopPropagation();
                  }
                }
              : undefined
          }
          onContextMenu={(event) => {
            if (customizing) return;
            event.preventDefault();
            event.stopPropagation();
            openCustomization();
          }}
          onKeyDown={(event) => {
            if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
              event.preventDefault();
              event.stopPropagation();
              openCustomization();
            }
          }}
        >
          {customizing && (
            <>
              <Overlay onDismiss={closeCustomization} />
              <div
                ref={customizeRef}
                tabIndex={-1}
                role='group'
                aria-label={_('Customize Toolbar')}
                className='glossa-menu-surface eink-bordered bg-base-100 absolute end-2 top-full z-50 w-80 max-w-[calc(100vw-16px)] rounded-lg shadow-md'
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.stopPropagation();
                    closeCustomization();
                  }
                }}
              >
                <ReaderToolbarSettings inline />
              </div>
            </>
          )}
          {layout.order
            .filter((tool) => tool === 'bookmark' || !layout.hidden.includes(tool))
            .map((tool) => (
              <React.Fragment key={tool}>{toolbarTools[tool]}</React.Fragment>
            ))}
          <div data-book-actions>
            <Dropdown
              label={_('Book Actions')}
              containerClassName='h-8'
              className='exclude-title-bar-mousedown dropdown-bottom dropdown-end'
              buttonClassName='glossa-icon-button btn btn-ghost h-8 min-h-8 w-8 p-0 mt-0'
              toggleButton={<Ellipsis size={iconSize18} aria-hidden='true' />}
              onToggle={handleToggleDropdown}
            >
              <ViewMenu
                bookKey={bookKey}
                showReadingAppearance={isHeaderCompact || layout.hidden.includes('appearance')}
                fallbackTools={fallbackTools}
                onCloseBook={handleCloseBook}
              />
            </Dropdown>
          </div>
          {(!isNotebookVisible || sideBarBookKey !== bookKey || isMobile) && (
            <NotebookToggler bookKey={bookKey} />
          )}
          <WindowButtons
            className='window-buttons flex items-center'
            headerRef={headerRef}
            showMinimize={bookKeys.length == 1 && windowButtonVisible}
            showMaximize={bookKeys.length == 1 && windowButtonVisible}
            showClose={bookKeys.length > 1 || windowButtonVisible}
            closeButtonLabel={_('Close Book')}
            onClose={handleCloseBook}
          />
        </div>
      </div>
    </div>
  );
};

export default HeaderBar;
