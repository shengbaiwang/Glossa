import { useEffect, useRef, useState } from 'react';

type Rect = { left: number; top: number; width: number; height: number };
type Options = {
  root: React.RefObject<HTMLElement | null>;
  scroller: React.RefObject<HTMLElement | null>;
  selected: string[];
  selecting: boolean;
  enabled: boolean;
  onSelect: (ids: string[]) => void;
  onMode: (enabled: boolean) => void;
};
type Gesture = {
  id: number;
  x: number;
  y: number;
  clientX: number;
  clientY: number;
  active: boolean;
  additive: boolean;
  previous: string[];
  selecting: boolean;
  measured: Map<string, Rect>;
};

/** Blank-space selection shares the shelf's existing selection and book drag payload. */
export function useLibraryMarquee(options: Options) {
  const latest = useRef(options);
  latest.current = options;
  const gesture = useRef<Gesture | null>(null);
  const suppressClick = useRef(false);
  const [rect, setRect] = useState<Rect | null>(null);
  useEffect(() => {
    let frame = 0;
    const offset = () => latest.current.scroller.current?.scrollTop ?? 0;
    const update = () => {
      const g = gesture.current;
      if (!g?.active) return;
      const scroll = latest.current.scroller.current;
      const viewport = scroll?.getBoundingClientRect();
      if (scroll && viewport && g.clientX >= viewport.left && g.clientX <= viewport.right) {
        if (g.clientY > viewport.bottom - 32) scroll.scrollTop += 9;
        else if (g.clientY < viewport.top + 32) scroll.scrollTop -= 9;
      }
      const top = Math.min(g.y, g.clientY + offset());
      const selection = {
        left: Math.min(g.x, g.clientX),
        top,
        width: Math.abs(g.clientX - g.x),
        height: Math.abs(g.clientY + offset() - g.y),
      };
      for (const el of latest.current.root.current?.querySelectorAll<HTMLElement>(
        '[data-book-hash]',
      ) ?? []) {
        const box = el.getBoundingClientRect();
        if (box.width && box.height)
          g.measured.set(el.dataset['bookHash']!, {
            left: box.left,
            top: box.top + offset(),
            width: box.width,
            height: box.height,
          });
      }
      const hits = [...g.measured]
        .filter(
          ([, box]) =>
            box.left < selection.left + selection.width &&
            box.left + box.width > selection.left &&
            box.top < selection.top + selection.height &&
            box.top + box.height > selection.top,
        )
        .map(([id]) => id);
      const ids = [...new Set([...(g.additive ? g.previous : []), ...hits])];
      if (ids.join('\0') !== latest.current.selected.join('\0')) latest.current.onSelect(ids);
      setRect({ ...selection, top: selection.top - offset() });
    };
    const tick = () => {
      update();
      frame = requestAnimationFrame(tick);
    };
    const finish = (restore = false) => {
      const g = gesture.current;
      if (!g) return;
      cancelAnimationFrame(frame);
      gesture.current = null;
      setRect(null);
      if (restore && g.active) {
        latest.current.onSelect(g.previous);
        latest.current.onMode(g.selecting);
      }
    };
    const move = (event: PointerEvent) => {
      const g = gesture.current;
      if (!g || event.pointerId !== g.id) return;
      g.clientX = event.clientX;
      g.clientY = event.clientY;
      if (!g.active && Math.hypot(g.clientX - g.x, g.clientY + offset() - g.y) < 5) return;
      if (!g.active) {
        g.active = true;
        suppressClick.current = true;
        latest.current.onMode(true);
        tick();
      }
      event.preventDefault();
      update();
    };
    const up = (event: PointerEvent) => {
      const g = gesture.current;
      if (!g || g.id !== event.pointerId) return;
      if (g.active) {
        event.preventDefault();
        update();
      } else if (!g.additive) {
        latest.current.onSelect([]);
        latest.current.onMode(false);
      }
      finish();
    };
    const cancel = () => finish(true);
    const pointerCancel = (event: PointerEvent) => {
      if (event.pointerId === gesture.current?.id) cancel();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && gesture.current) {
        event.preventDefault();
        event.stopPropagation();
        cancel();
      }
    };
    document.addEventListener('pointermove', move, { passive: false });
    document.addEventListener('pointerup', up, true);
    document.addEventListener('pointercancel', pointerCancel);
    document.addEventListener('keydown', key, true);
    window.addEventListener('blur', cancel);
    return () => {
      cancelAnimationFrame(frame);
      gesture.current = null;
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up, true);
      document.removeEventListener('pointercancel', pointerCancel);
      document.removeEventListener('keydown', key, true);
      window.removeEventListener('blur', cancel);
    };
  }, []);
  return {
    rect,
    handlers: {
      onPointerDownCapture: (event: React.PointerEvent) => {
        suppressClick.current = false;
        if (
          !options.enabled ||
          event.button !== 0 ||
          event.pointerType !== 'mouse' ||
          (event.target as HTMLElement).closest(
            '[data-book-hash], [data-group-name], button, a, input, select, textarea, [role="button"], [contenteditable="true"], .glossa-bookshelf-header, .os-scrollbar, [data-overlayscrollbars-viewport] > [data-overlayscrollbars-padding]',
          )
        )
          return;
        const scroll = options.scroller.current;
        const viewport = scroll?.getBoundingClientRect();
        const bounds = options.root.current?.getBoundingClientRect() ?? viewport;
        // Include the shelf's blank insets, leaving native/custom scrollbars alone.
        if (
          bounds &&
          bounds.width &&
          (event.clientX >= bounds.right ||
            event.clientX < bounds.left ||
            event.clientY < bounds.top ||
            event.clientY >= bounds.bottom)
        )
          return;
        if (
          viewport &&
          event.clientX >= viewport.left + scroll!.clientWidth &&
          event.clientX < viewport.right
        )
          return;
        gesture.current = {
          id: event.pointerId,
          x: event.clientX,
          y: event.clientY + (scroll?.scrollTop ?? 0),
          clientX: event.clientX,
          clientY: event.clientY,
          active: false,
          additive: event.shiftKey || event.metaKey || event.ctrlKey,
          previous: [...options.selected],
          selecting: options.selecting,
          measured: new Map(),
        };
        event.preventDefault();
      },
      onClickCapture: (event: React.MouseEvent) => {
        if (suppressClick.current) {
          event.preventDefault();
          event.stopPropagation();
          suppressClick.current = false;
        }
      },
    },
  };
}
