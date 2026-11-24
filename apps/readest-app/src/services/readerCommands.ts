import { useBookDataStore } from '@/store/bookDataStore';
import { useNotebookStore } from '@/store/notebookStore';
import { useParallelViewStore } from '@/store/parallelViewStore';
import { useReaderStore } from '@/store/readerStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { isPluginEnabled } from '@/glossa/plugins/registry';
import { formatShortcutBinding, type ShortcutConfig } from '@/helpers/shortcuts';
import type { EnvConfigType } from '@/services/environment';
import { supportsLocalPDF } from '@/services/pdfEnhancement';
import { eventDispatcher } from '@/utils/event';

export const readerCommands = {
  appearance: { label: 'Reading Appearance', shortcut: 'onOpenFontLayoutSettings' },
  bookmark: { label: 'Toggle Bookmark', shortcut: 'onToggleBookmark' },
  readAloud: { label: 'Read Aloud' },
  autoScroll: { label: 'Auto Scroll', shortcut: 'onToggleAutoScroll' },
  enterParallel: { label: 'Enter Parallel Read' },
  exitParallel: { label: 'Exit Parallel Read' },
  details: { label: 'Book Details' },
  reload: { label: 'Reload Book' },
  settings: { label: 'Settings' },
  close: { label: 'Close Book' },
  exportAnnotations: { label: 'Export Annotations' },
  importAnnotations: { label: 'Import Annotations' },
  clearAnnotations: { label: 'Clear Annotations' },
  pdfContents: { label: 'Contents generator' },
} satisfies Record<string, { label: string; shortcut?: keyof ShortcutConfig }>;

export type ReaderCommandId = keyof typeof readerCommands;

export function readerCommandShortcut(
  id: ReaderCommandId,
  shortcuts: ShortcutConfig,
  isMac: boolean,
) {
  const command = readerCommands[id];
  return 'shortcut' in command
    ? formatShortcutBinding(command.shortcut, shortcuts, isMac)
    : undefined;
}

export function currentReaderBook() {
  const { bookKeys } = useReaderStore.getState();
  const { sideBarBookKey } = useSidebarStore.getState();
  return sideBarBookKey && bookKeys.includes(sideBarBookKey) ? sideBarBookKey : bookKeys[0];
}

export function canRunReaderCommand(id: ReaderCommandId, bookKey: string) {
  const reader = useReaderStore.getState();
  const data = useBookDataStore.getState();
  if (!reader.bookKeys.includes(bookKey) || !data.getBookData(bookKey)?.book) return false;
  if (id === 'autoScroll') return !!reader.getViewSettings(bookKey)?.scrolled;
  if (id === 'enterParallel' || id === 'exitParallel') {
    const parallel = useParallelViewStore.getState().parallelViews.length > 0;
    return reader.bookKeys.length > 1 && (id === 'exitParallel' ? parallel : !parallel);
  }
  if (id === 'clearAnnotations') {
    return !!data
      .getConfig(bookKey)
      ?.booknotes?.some((note) => note.type === 'annotation' && !note.deletedAt);
  }
  if (id === 'pdfContents') {
    return (
      !!data.getBookData(bookKey)?.bookDoc?.getPDFText &&
      supportsLocalPDF() &&
      isPluginEnabled(useSettingsStore.getState().settings, 'pdfAutoContents')
    );
  }
  return true;
}

export function runReaderCommand(
  env: EnvConfigType,
  id: ReaderCommandId,
  bookKey: string,
  closeBook?: (bookKey: string) => void,
) {
  if (!canRunReaderCommand(id, bookKey)) return;
  const reader = useReaderStore.getState();
  const data = useBookDataStore.getState();
  const sidebar = useSidebarStore.getState();
  const settings = useSettingsStore.getState();
  switch (id) {
    case 'appearance':
      settings.openSettingsDialog('reading', bookKey);
      break;
    case 'bookmark':
      void eventDispatcher.dispatch('toggle-bookmark', { bookKey });
      break;
    case 'readAloud':
      void eventDispatcher.dispatch('tts-start', { bookKey });
      break;
    case 'autoScroll':
      void eventDispatcher.dispatch('autoscroll-toggle', { bookKey });
      break;
    case 'enterParallel':
      useParallelViewStore.getState().setParallel(reader.bookKeys);
      break;
    case 'exitParallel':
      useParallelViewStore.getState().unsetParallel(reader.bookKeys);
      break;
    case 'details': {
      const book = data.getBookData(bookKey)!.book;
      const progress = data.getConfig(bookKey)?.progress;
      eventDispatcher.dispatchSync('show-book-details', progress ? { ...book, progress } : book);
      break;
    }
    case 'reload':
      void reader.recreateViewer(env, bookKey);
      break;
    case 'settings':
      settings.openSettingsDialog('application');
      break;
    case 'close':
      closeBook?.(bookKey);
      break;
    case 'exportAnnotations':
      void eventDispatcher.dispatch('export-annotations', { bookKey });
      break;
    case 'importAnnotations':
      void eventDispatcher.dispatch('import-annotations', { bookKey });
      break;
    case 'clearAnnotations':
      void eventDispatcher.dispatch('clear-annotations', { bookKey });
      break;
    case 'pdfContents': {
      sidebar.setSideBarBookKey(bookKey);
      const notebook = useNotebookStore.getState();
      notebook.setNotebookActiveTab('pdfAutoContents');
      notebook.setNotebookVisible(true);
      break;
    }
  }
}
