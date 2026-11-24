import type { ReactNode } from 'react';
import { Volume, Type, Gauge, Info, Settings, X, RefreshCw } from '@/components/GlossaIcons';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import Menu, { MenuSeparator } from '@/components/Menu';
import ParallelReadMenu from './sidebar/BookMenu';
import PDFTools from './sidebar/PDFTools';
import { supportsLocalPDF } from '@/services/pdfEnhancement';
import ReaderCommandItem from './ReaderCommandItem';

interface ViewMenuProps {
  bookKey: string;
  setIsDropdownOpen?: (open: boolean) => void;
  onCloseBook?: () => void;
  showReadingAppearance?: boolean;
  fallbackTools?: (close: () => void) => ReactNode;
}

export default function ViewMenu({
  bookKey,
  setIsDropdownOpen,
  onCloseBook,
  showReadingAppearance = false,
  fallbackTools,
}: ViewMenuProps) {
  const bookDoc = useBookDataStore().getBookData(bookKey)?.bookDoc;
  const viewState = useReaderStore().getViewState(bookKey);
  const close = () => setIsDropdownOpen?.(false);
  return (
    <Menu
      role='menu'
      className='view-menu glossa-menu-surface dropdown-content no-triangle z-20 mt-2'
      onCancel={close}
    >
      {showReadingAppearance && (
        <ReaderCommandItem
          id='appearance'
          bookKey={bookKey}
          icon={<Type size={16} />}
          onClose={close}
        />
      )}
      <ReaderCommandItem
        id='readAloud'
        bookKey={bookKey}
        icon={<Volume size={16} />}
        onClose={close}
      />
      <ReaderCommandItem
        id='autoScroll'
        bookKey={bookKey}
        icon={<Gauge size={16} />}
        toggled={viewState?.autoScrollEnabled ?? false}
        onClose={close}
      />
      <ParallelReadMenu bookKey={bookKey} setIsDropdownOpen={setIsDropdownOpen} />
      {fallbackTools?.(close)}
      <MenuSeparator />
      <ReaderCommandItem id='details' bookKey={bookKey} icon={<Info size={16} />} onClose={close} />
      {bookDoc?.getPDFText && supportsLocalPDF() && (
        <PDFTools bookKey={bookKey} bookDoc={bookDoc} onOpenContents={close} />
      )}
      <MenuSeparator />
      <ReaderCommandItem
        id='reload'
        bookKey={bookKey}
        icon={<RefreshCw size={16} />}
        onClose={close}
      />
      <MenuSeparator />
      <ReaderCommandItem
        id='settings'
        bookKey={bookKey}
        icon={<Settings size={16} />}
        onClose={close}
      />
      {onCloseBook && (
        <ReaderCommandItem
          id='close'
          bookKey={bookKey}
          icon={<X size={16} />}
          onClose={close}
          closeBook={() => onCloseBook()}
        />
      )}
    </Menu>
  );
}
