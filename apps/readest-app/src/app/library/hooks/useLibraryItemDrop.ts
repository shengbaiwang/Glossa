import { useEffect, useRef } from 'react';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import { collectFolderPaths, moveToFolder } from '../utils/libraryFolders';
import { LIBRARY_ITEMS_MIME, readLibraryItems } from '../utils/libraryDragDrop';
import {
  captureCurrentLibraryTransfer,
  finishLibraryDrag,
  isLibraryTransferCurrent,
  useLibraryTransfer,
  type LibraryTransfer,
} from '../utils/libraryTransfer';

/** All visible group destinations use the same validation, hover and scrolling behavior. */
export function useLibraryItemDrop({
  root,
  scroller,
  name,
  disabled,
  move,
  hover,
}: {
  root: React.RefObject<HTMLElement | null>;
  scroller?: React.RefObject<HTMLElement | null>;
  name: string;
  disabled: boolean;
  move: (items: LibraryTransfer, path: string) => Promise<boolean>;
  hover?: (path: string) => (() => void) | undefined;
}) {
  const latest = useRef({ disabled, move, hover });
  latest.current = { disabled, move, hover };
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    let highlighted: HTMLElement | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let frame = 0;
    let y = 0;
    let hoverPath: string | undefined;
    const clear = () => {
      highlighted?.removeAttribute('data-library-item-drop');
      highlighted = null;
      clearTimeout(timer);
      timer = undefined;
      hoverPath = undefined;
      cancelAnimationFrame(frame);
      frame = 0;
    };
    const targetAt = (target: EventTarget | null) => {
      if (
        !(target instanceof Element) ||
        target.closest('[role="dialog"], [role="menu"], input, form')
      )
        return null;
      const node = target.closest<HTMLElement>('[data-library-folder-path]');
      return node && element.contains(node) ? node : null;
    };
    const scroll = () => {
      const viewport =
        scroller?.current ??
        element.querySelector<HTMLElement>('.glossa-library-navigation-categories');
      if (viewport) {
        const rect = viewport.getBoundingClientRect();
        if (y > rect.top && y < rect.top + 32) viewport.scrollTop -= 8;
        else if (y < rect.bottom && y > rect.bottom - 32) viewport.scrollTop += 8;
      }
      frame = requestAnimationFrame(scroll);
    };
    const over = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes(LIBRARY_ITEMS_MIME)) return;
      event.preventDefault();
      event.stopPropagation();
      const node = targetAt(event.target);
      const path = node?.dataset['libraryFolderPath'];
      const snapshot = useLibraryTransfer.getState().drag;
      let valid = !latest.current.disabled && path !== undefined && !!snapshot;
      if (valid && snapshot && path !== undefined) {
        const books = useLibraryStore.getState().library;
        const paths = collectFolderPaths(
          books,
          useSettingsStore.getState().settings.libraryFolders,
        );
        try {
          if (!isLibraryTransferCurrent(snapshot, books, paths)) valid = false;
          else moveToFolder(books, paths, snapshot.selection, path);
        } catch {
          valid = false;
        }
      }
      event.dataTransfer.dropEffect = valid ? 'move' : 'none';
      if (highlighted !== node) clear();
      highlighted = node;
      node?.setAttribute('data-library-item-drop', valid ? 'valid' : 'invalid');
      y = event.clientY;
      if (!frame) frame = requestAnimationFrame(scroll);
      if (!valid) {
        clearTimeout(timer);
        timer = undefined;
        hoverPath = undefined;
      } else if (node?.hasAttribute('data-library-drop-open') && hoverPath !== path) {
        clearTimeout(timer);
        hoverPath = path;
        timer = setTimeout(() => {
          const state = useLibraryTransfer.getState();
          if (!state.drag || state.dragAccepted || path === undefined) return;
          const restore = latest.current.hover?.(path);
          if (restore && !state.restores.has(name)) {
            useLibraryTransfer.setState({ restores: new Map(state.restores).set(name, restore) });
          }
        }, 650);
      }
    };
    const drop = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes(LIBRARY_ITEMS_MIME)) return;
      event.preventDefault();
      event.stopPropagation();
      const path = targetAt(event.target)?.dataset['libraryFolderPath'];
      const ids = readLibraryItems(event.dataTransfer);
      const snapshot = useLibraryTransfer.getState().drag ?? captureCurrentLibraryTransfer(ids);
      clear();
      if (
        path === undefined ||
        !snapshot ||
        latest.current.disabled ||
        !ids.length ||
        ids.length !== snapshot.selection.length ||
        ids.some((id) => !snapshot.selection.includes(id))
      ) {
        finishLibraryDrag();
        return;
      }
      // A native dragend can arrive before disk persistence completes.
      useLibraryTransfer.setState({ drag: snapshot, dragAccepted: true });
      void latest.current.move(snapshot, path).then((saved) => {
        if (useLibraryTransfer.getState().drag === snapshot) finishLibraryDrag(saved);
      });
    };
    const leave = (event: DragEvent) => {
      if (!(event.relatedTarget instanceof Node) || !element.contains(event.relatedTarget)) clear();
    };
    const end = () => {
      clear();
      const state = useLibraryTransfer.getState();
      if (state.drag && !state.dragAccepted) finishLibraryDrag();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') end();
    };
    element.addEventListener('dragover', over);
    element.addEventListener('dragleave', leave);
    element.addEventListener('drop', drop);
    window.addEventListener('dragend', end);
    window.addEventListener('keydown', key);
    window.addEventListener('blur', end);
    return () => {
      clear();
      element.removeEventListener('dragover', over);
      element.removeEventListener('dragleave', leave);
      element.removeEventListener('drop', drop);
      window.removeEventListener('dragend', end);
      window.removeEventListener('keydown', key);
      window.removeEventListener('blur', end);
    };
  }, [root, scroller, name]);
}
