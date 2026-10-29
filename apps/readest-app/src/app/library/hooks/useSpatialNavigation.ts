import { useEffect, useCallback } from 'react';
import type { LibrarySelectionOptions } from '../utils/librarySelection';

const ARROW_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);

function getGridColumnCount(items: HTMLElement[]): number {
  if (items.length < 2) return 1;
  const firstTop = items[0]!.getBoundingClientRect().top;
  for (let i = 1; i < items.length; i++) {
    if (items[i]!.getBoundingClientRect().top > firstTop + 5) return i;
  }
  return items.length;
}

function getGridItems(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>('[data-library-item-id][tabindex="0"]'),
  );
}

export function useSpatialNavigation(
  containerRef: React.RefObject<HTMLElement | null>,
  onSelect?: (id: string, options?: LibrarySelectionOptions) => void,
) {
  // Grid navigation within the bookshelf
  const handleGridKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!ARROW_KEYS.has(e.key)) return;

      const container = containerRef.current;
      if (!container) return;

      const active = document.activeElement as HTMLElement | null;
      // Nested book actions and text fields own their keyboard behavior.
      if (active && active !== container && !active.matches('[data-library-item-id][tabindex="0"]'))
        return;
      const scope = active?.closest<HTMLElement>('[data-spatial-navigation]') ?? container;
      if (
        scope.dataset['spatialNavigation'] === 'recent' &&
        (e.key === 'ArrowUp' || e.key === 'ArrowDown')
      )
        return;
      const items = getGridItems(scope);
      if (items.length === 0) return;

      const currentIndex = items.indexOf(document.activeElement as HTMLElement);
      if (currentIndex === -1) {
        items[0]?.focus();
        const id = items[0]?.dataset['libraryItemId'];
        if (id) onSelect?.(id);
        e.preventDefault();
        return;
      }

      const cols = getGridColumnCount(items);
      const rtl = getComputedStyle(scope).direction === 'rtl';
      let targetIndex = currentIndex;

      switch (e.key) {
        case 'ArrowRight':
          targetIndex = currentIndex + (rtl ? -1 : 1);
          break;
        case 'ArrowLeft':
          targetIndex = currentIndex + (rtl ? 1 : -1);
          break;
        case 'ArrowDown':
          targetIndex = currentIndex + cols;
          break;
        case 'ArrowUp':
          targetIndex = currentIndex - cols;
          break;
      }

      if (targetIndex >= 0 && targetIndex < items.length && targetIndex !== currentIndex) {
        items[targetIndex]?.focus();
        const id = items[targetIndex]?.dataset['libraryItemId'];
        if (id && (!(e.ctrlKey || e.metaKey) || e.shiftKey)) {
          const currentId = active?.dataset['libraryItemId'];
          if (e.shiftKey && currentId) onSelect?.(currentId, { preserve: true });
          onSelect?.(id, {
            range: e.shiftKey,
            toggle: e.ctrlKey || e.metaKey,
            ...(scope.dataset['spatialNavigation'] === 'recent'
              ? {
                  order: items.map((item) => item.dataset['libraryItemId']!),
                }
              : {}),
          });
        }
        items[targetIndex]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        e.preventDefault();
      }
    },
    [containerRef, onSelect],
  );

  // Handle focus transition from outside the bookshelf (e.g. header) into the grid
  const handleWindowKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key !== 'ArrowDown' || e.defaultPrevented) return;
      const active = document.activeElement;
      if (
        active instanceof HTMLElement &&
        (active.matches('input, textarea, select, [contenteditable="true"]') ||
          active.closest('[role="menu"], [role="dialog"]'))
      )
        return;

      const container = containerRef.current;
      if (!container) return;

      // Only handle when focus is outside the bookshelf
      if (container.contains(document.activeElement)) return;

      const items = getGridItems(container);
      if (items.length === 0) return;

      items[0]?.focus();
      const id = items[0]?.dataset['libraryItemId'];
      if (id) onSelect?.(id);
      items[0]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      e.preventDefault();
    },
    [containerRef, onSelect],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.addEventListener('keydown', handleGridKeyDown);
    window.addEventListener('keydown', handleWindowKeyDown);
    return () => {
      container.removeEventListener('keydown', handleGridKeyDown);
      window.removeEventListener('keydown', handleWindowKeyDown);
    };
  }, [handleGridKeyDown, handleWindowKeyDown, containerRef]);
}
