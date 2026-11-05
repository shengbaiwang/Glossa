import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';

const STORAGE_KEY = 'glossa-library-sidebar-width';
const DEFAULT_WIDTH = 208;
const MIN_WIDTH = 180;
const MAX_WIDTH = 420;
const maximumWidth = () => Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, window.innerWidth - 520));
const clampWidth = (width: number) =>
  Math.round(Math.max(MIN_WIDTH, Math.min(maximumWidth(), width)));

export function useLibrarySidebarResize() {
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [maximum, setMaximum] = useState(MAX_WIDTH);
  const drag = useRef<{ id: number; x: number; width: number; direction: number } | null>(null);

  useEffect(() => {
    let initial = DEFAULT_WIDTH;
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved && Number.isFinite(Number(saved))) initial = Number(saved);
    } catch {
      // Width remains adjustable when local preferences are unavailable.
    }
    setWidth(clampWidth(initial));
    const resize = () => {
      setMaximum(maximumWidth());
      setWidth((current) => clampWidth(current));
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  useEffect(() => {
    const cancelDrag = () => {
      if (!drag.current) return;
      setWidth(clampWidth(drag.current.width));
      drag.current = null;
    };
    const key = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || !drag.current) return;
      event.preventDefault();
      event.stopPropagation();
      cancelDrag();
    };
    document.addEventListener('keydown', key, true);
    window.addEventListener('blur', cancelDrag);
    return () => {
      document.removeEventListener('keydown', key, true);
      window.removeEventListener('blur', cancelDrag);
    };
  }, []);

  const commit = (value: number) => {
    const next = clampWidth(value);
    setWidth(next);
    try {
      localStorage.setItem(STORAGE_KEY, String(next));
    } catch {
      // Keep the current session usable without browser storage.
    }
  };
  const cancel = () => {
    if (!drag.current) return;
    setWidth(clampWidth(drag.current.width));
    drag.current = null;
  };
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || event.isPrimary === false) return;
    event.preventDefault();
    drag.current = {
      id: event.pointerId,
      x: event.clientX,
      width,
      direction: getComputedStyle(event.currentTarget).direction === 'rtl' ? -1 : 1,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    if (!start || start.id !== event.pointerId) return;
    setWidth(clampWidth(start.width + (event.clientX - start.x) * start.direction));
  };
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    if (!start || start.id !== event.pointerId) return;
    drag.current = null;
    commit(start.width + (event.clientX - start.x) * start.direction);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const direction = getComputedStyle(event.currentTarget).direction === 'rtl' ? -1 : 1;
    const step = event.shiftKey ? 30 : 10;
    const next =
      event.key === 'Home'
        ? MIN_WIDTH
        : event.key === 'End'
          ? maximumWidth()
          : event.key === 'ArrowLeft'
            ? width - step * direction
            : event.key === 'ArrowRight'
              ? width + step * direction
              : null;
    if (next === null) return;
    event.preventDefault();
    event.stopPropagation();
    commit(next);
  };
  return {
    width,
    resizeProps: {
      role: 'separator',
      tabIndex: 0,
      'aria-orientation': 'vertical' as const,
      'aria-valuemin': MIN_WIDTH,
      'aria-valuemax': maximum,
      'aria-valuenow': width,
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: cancel,
      onLostPointerCapture: cancel,
      onKeyDown,
    },
  };
}
