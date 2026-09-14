import clsx from 'clsx';
import React, { useId } from 'react';

import { BookDoc } from '@/libs/document';
import { useSidebarStore } from '@/store/sidebarStore';
import { useBookDataStore } from '@/store/bookDataStore';

import { OverlayScrollbarsComponent } from 'overlayscrollbars-react';
import 'overlayscrollbars/overlayscrollbars.css';

import TOCView from './TOCView';
import BookmarkView from './BookmarkView';
import TabNavigation from './TabNavigation';

const SidebarContent: React.FC<{
  renderNavigation?: (tabs: React.ReactNode) => React.ReactNode;
  children?: React.ReactNode;
  bookDoc: BookDoc;
  sideBarBookKey: string;
}> = ({ bookDoc, sideBarBookKey, renderNavigation, children }) => {
  const { isSearchBarVisible, setSearchBarVisible } = useSidebarStore();
  const { getConfig, setConfig } = useBookDataStore();
  const config = getConfig(sideBarBookKey);
  const storedTab = config?.viewSettings?.sideBarTab;
  const savedTab = storedTab === 'bookmarks' ? storedTab : 'toc';
  const activeTab = isSearchBarVisible ? 'search' : savedTab;
  const tabId = useId();

  const handleTabChange = (tab: string) => {
    setSearchBarVisible(tab === 'search');
    if (tab === 'search' || savedTab === tab || !config?.viewSettings) return;
    setConfig(sideBarBookKey, {
      viewSettings: { ...config.viewSettings, sideBarTab: tab },
    });
  };

  const tabs = (
    <TabNavigation activeTab={activeTab} onTabChange={handleTabChange} idPrefix={tabId} />
  );

  return (
    <>
      {renderNavigation ? renderNavigation(tabs) : tabs}
      <div
        className={clsx(
          'sidebar-content glossa-reader-sidebar-content flex h-full min-h-0 flex-grow flex-col',
          'font-sans text-base font-normal sm:text-sm',
        )}
        role='tabpanel'
        id={`${tabId}-panel`}
        aria-labelledby={`${tabId}-tab-${activeTab}`}
        tabIndex={0}
      >
        {isSearchBarVisible ? (
          children
        ) : (
          <OverlayScrollbarsComponent
            className='min-h-0 flex-1'
            options={{
              // The tab content is width-bound; x stays hidden so oversized
              // touch-target halos (e.g. the toolbar's dropdown toggle) can't
              // turn into a horizontal scrollbar.
              overflow: { x: 'hidden' },
              scrollbars: { autoHide: 'scroll', clickScroll: true },
              showNativeOverlaidScrollbars: false,
            }}
            defer
          >
            <div className='scroll-container h-full'>
              {activeTab === 'toc' && bookDoc.toc && (
                <TOCView toc={bookDoc.toc} bookKey={sideBarBookKey} />
              )}
              {activeTab === 'bookmarks' && (
                <BookmarkView bookKey={sideBarBookKey} toc={bookDoc.toc ?? []} />
              )}
            </div>
          </OverlayScrollbarsComponent>
        )}
      </div>
    </>
  );
};

export default SidebarContent;
