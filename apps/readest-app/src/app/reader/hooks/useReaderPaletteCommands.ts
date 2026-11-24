import { useEffect, useLayoutEffect, useRef } from 'react';
import { useCommandPalette } from '@/components/command-palette';
import { useEnv } from '@/context/EnvContext';
import { useShortcutConfig } from '@/hooks/useShortcuts';
import { useTranslation } from '@/hooks/useTranslation';
import type { CommandItem } from '@/services/commandRegistry';
import { isMacPlatform } from '@/services/environment';
import {
  canRunReaderCommand,
  currentReaderBook,
  readerCommands,
  readerCommandShortcut,
  runReaderCommand,
  type ReaderCommandId,
} from '@/services/readerCommands';
import { useReaderStore } from '@/store/readerStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useParallelViewStore } from '@/store/parallelViewStore';
import { isPluginEnabled } from '@/glossa/plugins/registry';

export function useReaderPaletteCommands(
  sidebarKey: string | null,
  bookKeys: string[],
  closeBook: (bookKey: string) => void,
) {
  const { setReaderCommands } = useCommandPalette();
  const { envConfig } = useEnv();
  const _ = useTranslation();
  const shortcuts = useShortcutConfig();
  const bookKey = sidebarKey && bookKeys.includes(sidebarKey) ? sidebarKey : bookKeys[0];
  const closeCurrentBook = useRef(closeBook);
  useLayoutEffect(() => {
    closeCurrentBook.current = closeBook;
  }, [closeBook]);
  const parallel = useParallelViewStore((state) => state.parallelViews.length > 0);
  const scrolled = useReaderStore(
    (state) => !!bookKey && !!state.getViewSettings(bookKey)?.scrolled,
  );
  const hasBook = useBookDataStore((state) => !!bookKey && !!state.getBookData(bookKey)?.book);
  const hasPDFText = useBookDataStore(
    (state) => !!bookKey && !!state.getBookData(bookKey)?.bookDoc?.getPDFText,
  );
  const hasAnnotations = useBookDataStore(
    (state) =>
      !!bookKey &&
      !!state
        .getConfig(bookKey)
        ?.booknotes?.some((note) => note.type === 'annotation' && !note.deletedAt),
  );
  const contentsEnabled = useSettingsStore((state) =>
    isPluginEnabled(state.settings, 'pdfAutoContents'),
  );

  useEffect(() => {
    if (!bookKey || !hasBook) return;
    let active = true;
    const items = (Object.keys(readerCommands) as ReaderCommandId[]).map((id): CommandItem => {
      const label = readerCommands[id].label;
      const isAvailable = () =>
        active && currentReaderBook() === bookKey && canRunReaderCommand(id, bookKey);
      return {
        id: `reader.${id}`,
        labelKey: label,
        localizedLabel: _(label),
        keywords: [],
        category: 'actions',
        shortcut: readerCommandShortcut(id, shortcuts, isMacPlatform()),
        isAvailable,
        action: () => {
          if (isAvailable()) runReaderCommand(envConfig, id, bookKey, closeCurrentBook.current);
        },
      };
    });
    setReaderCommands(items);
    return () => {
      active = false;
      setReaderCommands([]);
    };
    // Rebuild the displayed results when scroll mode or plugin availability changes.
  }, [
    bookKey,
    bookKeys.length,
    parallel,
    hasBook,
    hasPDFText,
    hasAnnotations,
    scrolled,
    contentsEnabled,
    shortcuts,
    envConfig,
    _,
    setReaderCommands,
  ]);
}
