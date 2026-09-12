import clsx from 'clsx';
import React, {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { NotebookPen } from '@/components/GlossaIcons';

import { useSettingsStore } from '@/store/settingsStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { useNotebookStore } from '@/store/notebookStore';

import { useTranslation } from '@/hooks/useTranslation';
import { useThemeStore } from '@/store/themeStore';
import { useEnv } from '@/context/EnvContext';
import { useSwipeToDismiss } from '@/hooks/useSwipeToDismiss';
import { usePanelResize } from '@/hooks/usePanelResize';
import { TextSelection } from '@/utils/sel';
import { BookNote } from '@/types/book';
import { uniqueId } from '@/utils/misc';
import { eventDispatcher } from '@/utils/event';
import { getBookDirFromLanguage } from '@/utils/book';
import { getPanelTopInset } from '@/utils/insets';
import { Overlay } from '@/components/Overlay';
import { saveSysSettings } from '@/helpers/settings';
import { NOTE_PREFIX } from '@/types/view';
import useShortcuts from '@/hooks/useShortcuts';
import {
  findAnnotationAtCfi,
  removeBookNoteOverlays,
  removeEmptyAnnotationPlaceholder,
} from '../../utils/annotatorUtil';

import NotebookHeader from './Header';
import NoteEditor from './NoteEditor';
import SearchBar from './SearchBar';

import EmptyState from '../EmptyState';

const MIN_NOTEBOOK_WIDTH = 0.15;
const MAX_NOTEBOOK_WIDTH = 0.45;
const ReadingGuidePanel = lazy(() => import('@/glossa/ui/ReadingGuidePanel'));
const MindmapPanel = lazy(() => import('@/glossa/ui/MindmapPanel'));
const ConversationPanel = lazy(() => import('@/glossa/ui/ConversationPanel'));

const Notebook: React.FC = ({}) => {
  const _ = useTranslation();
  const { envConfig, appService } = useEnv();
  const { settings } = useSettingsStore();
  const { updateAppTheme, safeAreaInsets, systemUIVisible, statusBarHeight } = useThemeStore();
  const { sideBarBookKey } = useSidebarStore();
  const { notebookWidth, isNotebookVisible, isNotebookPinned } = useNotebookStore();
  const { notebookActiveTab, setNotebookActiveTab } = useNotebookStore();
  const { notebookNewAnnotation, notebookEditAnnotation, setNotebookPin } = useNotebookStore();
  const { getBookData, getConfig, saveConfig, updateBooknotes } = useBookDataStore();
  const { getView, getViewsById, getProgress, getViewSettings } = useReaderStore();
  const { getNotebookWidth, setNotebookWidth, setNotebookVisible, toggleNotebookPin } =
    useNotebookStore();
  const { setNotebookNewAnnotation, setNotebookNewHighlightId } = useNotebookStore();
  const { setNotebookEditAnnotation } = useNotebookStore();

  const [isSearchBarVisible, setIsSearchBarVisible] = useState(false);
  const [searchResults, setSearchResults] = useState<BookNote[] | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [isMobile, setIsMobile] = useState(window.innerWidth < 640);
  const [isFullHeightInMobile, setIsFullHeightInMobile] = useState(isMobile);
  const tabId = useId();
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 640);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const {
    panelRef: notebookRef,
    overlayRef,
    panelHeight: notebookHeight,
    handleVerticalDragStart,
  } = useSwipeToDismiss(
    () => {
      setNotebookVisible(false);
      setIsFullHeightInMobile(isMobile);
    },
    (data) => setIsFullHeightInMobile(data.clientY < 44),
  );

  const onNavigateEvent = async () => {
    const { isNotebookPinned, notebookActiveTab } = useNotebookStore.getState();
    const bookKey = useSidebarStore.getState().sideBarBookKey;
    const isReadingGuide =
      (notebookActiveTab === 'guide' ||
        notebookActiveTab === 'conversation' ||
        notebookActiveTab === 'mindmap') &&
      bookKey &&
      getBookData(bookKey)?.book?.format === 'EPUB';
    // Sources and their return action belong to the reading guide session.
    if (!isReadingGuide && (!isNotebookPinned || window.innerWidth < 640)) {
      setNotebookVisible(false);
    }
  };

  const handleHideNotebook = useCallback(() => {
    if (!isNotebookPinned || isMobile) {
      setNotebookVisible(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNotebookPinned, isMobile]);

  useShortcuts({ onEscape: handleHideNotebook }, [handleHideNotebook]);

  useEffect(() => {
    if (isNotebookVisible) {
      updateAppTheme('base-200');
      overlayRef.current = document.querySelector('.overlay') as HTMLDivElement | null;
    } else {
      updateAppTheme('base-100');
      overlayRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNotebookVisible]);

  useEffect(() => {
    setNotebookWidth(settings.globalReadSettings.notebookWidth);
    setNotebookPin(settings.globalReadSettings.isNotebookPinned);
    setNotebookVisible(settings.globalReadSettings.isNotebookPinned);

    eventDispatcher.on('navigate', onNavigateEvent);
    return () => {
      eventDispatcher.off('navigate', onNavigateEvent);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (
      !isNotebookVisible ||
      notebookActiveTab !== 'notes' ||
      notebookNewAnnotation ||
      notebookEditAnnotation
    ) {
      setIsSearchBarVisible(false);
      setSearchResults(null);
      setSearchTerm('');
    }
  }, [
    isNotebookVisible,
    notebookActiveTab,
    notebookNewAnnotation,
    notebookEditAnnotation,
    sideBarBookKey,
  ]);

  const handleNotebookResize = (newWidth: string) => {
    setNotebookWidth(newWidth);
    settings.globalReadSettings.notebookWidth = newWidth;
  };

  const handleTogglePin = () => {
    toggleNotebookPin();
    const globalReadSettings = settings.globalReadSettings;
    const newGlobalReadSettings = { ...globalReadSettings, isNotebookPinned: !isNotebookPinned };
    saveSysSettings(envConfig, 'globalReadSettings', newGlobalReadSettings);
  };

  // Abandon a note-creation flow: tear down the empty highlight the "Annotate"
  // action eagerly created as the note anchor so it doesn't leak into the
  // booknotes list (#4791). A saved note carries text, so it survives the guard
  // in removeEmptyAnnotationPlaceholder; a restyled pre-existing highlight has no
  // tracked id and is left alone. `bookKey` is passed explicitly so the unmount/
  // book-switch cleanup targets the book the placeholder belongs to.
  const handleCancelNewAnnotation = useCallback(
    (bookKey: string | null) => {
      const { notebookNewHighlightId } = useNotebookStore.getState();
      if (bookKey && notebookNewHighlightId) {
        const config = getConfig(bookKey);
        const { booknotes: annotations = [] } = config || {};
        const placeholder = removeEmptyAnnotationPlaceholder(
          annotations,
          notebookNewHighlightId,
          Date.now(),
        );
        if (placeholder) {
          const views = getViewsById(bookKey.split('-')[0]!);
          views.forEach((view) => removeBookNoteOverlays(view, placeholder));
          const updatedConfig = updateBooknotes(bookKey, annotations);
          if (updatedConfig) {
            // Read settings fresh: this callback has stable identity (empty deps)
            // so a captured `settings` would go stale across saves.
            saveConfig(envConfig, bookKey, updatedConfig, useSettingsStore.getState().settings);
          }
        }
      }
      setNotebookNewHighlightId(null);
      setNotebookNewAnnotation(null);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // The "Annotate" action keeps a placeholder highlight alive only while its
  // editor is on screen. The moment that creation flow stops being presented —
  // Cancel/Escape (selection cleared), the notebook closing, swipe-dismiss, or a
  // navigate — clean the placeholder up (#4791). Save clears the tracked id (and
  // the placeholder gains note text), so this no-ops for saved annotations.
  useEffect(() => {
    if (!(isNotebookVisible && notebookNewAnnotation)) {
      handleCancelNewAnnotation(sideBarBookKey);
    }
  }, [isNotebookVisible, notebookNewAnnotation, sideBarBookKey, handleCancelNewAnnotation]);

  // Switching books (notebook pinned, so it stays presented) or closing the
  // reader leaves the placeholder behind; clean it up against the book we are
  // leaving on the way out (#4791).
  useEffect(() => {
    return () => {
      handleCancelNewAnnotation(sideBarBookKey);
      setNotebookEditAnnotation(null);
    };
  }, [sideBarBookKey, handleCancelNewAnnotation, setNotebookEditAnnotation]);

  const handleClickOverlay = () => {
    setNotebookVisible(false);
    setNotebookNewAnnotation(null);
    setNotebookEditAnnotation(null);
  };

  const handleSaveNote = (selection: TextSelection, note: string) => {
    if (!sideBarBookKey) return false;
    const view = getView(sideBarBookKey);
    const config = getConfig(sideBarBookKey)!;

    const cfi = view?.getCFI(selection.index, selection.range);
    if (!cfi) return false;

    const { booknotes: annotations = [] } = config;
    const existingIndex = findAnnotationAtCfi(annotations, cfi);
    if (existingIndex !== -1) {
      // Attach the note to the existing highlight at this CFI instead of
      // creating a second record. The highlight overlay (value = cfi) already
      // exists; add the note bubble overlay (value = NOTE_PREFIX+cfi).
      const existing = annotations[existingIndex]!;
      const updated: BookNote = {
        ...existing,
        note,
        text: selection.text || existing.text,
        updatedAt: Date.now(),
      };
      annotations[existingIndex] = updated;
      view?.addAnnotation({ ...updated, value: `${NOTE_PREFIX}${updated.cfi}` });
    } else {
      // No highlight at this CFI yet (e.g. a note added without first
      // highlighting): create one unified record with the current global style
      // so the note still shows an underlying highlight, and draw both overlays.
      const style = settings.globalReadSettings.highlightStyle;
      const color = settings.globalReadSettings.highlightStyles[style];
      const annotation: BookNote = {
        id: uniqueId(),
        type: 'annotation',
        cfi,
        style,
        color,
        note,
        page: selection.page,
        text: selection.text,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      view?.addAnnotation(annotation);
      view?.addAnnotation({ ...annotation, value: `${NOTE_PREFIX}${annotation.cfi}` });
      annotations.push(annotation);
    }
    const updatedConfig = updateBooknotes(sideBarBookKey, annotations);
    if (updatedConfig) {
      saveConfig(envConfig, sideBarBookKey, updatedConfig, settings);
    }
    setNotebookNewAnnotation(null);
    // The placeholder now carries a note (or a fresh unified record was created),
    // so it's a real annotation — drop the cancel-cleanup handle (#4791).
    setNotebookNewHighlightId(null);
    return true;
  };

  const handleEditNote = (note: BookNote, isDelete: boolean) => {
    if (!sideBarBookKey) return false;
    const view = getView(sideBarBookKey);
    const config = getConfig(sideBarBookKey)!;
    const progress = getProgress(sideBarBookKey)!;
    const { booknotes: annotations = [] } = config;
    const existingIndex = annotations.findIndex((item) => item.id === note.id);
    if (existingIndex === -1) return false;
    if (isDelete) {
      note.deletedAt = Date.now();
    } else {
      note.updatedAt = Date.now();
    }
    note.page = progress.page;
    annotations[existingIndex] = note;
    view?.addAnnotation({ ...note, value: `${NOTE_PREFIX}${note.cfi}` }, true);
    const updatedConfig = updateBooknotes(sideBarBookKey, annotations);
    if (updatedConfig) {
      saveConfig(envConfig, sideBarBookKey, updatedConfig, settings);
    }
    setNotebookEditAnnotation(null);
    return true;
  };

  const { handleResizeStart: handleDragStart, handleResizeKeyDown: handleDragKeyDown } =
    usePanelResize({
      side: 'end',
      minWidth: MIN_NOTEBOOK_WIDTH,
      maxWidth: MAX_NOTEBOOK_WIDTH,
      getWidth: getNotebookWidth,
      onResize: handleNotebookResize,
    });

  const config = getConfig(sideBarBookKey);
  const { booknotes: allNotes = [] } = config || {};
  const excerptNotes = allNotes
    .filter((note) => note.type === 'excerpt' && note.text && !note.deletedAt)
    .sort((a, b) => a.createdAt - b.createdAt);

  const handleToggleSearchBar = () => {
    setIsSearchBarVisible((prev) => !prev);
    if (isSearchBarVisible) {
      setSearchResults(null);
      setSearchTerm('');
    }
  };

  const filteredExcerptNotes = useMemo(
    () =>
      isSearchBarVisible && searchResults
        ? searchResults.filter((note) => note.type === 'excerpt' && note.text && !note.deletedAt)
        : excerptNotes,
    [excerptNotes, searchResults, isSearchBarVisible],
  );

  if (!sideBarBookKey) return null;

  const bookData = getBookData(sideBarBookKey);
  const viewSettings = getViewSettings(sideBarBookKey);
  if (!bookData?.book || !bookData.bookDoc) {
    return null;
  }
  const { book, bookDoc } = bookData;
  const languageDir = getBookDirFromLanguage(bookDoc.metadata.language);
  const supportsReadingGuide = book.format === 'EPUB';
  const activeTab = supportsReadingGuide ? notebookActiveTab : 'notes';
  const tabs = [
    { id: 'conversation' as const, label: _('Conversation') },
    { id: 'guide' as const, label: _('Guide') },
    { id: 'mindmap' as const, label: _('Mind map') },
    { id: 'notes' as const, label: _('Excerpts') },
  ];

  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    const isRTL = event.currentTarget.closest('[dir]')?.getAttribute('dir') === 'rtl';
    let nextIndex: number;
    switch (event.key) {
      case 'ArrowRight':
        nextIndex = (index + (isRTL ? -1 : 1) + tabs.length) % tabs.length;
        break;
      case 'ArrowLeft':
        nextIndex = (index + (isRTL ? 1 : -1) + tabs.length) % tabs.length;
        break;
      case 'Home':
        nextIndex = 0;
        break;
      case 'End':
        nextIndex = tabs.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
    tabRefs.current[nextIndex]?.focus();
    setNotebookActiveTab(tabs[nextIndex]!.id);
  };

  const hasSearchResults = filteredExcerptNotes.length > 0;
  const hasAnyNotes = excerptNotes.length > 0;
  const isNotesTabEmpty =
    !notebookNewAnnotation && !notebookEditAnnotation && !isSearchBarVisible && !hasAnyNotes;

  return isNotebookVisible ? (
    <>
      {(!isNotebookPinned || isMobile) &&
        !((activeTab === 'conversation' || activeTab === 'mindmap') && !isMobile) && (
          <Overlay
            className={clsx('z-[45]', viewSettings?.isEink ? '' : 'bg-black/50 sm:bg-black/20')}
            onDismiss={handleClickOverlay}
          />
        )}
      <div
        ref={notebookRef}
        className={clsx(
          'notebook-container glossa-reader-notebook end-0 flex min-w-60 select-none flex-col',
          'full-height font-sans text-base font-normal transition-[padding-top] duration-300 sm:text-sm',
          viewSettings?.isEink ? 'bg-base-100' : 'bg-base-200',
          appService?.hasRoundedWindow && 'rounded-se-[10px] rounded-ee-[10px]',
          (isNotebookPinned || activeTab === 'conversation' || activeTab === 'mindmap') && !isMobile
            ? 'z-20'
            : 'z-[45] shadow-2xl',
          (!isNotebookPinned || isMobile) && viewSettings?.isEink && 'border-base-content border-s',
        )}
        role='group'
        aria-label={_('Notebook')}
        onKeyDown={(event) => {
          if (
            event.key === 'Escape' &&
            !event.defaultPrevented &&
            (!isNotebookPinned || isMobile)
          ) {
            event.stopPropagation();
            handleHideNotebook();
          }
        }}
        style={{
          width: isMobile ? '100%' : `${notebookWidth}`,
          maxWidth: isMobile ? '100%' : `${MAX_NOTEBOOK_WIDTH * 100}%`,
          position: isMobile
            ? 'fixed'
            : isNotebookPinned || activeTab === 'conversation' || activeTab === 'mindmap'
              ? 'relative'
              : 'absolute',
          paddingTop: `${getPanelTopInset({
            isMobile,
            isFullHeightInMobile,
            systemUIVisible,
            statusBarHeight,
            safeAreaInsets,
          })}px`,
        }}
      >
        <style jsx>{`
          @media (max-width: 640px) {
            .notebook-container {
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
            'drag-bar absolute -start-2 top-0 h-full w-0.5 cursor-col-resize bg-transparent p-2',
            isMobile && 'hidden',
          )}
          role='slider'
          tabIndex={0}
          aria-label={_('Resize Notebook')}
          aria-orientation='horizontal'
          aria-valuemin={MIN_NOTEBOOK_WIDTH * 100}
          aria-valuemax={MAX_NOTEBOOK_WIDTH * 100}
          aria-valuenow={parseFloat(notebookWidth)}
          onMouseDown={handleDragStart}
          onTouchStart={handleDragStart}
          onKeyDown={handleDragKeyDown}
        />
        <div className='flex-shrink-0'>
          {isMobile && (
            <div
              role='slider'
              tabIndex={0}
              aria-label={_('Resize Notebook')}
              aria-orientation='vertical'
              aria-valuenow={notebookHeight.current}
              className='drag-handle flex h-6 max-h-6 min-h-6 w-full cursor-row-resize items-center justify-center'
              onMouseDown={handleVerticalDragStart}
              onTouchStart={handleVerticalDragStart}
            >
              <div className='bg-base-content/50 h-1 w-10 rounded-full'></div>
            </div>
          )}
          <NotebookHeader
            isPinned={isNotebookPinned}
            isSearchBarVisible={isSearchBarVisible}
            handleClose={() => setNotebookVisible(false)}
            handleTogglePin={handleTogglePin}
            handleToggleSearchBar={handleToggleSearchBar}
            showSearchButton={activeTab === 'notes'}
            conversation={activeTab === 'conversation'}
          />

          {supportsReadingGuide && (
            <div
              className='glossa-reader-tabs glossa-notebook-tabs flex shrink-0 gap-1 px-3 pb-2'
              role='tablist'
              aria-label={_('Notebook')}
            >
              {tabs.map(({ id, label }, index) => (
                <button
                  key={id}
                  ref={(element) => {
                    tabRefs.current[index] = element;
                  }}
                  id={`${tabId}-tab-${id}`}
                  type='button'
                  role='tab'
                  className='glossa-reader-tab min-h-11 min-w-0 flex-1 rounded-lg px-2 py-2 text-xs font-medium'
                  aria-selected={activeTab === id}
                  aria-controls={`${tabId}-panel-${id}`}
                  tabIndex={activeTab === id ? 0 : -1}
                  onClick={() => setNotebookActiveTab(id)}
                  onKeyDown={(event) => handleTabKeyDown(event, index)}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          <div
            hidden={activeTab !== 'notes' || !isSearchBarVisible}
            className={clsx('search-bar', {
              'search-bar-visible': isSearchBarVisible,
            })}
          >
            <SearchBar
              isVisible={isSearchBarVisible}
              bookKey={sideBarBookKey}
              searchTerm={searchTerm}
              onSearchResultChange={setSearchResults}
            />
          </div>
        </div>
        {supportsReadingGuide && activeTab === 'conversation' && (
          <div
            className='glossa-notebook-content min-h-0 flex-1 overflow-hidden'
            role='tabpanel'
            id={`${tabId}-panel-conversation`}
            aria-labelledby={`${tabId}-tab-conversation`}
          >
            <Suspense
              fallback={
                <p className='glossa-reader-muted px-4 py-3' role='status'>
                  {_('Loading...')}
                </p>
              }
            >
              <ConversationPanel book={book} bookDoc={bookDoc} bookKey={sideBarBookKey} />
            </Suspense>
          </div>
        )}
        {supportsReadingGuide && activeTab === 'mindmap' && (
          <div
            className='glossa-notebook-content min-h-0 flex-1 overflow-y-auto'
            role='tabpanel'
            id={`${tabId}-panel-mindmap`}
            aria-labelledby={`${tabId}-tab-mindmap`}
            tabIndex={0}
          >
            <Suspense
              fallback={
                <p className='glossa-reader-muted px-4 py-3' role='status'>
                  {_('Loading...')}
                </p>
              }
            >
              <MindmapPanel book={book} bookDoc={bookDoc} bookKey={sideBarBookKey} />
            </Suspense>
          </div>
        )}
        {supportsReadingGuide && (
          <div
            key={`${book.hash}:${sideBarBookKey}`}
            className='glossa-notebook-content min-h-0 flex-1 overflow-y-auto'
            role='tabpanel'
            id={`${tabId}-panel-guide`}
            aria-labelledby={`${tabId}-tab-guide`}
            hidden={activeTab !== 'guide'}
            tabIndex={0}
          >
            <Suspense
              fallback={
                <p className='glossa-reader-muted px-4 py-3 text-sm' role='status'>
                  {_('Loading...')}
                </p>
              }
            >
              {activeTab === 'guide' && (
                <ReadingGuidePanel book={book} bookDoc={bookDoc} bookKey={sideBarBookKey} />
              )}
            </Suspense>
          </div>
        )}
        <div
          className='min-h-0 flex-1 overflow-y-auto'
          role={supportsReadingGuide ? 'tabpanel' : undefined}
          id={`${tabId}-panel-notes`}
          aria-labelledby={supportsReadingGuide ? `${tabId}-tab-notes` : undefined}
          hidden={activeTab !== 'notes'}
          tabIndex={0}
        >
          {isNotesTabEmpty ? (
            <div className='flex flex-grow items-center justify-center overflow-y-auto px-3'>
              <EmptyState
                Icon={NotebookPen}
                label={_('No Notes')}
                hint={_('Capture an idea as you read')}
              />
            </div>
          ) : (
            <div className='flex-grow overflow-y-auto px-3'>
              {isSearchBarVisible && searchResults && !hasSearchResults && hasAnyNotes && (
                <div className='flex h-32 items-center justify-center text-gray-500'>
                  <p className='font-size-sm text-center'>{_('No notes match your search')}</p>
                </div>
              )}
              <div dir='ltr'>
                {filteredExcerptNotes.length > 0 && (
                  <p className='glossa-eyebrow my-4'>
                    {_('Excerpts')}
                    {isSearchBarVisible && searchResults && (
                      <span className='font-size-xs ms-2 text-gray-500'>
                        ({filteredExcerptNotes.length})
                      </span>
                    )}
                  </p>
                )}
              </div>
              <ul dir={viewSettings?.rtl && languageDir === 'rtl' ? 'rtl' : 'ltr'}>
                {filteredExcerptNotes.map((item, index) => (
                  <li key={`${index}-${item.id}`} className='my-2'>
                    <div
                      role='button'
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Backspace' || e.key === 'Delete') {
                          handleEditNote(item, true);
                        }
                      }}
                      className='booknote-item glossa-reader-excerpt collapse-arrow border-base-300 bg-base-100 collapse border'
                    >
                      <div
                        className={clsx(
                          'collapse-title pe-8 text-sm font-medium',
                          'h-[2.5rem] min-h-[2.5rem] p-[0.6rem]',
                        )}
                        style={
                          {
                            '--top-override': '1.25rem',
                            '--end-override': '0.7rem',
                          } as React.CSSProperties
                        }
                      >
                        <p className='line-clamp-1'>{item.text || `Excerpt ${index + 1}`}</p>
                      </div>
                      <div className='collapse-content font-size-xs select-text px-3 pb-0'>
                        <p className='hyphens-auto text-justify'>{item.text}</p>
                        <div className='flex justify-end' dir='ltr'>
                          {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions*/}
                          <div
                            className='font-size-xs cursor-pointer align-bottom text-red-500 hover:text-red-600'
                            onClick={handleEditNote.bind(null, item, true)}
                            aria-label={_('Delete')}
                          >
                            {_('Delete')}
                          </div>
                        </div>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
              <div dir='ltr'>
                {(notebookNewAnnotation || notebookEditAnnotation) && !isSearchBarVisible && (
                  <p className='glossa-eyebrow my-4'>{_('Notes')}</p>
                )}
              </div>
              {(notebookNewAnnotation || notebookEditAnnotation) && !isSearchBarVisible && (
                <NoteEditor
                  key={sideBarBookKey}
                  bookKey={sideBarBookKey}
                  active={activeTab === 'notes'}
                  onSave={handleSaveNote}
                  onEdit={(item) => handleEditNote(item, false)}
                />
              )}
            </div>
          )}
        </div>
        <div
          className='flex-shrink-0'
          style={{
            paddingBottom: `${(safeAreaInsets?.bottom || 0) / 2}px`,
          }}
        ></div>
      </div>
    </>
  ) : null;
};

export default Notebook;
