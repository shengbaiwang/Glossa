import { useEffect, useRef, useState } from 'react';

export type FolderDrop = { path: string; edge: 'inside' | 'before' | 'after' };
type Gesture = {
  path: string;
  x: number;
  y: number;
  lastX: number;
  lastY: number;
  id: number;
  touch: boolean;
  ready: boolean;
  dragging: boolean;
  timer?: ReturnType<typeof setTimeout>;
};

/** Pointer drag keeps touch scrolling until a hold, and uses the same branch move as menus. */
export function useFolderDrag({
  root,
  disabled,
  onMenu,
  onDrop,
  onExpand,
  onStart,
  onFinish,
  onHoverOutside,
  canDrop,
}: {
  root: React.RefObject<HTMLElement | null>;
  disabled: boolean;
  onMenu: (path: string | null, position: { x: number; y: number }) => void;
  onDrop: (path: string, target: FolderDrop) => Promise<boolean>;
  onExpand: (path: string) => void;
  onStart: (path: string) => void;
  onFinish: (saved: boolean) => void;
  onHoverOutside?: (path: string) => void;
  canDrop?: (path: string, target: FolderDrop) => boolean;
}) {
  const latest = useRef({
    disabled,
    onMenu,
    onDrop,
    onExpand,
    onStart,
    onFinish,
    onHoverOutside,
    canDrop,
  });
  latest.current = {
    disabled,
    onMenu,
    onDrop,
    onExpand,
    onStart,
    onFinish,
    onHoverOutside,
    canDrop,
  };
  const gesture = useRef<Gesture | null>(null);
  const suppressClick = useRef(false);
  const [drag, setDrag] = useState<{
    path: string;
    x: number;
    y: number;
    target?: FolderDrop;
  } | null>(null);
  useEffect(() => {
    let expansion: ReturnType<typeof setTimeout> | undefined;
    let over = '';
    let frame = 0;
    let external: HTMLElement | null = null;
    const project = (g: Gesture): FolderDrop | undefined => {
      external?.removeAttribute('data-library-item-drop');
      external = null;
      const bounds = root.current?.getBoundingClientRect();
      if (
        !bounds ||
        g.lastX < bounds.left ||
        g.lastX > bounds.right ||
        g.lastY < bounds.top ||
        g.lastY > bounds.bottom
      ) {
        const hit = document.elementFromPoint?.(g.lastX, g.lastY);
        if (hit?.closest('[role="dialog"], [role="menu"], input, form')) return;
        external = hit?.closest<HTMLElement>('[data-library-folder-path]') ?? null;
        if (external) {
          const target: FolderDrop = {
            path: external.dataset['libraryFolderPath'] ?? '',
            edge: 'inside',
          };
          external.setAttribute(
            'data-library-item-drop',
            latest.current.canDrop?.(g.path, target) === false ? 'invalid' : 'valid',
          );
          return target;
        }
        return;
      }
      const rows = root.current?.querySelectorAll<HTMLElement>('[data-folder-drop]') ?? [];
      for (const row of rows) {
        const rect = row.getBoundingClientRect();
        if (g.lastY < rect.top || g.lastY > rect.bottom) continue;
        const path = row.dataset['folderDrop'] ?? '';
        const offset = (g.lastY - rect.top) / rect.height;
        return {
          path,
          edge:
            !path || (offset > 0.25 && offset < 0.75)
              ? 'inside'
              : offset <= 0.25
                ? 'before'
                : 'after',
        };
      }
      return { path: '', edge: 'inside' };
    };
    const update = () => {
      const g = gesture.current;
      if (!g?.dragging) return;
      const target = project(g);
      setDrag({ path: g.path, x: g.lastX, y: g.lastY, target });
      const allowed = target && latest.current.canDrop?.(g.path, target) !== false;
      const next =
        allowed && target.edge === 'inside'
          ? `${external ? 'outside:' : 'inside:'}${target.path}`
          : '';
      if (next !== over) {
        clearTimeout(expansion);
        over = next;
        if (next && target) {
          const outside = !!external;
          const opens = external?.hasAttribute('data-library-drop-open');
          expansion = setTimeout(() => {
            if (outside) {
              if (opens) latest.current.onHoverOutside?.(target.path);
            } else latest.current.onExpand(target.path);
          }, 650);
        }
      }
      const scroll =
        external?.closest('.bookshelf')?.querySelector<HTMLElement>('[data-library-scroll]') ??
        root.current?.querySelector<HTMLElement>('.glossa-library-navigation-categories');
      if (scroll) {
        const rect = scroll.getBoundingClientRect();
        if (g.lastY > rect.top && g.lastY < rect.top + 32) scroll.scrollTop -= 7;
        else if (g.lastY < rect.bottom && g.lastY > rect.bottom - 32) scroll.scrollTop += 7;
      }
      frame = requestAnimationFrame(update);
    };
    const cancel = (notify: unknown = true) => {
      if (notify && gesture.current?.dragging) latest.current.onFinish(false);
      clearTimeout(gesture.current?.timer);
      clearTimeout(expansion);
      cancelAnimationFrame(frame);
      external?.removeAttribute('data-library-item-drop');
      external = null;
      gesture.current = null;
      setDrag(null);
      over = '';
    };
    const move = (event: PointerEvent) => {
      const g = gesture.current;
      if (!g || g.id !== event.pointerId) return;
      g.lastX = event.clientX;
      g.lastY = event.clientY;
      if (Math.hypot(g.lastX - g.x, g.lastY - g.y) <= 7) return;
      if (g.touch && !g.ready) {
        cancel();
        return;
      }
      if (!g.dragging) {
        latest.current.onStart(g.path);
        g.dragging = true;
        suppressClick.current = true;
        clearTimeout(g.timer);
        latest.current.onMenu(null, { x: 0, y: 0 });
        update();
      }
      event.preventDefault();
    };
    const up = (event: PointerEvent) => {
      const g = gesture.current;
      if (!g || g.id !== event.pointerId) return;
      if (g.dragging || g.ready) {
        event.preventDefault();
        suppressClick.current = true;
      }
      if (g.dragging) {
        g.lastX = event.clientX;
        g.lastY = event.clientY;
        const target = project(g);
        if (target) {
          void latest.current
            .onDrop(g.path, target)
            .then((saved) => latest.current.onFinish(saved));
          cancel(false);
        } else cancel();
      } else {
        cancel();
      }
      setTimeout(() => {
        suppressClick.current = false;
      }, 0);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && gesture.current) {
        event.preventDefault();
        cancel();
      }
    };
    document.addEventListener('pointermove', move, { passive: false });
    document.addEventListener('pointerup', up, true);
    document.addEventListener('pointercancel', cancel);
    document.addEventListener('keydown', key);
    window.addEventListener('blur', cancel);
    return () => {
      cancel(false);
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up, true);
      document.removeEventListener('pointercancel', cancel);
      document.removeEventListener('keydown', key);
      window.removeEventListener('blur', cancel);
    };
  }, [root]);
  return {
    drag,
    suppressClick,
    start: (event: React.PointerEvent, path: string) => {
      if (
        latest.current.disabled ||
        event.button !== 0 ||
        (event.target as HTMLElement).closest('input, form, [data-expander]')
      )
        return;
      suppressClick.current = false;
      const g: Gesture = {
        path,
        x: event.clientX,
        y: event.clientY,
        lastX: event.clientX,
        lastY: event.clientY,
        id: event.pointerId,
        touch: event.pointerType !== 'mouse',
        ready: false,
        dragging: false,
      };
      gesture.current = g;
      if (g.touch)
        g.timer = setTimeout(() => {
          g.ready = true;
          suppressClick.current = true;
          latest.current.onMenu(path, { x: g.x, y: g.y });
        }, 520);
    },
  };
}
