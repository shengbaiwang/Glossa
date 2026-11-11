import { finishLibraryDrag, startLibraryDrag, useLibraryTransfer } from './libraryTransfer';

export const LIBRARY_POINTER_DRAG = 'glossa-library-pointer-drag';
export type LibraryPointerDrag = {
  phase: 'move' | 'drop' | 'cancel';
  x: number;
  y: number;
  valid?: boolean;
  result?: Promise<boolean>;
};
let cancelActive: (() => void) | undefined;

/** Internal moves stay in the document: native WebView file drops are for imports. */
export function startLibraryPointerDrag(
  event: PointerEvent,
  card: HTMLElement,
  select: () => string[],
  onActivate: () => void,
) {
  if (event.button !== 0 || useLibraryTransfer.getState().dragAccepted) return;
  cancelActive?.();
  const origin = { x: event.clientX, y: event.clientY };
  let x = origin.x;
  let y = origin.y;
  let active = false;
  let preview: HTMLDivElement | undefined;
  let frame = 0;
  let offsetX = 0;
  let offsetY = 0;
  const touch = event.pointerType !== 'mouse';
  const readyAt = performance.now() + (touch ? 520 : 0);
  const reduced =
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ||
    document.documentElement.dataset['eink'] === 'true';
  const previousCursor = document.documentElement.style.cursor;
  const previousSelect = document.body.style.userSelect;
  const dispatch = (phase: LibraryPointerDrag['phase']) => {
    const detail: LibraryPointerDrag = { phase, x, y };
    document.dispatchEvent(new CustomEvent(LIBRARY_POINTER_DRAG, { detail }));
    return detail;
  };
  const paint = () => {
    frame = 0;
    if (!preview) return;
    preview.style.transform = `translate3d(${x - offsetX}px, ${y - offsetY}px, 0)`;
    document.documentElement.style.cursor = dispatch('move').valid ? 'grabbing' : 'no-drop';
  };
  const stop = () => {
    cancelAnimationFrame(frame);
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerup', up, true);
    document.removeEventListener('pointercancel', cancel);
    document.removeEventListener('keydown', key, true);
    window.removeEventListener('blur', cancel);
    if (active) {
      document.documentElement.style.cursor = previousCursor;
      document.body.style.userSelect = previousSelect;
      card.removeAttribute('data-library-dragging');
    }
    if (cancelActive === cancel) cancelActive = undefined;
  };
  const dismiss = (saved: boolean) => {
    if (!preview) return;
    const ghost = preview;
    const target = saved
      ? document.elementFromPoint(x, y)?.closest('[data-library-folder-path]')
      : card.isConnected
        ? card
        : null;
    const rect = target?.getBoundingClientRect();
    if (reduced || !ghost.animate) {
      ghost.remove();
      return;
    }
    const current = ghost.style.transform;
    const end = rect
      ? `translate3d(${rect.left + rect.width / 2 - offsetX}px, ${rect.top + rect.height / 2 - offsetY}px, 0) scale(${saved ? 0.65 : 1})`
      : current;
    const animation = ghost.animate(
      [
        { transform: current, opacity: 1 },
        {
          transform: saved
            ? end
            : card.isConnected
              ? `translate3d(${origin.x - offsetX}px, ${origin.y - offsetY}px, 0)`
              : end,
          opacity: 0,
        },
      ],
      { duration: saved ? 180 : 220, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', fill: 'forwards' },
    );
    void animation.finished.catch(() => {}).then(() => ghost.remove());
  };
  const suppressClick = () => {
    const block = (click: MouseEvent) => {
      click.preventDefault();
      click.stopImmediatePropagation();
    };
    document.addEventListener('click', block, true);
    setTimeout(() => document.removeEventListener('click', block, true), 0);
  };
  const cancel = () => {
    stop();
    if (!active) return;
    suppressClick();
    dispatch('cancel');
    finishLibraryDrag();
    dismiss(false);
  };
  const key = (keyEvent: KeyboardEvent) => {
    if (keyEvent.key !== 'Escape') return;
    keyEvent.preventDefault();
    keyEvent.stopImmediatePropagation();
    cancel();
  };
  const move = (next: PointerEvent) => {
    if (next.pointerId !== event.pointerId) return;
    x = next.clientX;
    y = next.clientY;
    if (!active) {
      if (Math.hypot(x - origin.x, y - origin.y) < 7) return;
      if (performance.now() < readyAt) {
        cancel();
        return;
      }
      const cover = card.querySelector<HTMLElement>('.bookitem-main, .groupitem-main');
      if (!cover) {
        cancel();
        return;
      }
      startLibraryDrag(select());
      if (!useLibraryTransfer.getState().drag) {
        cancel();
        return;
      }
      active = true;
      onActivate();
      const rect = cover.getBoundingClientRect();
      const scale = Math.min(1, 160 / rect.width, 220 / rect.height);
      const width = rect.width * scale,
        height = rect.height * scale;
      offsetX = Math.max(0, Math.min(width, (origin.x - rect.left) * scale));
      offsetY = Math.max(0, Math.min(height, (origin.y - rect.top) * scale));
      preview = document.createElement('div');
      preview.className = 'glossa-library-drag-preview';
      preview.setAttribute('aria-hidden', 'true');
      preview.style.width = `${width}px`;
      preview.style.height = `${height}px`;
      const artwork = cover.cloneNode(true) as HTMLElement;
      artwork
        .querySelectorAll('.glossa-book-selection-overlay, button, [id]')
        .forEach((node) => node.remove());
      Object.assign(artwork.style, {
        width: '100%',
        height: '100%',
        minWidth: '0',
        aspectRatio: 'auto',
      });
      preview.appendChild(artwork);
      document.body.appendChild(preview);
      document.body.style.userSelect = 'none';
      card.setAttribute('data-library-dragging', '');
      if (!reduced)
        artwork.animate?.(
          [
            { opacity: 0.75, scale: '0.97' },
            { opacity: 1, scale: '1' },
          ],
          { duration: 120, easing: 'ease-out' },
        );
    }
    next.preventDefault();
    if (!frame) frame = requestAnimationFrame(paint);
  };
  const up = (next: PointerEvent) => {
    if (next.pointerId !== event.pointerId) return;
    if (!active) {
      stop();
      return;
    }
    next.preventDefault();
    next.stopPropagation();
    x = next.clientX;
    y = next.clientY;
    cancelAnimationFrame(frame);
    paint();
    const { result } = dispatch('drop');
    stop();
    suppressClick();
    if (!result) {
      dispatch('cancel');
      finishLibraryDrag();
      dismiss(false);
    } else
      void result.then(dismiss, () => {
        finishLibraryDrag();
        dismiss(false);
      });
  };
  cancelActive = cancel;
  document.addEventListener('pointermove', move, { passive: false });
  document.addEventListener('pointerup', up, true);
  document.addEventListener('pointercancel', cancel);
  document.addEventListener('keydown', key, true);
  window.addEventListener('blur', cancel);
}
