import clsx from 'clsx';
import React, { lazy, Suspense, useId } from 'react';

import { BookDoc } from '@/libs/document';
import { useSidebarStore } from '@/store/sidebarStore';
import { useBookDataStore } from '@/store/bookDataStore';

import { OverlayScrollbarsComponent } from 'overlayscrollbars-react';
import 'overlayscrollbars/overlayscrollbars.css';

import TOCView from './TOCView';
import BooknoteView from './BooknoteView';
import TabNavigation from './TabNavigation';
const StudyNotesPanel = lazy(() => import('@/glossa/ui/StudyNotesPanel'));

const SidebarContent: React.FC<{
  bookDoc: BookDoc;
  sideBarBookKey: string;
}> = ({ bookDoc, sideBarBookKey }) => {
  const { setSearchBarVisible } = useSidebarStore();
  const { getConfig, setConfig, getBookData } = useBookDataStore();
  const book = getBookData(sideBarBookKey)?.book;
  const showStudyNotes = book?.format === 'EPUB';
  const config = getConfig(sideBarBookKey);
  const storedTab = config?.viewSettings?.sideBarTab;
  const activeTab =
    storedTab === 'annotations' ||
    storedTab === 'bookmarks' ||
    (storedTab === 'study' && showStudyNotes)
      ? storedTab
      : 'toc';
  const tabId = useId();

  const handleTabChange = (tab: string) => {
    if (activeTab === tab || !config?.viewSettings) return;

    // The header search icon is contextual (annotation search vs in-book
    // search), so an open search bar never survives a tab switch.
    setSearchBarVisible(false);
    setConfig(sideBarBookKey, {
      viewSettings: { ...config.viewSettings, sideBarTab: tab },
    });
  };

  return (
    <>
      <TabNavigation
        activeTab={activeTab}
        onTabChange={handleTabChange}
        idPrefix={tabId}
        showStudyNotes={showStudyNotes}
      />
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
            {activeTab === 'annotations' && (
              <BooknoteView type='annotation' toc={bookDoc.toc ?? []} bookKey={sideBarBookKey} />
            )}
            {activeTab === 'bookmarks' && (
              <BooknoteView type='bookmark' toc={bookDoc.toc ?? []} bookKey={sideBarBookKey} />
            )}
            {activeTab === 'study' && book && (
              <Suspense fallback={null}>
                <StudyNotesPanel
                  key={sideBarBookKey}
                  book={book}
                  bookDoc={bookDoc}
                  bookKey={sideBarBookKey}
                />
              </Suspense>
            )}
          </div>
        </OverlayScrollbarsComponent>
      </div>
    </>
  );
};

export default SidebarContent;
