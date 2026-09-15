import clsx from 'clsx';
import { useCallback, useEffect, useState } from 'react';

import { useSettingsStore } from '@/store/settingsStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { useTranslation } from '@/hooks/useTranslation';
import { eventDispatcher } from '@/utils/event';
import { getBookDirFromLanguage } from '@/utils/book';
import { getPanelTopInset } from '@/utils/insets';
import { useEnv } from '@/context/EnvContext';
import { useSwipeToDismiss } from '@/hooks/useSwipeToDismiss';
import { usePanelResize } from '@/hooks/usePanelResize';
import { useThemeStore } from '@/store/themeStore';
import { Overlay } from '@/components/Overlay';
import useShortcuts from '@/hooks/useShortcuts';
import SidebarHeader from './Header';
import SidebarContent from './Content';
import useSidebar from '../../hooks/useSidebar';
import SearchBar from './SearchBar';
import SearchResults from './SearchResults';

const MIN_SIDEBAR_WIDTH = 0.05;
const MAX_SIDEBAR_WIDTH = 0.45;

const SideBar = ({}) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const { settings } = useSettingsStore();
  const { updateAppTheme, safeAreaInsets, systemUIVisible, statusBarHeight } = useThemeStore();
  const { sideBarBookKey, setSideBarBookKey, getSearchNavState, setSearchTerm, clearSearch } =
    useSidebarStore();
  const { isSearchBarVisible, setSearchBarVisible } = useSidebarStore();
  const searchNavState = sideBarBookKey ? getSearchNavState(sideBarBookKey) : null;
  const { searchResults = null } = searchNavState || {};
  const { getBookData } = useBookDataStore();
  const { getView, getViewSettings } = useReaderStore();
  const isMobile = window.innerWidth < 640;
  const [isFullHeightInMobile, setIsFullHeightInMobile] = useState(isMobile);
  const {
    sideBarWidth,
    isSideBarPinned,
    isSideBarVisible,
    getSideBarWidth,
    setSideBarVisible,
    handleSideBarResize,
  } = useSidebar(
    settings.globalReadSettings.sideBarWidth,
    isMobile ? false : settings.globalReadSettings.isSideBarPinned,
  );
  // A desktop pin remains a saved preference when the window becomes narrow;
  // the mobile sheet still needs to cover the reader and dismiss like an overlay.
  const isOverlay = isMobile || !isSideBarPinned;

  const onSearchEvent = async (event: CustomEvent) => {
    const { term, bookKey } = event.detail;
    setSideBarVisible(true);
    setSideBarBookKey(bookKey);
    setSearchBarVisible(true);
    if (term !== undefined && term !== null) {
      setSearchTerm(bookKey, term);
    }
  };

  const onNavigateEvent = async () => {
    const { isSideBarPinned } = useSidebarStore.getState();
    if (window.innerWidth < 640 || !isSideBarPinned) {
      setSideBarVisible(false);
    }
  };

  const {
    panelRef: sidebarRef,
    overlayRef,
    panelHeight: sidebarHeight,
    handleVerticalDragStart,
  } = useSwipeToDismiss(
    () => {
      setSideBarVisible(false);
      setIsFullHeightInMobile(isMobile);
    },
    (data) => setIsFullHeightInMobile(data.clientY < 44),
  );

  useEffect(() => {
    setIsFullHeightInMobile(isMobile);
  }, [isMobile]);

  useEffect(() => {
    if (isSideBarVisible) {
      updateAppTheme('base-200');
      overlayRef.current = document.querySelector('.overlay') as HTMLDivElement | null;
    } else {
      updateAppTheme('base-100');
      overlayRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSideBarVisible, isOverlay]);

  useEffect(() => {
    eventDispatcher.on('search-term', onSearchEvent);
    eventDispatcher.on('navigate', onNavigateEvent);
    return () => {
      eventDispatcher.off('search-term', onSearchEvent);
      eventDispatcher.off('navigate', onNavigateEvent);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { handleResizeStart: handleHorizontalDragStart, handleResizeKeyDown: handleDragKeyDown } =
    usePanelResize({
      side: 'start',
      minWidth: MIN_SIDEBAR_WIDTH,
      maxWidth: MAX_SIDEBAR_WIDTH,
      getWidth: getSideBarWidth,
      onResize: handleSideBarResize,
    });

  const handleClickOverlay = () => {
    setSideBarVisible(false);
  };

  const handleShowSearchBar = useCallback(() => {
    setSideBarVisible(true);
    setSearchBarVisible(true);
  }, [setSideBarVisible, setSearchBarVisible]);

  const handleHideSearchBar = useCallback(() => {
    setSearchBarVisible(false);
    if (sideBarBookKey) clearSearch(sideBarBookKey);
    getView(sideBarBookKey)?.clearSearch();
  }, [sideBarBookKey, clearSearch, getView, setSearchBarVisible]);

  const handleHideSideBar = useCallback(() => {
    if (isSearchBarVisible) {
      handleHideSearchBar();
    } else if (isOverlay) {
      setSideBarVisible(false);
    }
  }, [isSearchBarVisible, handleHideSearchBar, isOverlay, setSideBarVisible]);

  useShortcuts({ onShowSearchBar: handleShowSearchBar, onEscape: handleHideSideBar }, [
    handleShowSearchBar,
    handleHideSideBar,
  ]);

  const handleSearchResultClick = (cfi: string) => {
    onNavigateEvent();
    const matches = (searchResults ?? []).flatMap((result) =>
      'subitems' in result ? result.subitems : [result],
    );
    const index = matches.findIndex((match) => match.cfi === cfi);
    if (index >= 0 && sideBarBookKey)
      useSidebarStore.getState().setSearchResultIndex(sideBarBookKey, index);
    getView(sideBarBookKey)?.goTo(cfi);
  };

  if (!sideBarBookKey) return null;

  const viewSettings = getViewSettings(sideBarBookKey);
  const bookData = getBookData(sideBarBookKey);
  if (!bookData || !bookData.book || !bookData.bookDoc) {
    return null;
  }
  const { bookDoc } = bookData;
  const languageDir = getBookDirFromLanguage(bookDoc.metadata.language);

  return isSideBarVisible ? (
    <>
      {isOverlay && (
        <Overlay
          className={clsx('z-[45]', viewSettings?.isEink ? '' : 'bg-black/50 sm:bg-black/20')}
          onDismiss={handleClickOverlay}
        />
      )}
      <div
        ref={sidebarRef}
        className={clsx(
          'sidebar-container glossa-reader-sidebar flex min-w-60 select-none flex-col',
          'full-height transition-[padding-top] duration-300',
          viewSettings?.isEink ? 'bg-base-100' : 'bg-base-200',
          appService?.hasRoundedWindow && 'rounded-window-top-left rounded-window-bottom-left',
          isOverlay ? 'z-[45] shadow-2xl' : 'z-20',
          isOverlay && viewSettings?.isEink && 'border-base-content border-e',
        )}
        role='navigation'
        aria-label={_('Sidebar')}
        dir={viewSettings?.rtl && languageDir === 'rtl' ? 'rtl' : 'ltr'}
        style={{
          width: isMobile ? '100%' : `${sideBarWidth}`,
          maxWidth: isMobile ? '100%' : `${MAX_SIDEBAR_WIDTH * 100}%`,
          position: isMobile ? 'fixed' : isSideBarPinned ? 'relative' : 'absolute',
          paddingTop: `${getPanelTopInset({
            isMobile,
            isFullHeightInMobile,
            systemUIVisible,
            statusBarHeight,
            safeAreaInsets,
          })}px`,
          paddingBottom: appService?.hasSafeAreaInset
            ? `${safeAreaInsets?.bottom ?? 0}px`
            : undefined,
        }}
      >
        <style jsx>{`
          @media (max-width: 640px) {
            .sidebar-container {
              border-top-left-radius: 16px;
              border-top-right-radius: 16px;
            }
            .overlay {
              transition: opacity 0.3s ease-in-out;
            }
          }
        `}</style>
        <div
          className={clsx(
            'drag-bar absolute -right-2 top-0 h-full w-0.5 cursor-col-resize bg-transparent p-1',
            isMobile && 'hidden',
          )}
          role='slider'
          tabIndex={0}
          aria-label={_('Resize Sidebar')}
          aria-orientation='horizontal'
          aria-valuenow={parseFloat(sideBarWidth)}
          onMouseDown={handleHorizontalDragStart}
          onTouchStart={handleHorizontalDragStart}
          onKeyDown={handleDragKeyDown}
        ></div>
        <SidebarContent
          bookDoc={bookDoc}
          sideBarBookKey={sideBarBookKey}
          renderNavigation={(tabs) => (
            <div className='flex-shrink-0'>
              {isMobile && (
                <div
                  role='slider'
                  tabIndex={0}
                  aria-label={_('Resize Sidebar')}
                  aria-orientation='vertical'
                  aria-valuenow={sidebarHeight.current}
                  className='drag-handle flex h-6 max-h-6 min-h-6 w-full cursor-row-resize items-center justify-center'
                  onMouseDown={handleVerticalDragStart}
                  onTouchStart={handleVerticalDragStart}
                >
                  <div className='bg-base-content/50 h-1 w-10 rounded-full'></div>
                </div>
              )}
              <SidebarHeader onClose={() => setSideBarVisible(false)}>{tabs}</SidebarHeader>
              <div
                className={clsx('search-bar', {
                  'search-bar-visible': isSearchBarVisible,
                })}
              >
                <SearchBar
                  isVisible={isSearchBarVisible}
                  bookKey={sideBarBookKey!}
                  onHideSearchBar={handleHideSearchBar}
                />
              </div>
            </div>
          )}
        >
          {isSearchBarVisible && searchResults ? (
            <SearchResults
              bookKey={sideBarBookKey}
              results={searchResults}
              onSelectResult={handleSearchResultClick}
            />
          ) : null}
        </SidebarContent>
      </div>
    </>
  ) : null;
};

export default SideBar;
