import { useEffect, useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { impactFeedback } from '@tauri-apps/plugin-haptics';
import { eventDispatcher } from '@/utils/event';
import { SelectedFile } from '@/hooks/useFileSelector';
import { isTauriAppPlatform } from '@/services/environment';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { useLibraryStore } from '@/store/libraryStore';
import { LibraryGroupByType } from '@/types/settings';
import { ensureLibraryGroupByType } from '../utils/libraryUtils';
import { BOOK_ACCEPT_FORMATS } from '@/services/constants';
import { useSearchParams } from 'next/navigation';
import { LIBRARY_ITEMS_MIME, isSupportedDrop, readDroppedWebFiles } from '../utils/libraryDragDrop';

export const useDragDropImport = () => {
  const _ = useTranslation();
  const searchParams = useSearchParams();
  const { settings } = useSettingsStore();
  const groupBy = ensureLibraryGroupByType(searchParams?.get('groupBy'), settings.libraryGroupBy);
  const group = groupBy === LibraryGroupByType.Group ? searchParams?.get('group') || '' : '';
  const { appService } = useEnv();
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    const page = document.querySelector('.library-page');
    let highlighted: HTMLElement | null = null;
    const clear = () => {
      highlighted?.removeAttribute('data-external-drop');
      highlighted = null;
    };
    const targetAt = (target: EventTarget | null) =>
      target instanceof Element ? target.closest<HTMLElement>('[data-library-folder-path]') : null;
    const destination = (target: HTMLElement | null) =>
      target?.dataset['libraryFolderPath'] ?? useLibraryStore.getState().getGroupName(group) ?? '';
    const highlight = (target: HTMLElement | null) => {
      clear();
      highlighted = target;
      target?.setAttribute('data-external-drop', '');
    };
    const failed = (error: unknown) => {
      eventDispatcher.dispatch('toast', {
        type: 'error',
        message: _(
          error instanceof Error &&
            ['Folders support two levels', 'Invalid folder name'].includes(error.message)
            ? error.message
            : 'Unable to import this folder. Please try again.',
        ),
      });
    };
    const noFiles = () =>
      eventDispatcher.dispatch('toast', {
        message: _('No supported files found. Supported formats: {{formats}}', {
          formats: BOOK_ACCEPT_FORMATS,
        }),
        type: 'error',
      });
    const haptic = () => {
      if (appService?.hasHaptics) void impactFeedback('medium');
    };
    const handleNative = async (items: string[], target: string) => {
      if (!appService) return;
      const files: SelectedFile[] = [];
      const directories: string[] = [];
      for (const path of items) {
        if (await appService.isDirectory(path, 'None')) directories.push(path);
        else if (isSupportedDrop(path)) files.push({ path });
      }
      if (!files.length && !directories.length) {
        noFiles();
        return;
      }
      haptic();
      if (files.length)
        eventDispatcher.dispatch('import-book-files', {
          files,
          groupId: target ? useLibraryStore.getState().getGroupId(target) : '',
        });
      for (const path of directories)
        eventDispatcher.dispatch('import-book-directory', { path, destination: target });
    };
    const over = (event: DragEvent) => {
      if (
        !event.dataTransfer?.types.includes('Files') ||
        event.dataTransfer.types.includes(LIBRARY_ITEMS_MIME)
      )
        return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
      highlight(targetAt(event.target));
      setIsDragging(true);
    };
    const leave = (event: DragEvent) => {
      if (event.relatedTarget instanceof Node && page?.contains(event.relatedTarget)) return;
      clear();
      setIsDragging(false);
    };
    const drop = async (event: DragEvent) => {
      if (
        !event.dataTransfer ||
        event.dataTransfer.types.includes(LIBRARY_ITEMS_MIME) ||
        !event.dataTransfer.types.includes('Files')
      )
        return;
      event.preventDefault();
      const target = destination(targetAt(event.target));
      clear();
      setIsDragging(false);
      try {
        const { files, folders } = await readDroppedWebFiles(event.dataTransfer, target);
        if (!files.length && !folders.length) {
          noFiles();
          return;
        }
        haptic();
        eventDispatcher.dispatch('import-book-files', { files, folders });
      } catch (error) {
        failed(error);
      }
    };
    if (!appService?.isMobile) {
      page?.addEventListener('dragover', over as EventListener);
      page?.addEventListener('dragleave', leave as EventListener);
      page?.addEventListener('drop', drop as unknown as EventListener);
    }
    const unlisten = isTauriAppPlatform()
      ? getCurrentWebview().onDragDropEvent((event) => {
          const payload = event.payload;
          if (payload.type === 'over' || payload.type === 'enter' || payload.type === 'drop') {
            const ratio = window.devicePixelRatio || 1;
            const target = targetAt(
              document.elementFromPoint(payload.position.x / ratio, payload.position.y / ratio),
            );
            if (payload.type === 'drop') {
              const path = destination(target);
              clear();
              setIsDragging(false);
              void handleNative(payload.paths, path).catch(failed);
            } else {
              highlight(target);
              setIsDragging(true);
            }
          } else {
            clear();
            setIsDragging(false);
          }
        })
      : undefined;
    return () => {
      clear();
      page?.removeEventListener('dragover', over as EventListener);
      page?.removeEventListener('dragleave', leave as EventListener);
      page?.removeEventListener('drop', drop as unknown as EventListener);
      void unlisten?.then((fn) => fn());
    };
  }, [group, appService, _]);

  return { isDragging };
};
