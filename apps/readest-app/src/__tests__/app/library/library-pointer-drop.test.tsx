import { useRef } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useLibraryItemDrop } from '@/app/library/hooks/useLibraryItemDrop';
import { startLibraryPointerDrag } from '@/app/library/utils/libraryPointerDrag';
import { startLibraryDrag, useLibraryTransfer } from '@/app/library/utils/libraryTransfer';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import type { SystemSettings } from '@/types/settings';
import { DEFAULT_SYSTEM_SETTINGS } from '@/services/constants';

const move = vi.fn();
function Destinations() {
  const root = useRef<HTMLDivElement>(null);
  useLibraryItemDrop({ root, name: 'test', disabled: false, move });
  return (
    <div ref={root}>
      <button data-library-folder-path='Empty'>Empty</button>
    </div>
  );
}
function pointer(phase: 'move' | 'drop' | 'cancel') {
  const detail = { phase, x: 100, y: 100, result: undefined as Promise<boolean> | undefined };
  document.dispatchEvent(new CustomEvent('glossa-library-pointer-drag', { detail }));
  return detail;
}
beforeEach(() => {
  useSettingsStore.setState({
    settings: { ...DEFAULT_SYSTEM_SETTINGS, libraryFolders: ['Source', 'Empty'] } as SystemSettings,
  });
  useLibraryStore.getState().setLibrary([
    {
      hash: 'book',
      title: 'Original',
      author: '',
      format: 'EPUB',
      createdAt: 1,
      updatedAt: 1,
      groupName: 'Source',
    },
  ]);
  startLibraryDrag(['book']);
  move.mockReset().mockResolvedValue(true);
});
afterEach(() => {
  document.dispatchEvent(new PointerEvent('pointercancel'));
  cleanup();
  document.querySelectorAll('[data-test-drag-source]').forEach((node) => node.remove());
  vi.restoreAllMocks();
  useLibraryTransfer.setState({ drag: undefined });
});
it('moves to an empty sidebar destination without a native DataTransfer or drop event', async () => {
  render(<Destinations />);
  const target = screen.getByRole('button', { name: 'Empty' });
  Object.defineProperty(document, 'elementFromPoint', {
    configurable: true,
    value: vi.fn(() => target),
  });
  pointer('move');
  expect(target.getAttribute('data-library-item-drop')).toBe('valid');
  await act(async () => {
    await pointer('drop').result;
  });
  expect(move).toHaveBeenCalledWith(expect.objectContaining({ selection: ['book'] }), 'Empty');
  await waitFor(() => expect(useLibraryTransfer.getState().drag).toBeUndefined());
});
it('clears the target when the pointer leaves its root and on cancellation', () => {
  render(<Destinations />);
  const target = screen.getByRole('button');
  const hit = vi.fn<() => Element | null>(() => target);
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: hit });
  pointer('move');
  expect(target.hasAttribute('data-library-item-drop')).toBe(true);
  hit.mockReturnValue(document.body);
  pointer('move');
  expect(target.hasAttribute('data-library-item-drop')).toBe(false);
  hit.mockReturnValue(target);
  pointer('move');
  pointer('cancel');
  expect(target.hasAttribute('data-library-item-drop')).toBe(false);
  expect(move).not.toHaveBeenCalled();
});
it('rejects a stale source membership before accepting a pointer drop', async () => {
  render(<Destinations />);
  const target = screen.getByRole('button');
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => target });
  useLibraryStore
    .getState()
    .setLibrary(
      useLibraryStore.getState().library.map((book) => ({ ...book, groupName: 'Other' })),
    );
  pointer('move');
  expect(target.getAttribute('data-library-item-drop')).toBe('invalid');
  await act(async () => {
    await pointer('drop').result;
  });
  expect(move).not.toHaveBeenCalled();
});

function beginCoverDrag() {
  render(<Destinations />);
  const target = screen.getByRole('button');
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => target });
  const card = document.createElement('div');
  card.setAttribute('data-test-drag-source', '');
  card.innerHTML =
    '<div class="bookitem-main"><img alt="artwork"><div class="glossa-book-selection-overlay"></div></div><div class="glossa-book-metadata"><button>i</button></div>';
  document.body.appendChild(card);
  vi.spyOn(card.querySelector('.bookitem-main')!, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(0, 0, 100, 150),
  );
  const select = vi.fn(() => ['book']);
  startLibraryPointerDrag(
    new PointerEvent('pointerdown', {
      button: 0,
      pointerType: 'mouse',
      pointerId: 3,
      clientX: 30,
      clientY: 40,
    }),
    card,
    select,
    vi.fn(),
  );
  return { card, select };
}
it('keeps a normal click below the drag threshold and does not start a move', () => {
  const { card, select } = beginCoverDrag();
  fireEvent.pointerMove(document, { pointerId: 3, clientX: 32, clientY: 42 });
  fireEvent.pointerUp(document, { pointerId: 3, clientX: 32, clientY: 42 });
  expect(select).not.toHaveBeenCalled();
  expect(document.querySelector('.glossa-library-drag-preview')).toBeNull();
  expect(move).not.toHaveBeenCalled();
  card.remove();
});
it('uses only artwork in the preview, commits the pointer destination and cleans up', async () => {
  const { card } = beginCoverDrag();
  fireEvent.pointerMove(document, { pointerId: 3, clientX: 100, clientY: 100 });
  const preview = document.querySelector('.glossa-library-drag-preview')!;
  expect(preview.querySelector('img')?.getAttribute('alt')).toBe('artwork');
  expect(
    preview.querySelector('button, .glossa-book-metadata, .glossa-book-selection-overlay'),
  ).toBeNull();
  await act(async () => {
    fireEvent.pointerUp(document, { pointerId: 3, clientX: 100, clientY: 100 });
  });
  expect(move).toHaveBeenCalledOnce();
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  expect(document.documentElement.style.cursor).toBe('');
  expect(screen.getByRole('button', { name: 'Empty' }).hasAttribute('data-library-item-drop')).toBe(
    false,
  );
  expect(document.querySelector('.glossa-library-drag-preview')).toBeNull();
  expect(card.hasAttribute('data-library-dragging')).toBe(false);
  expect(document.body.style.userSelect).toBe('');
  card.remove();
});
it.each([
  'Escape',
  'blur',
])('cancels a lifted cover with %s without moving the book', async (reason) => {
  const { card } = beginCoverDrag();
  fireEvent.pointerMove(document, { pointerId: 3, clientX: 100, clientY: 100 });
  expect(document.querySelector('.glossa-library-drag-preview')).toBeTruthy();
  if (reason === 'Escape') fireEvent.keyDown(document, { key: 'Escape' });
  else fireEvent.blur(window);
  expect(document.querySelector('.glossa-library-drag-preview')).toBeNull();
  expect(useLibraryTransfer.getState().drag).toBeUndefined();
  expect(move).not.toHaveBeenCalled();
  expect(document.body.style.userSelect).toBe('');
  card.remove();
});
