import { renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useFoliateEvents } from '@/app/reader/hooks/useFoliateEvents';
import type { FoliateView } from '@/types/view';

it('disconnects from the original renderer after the view clears its reference', () => {
  const renderer = new EventTarget();
  const view = Object.assign(new EventTarget(), { renderer }) as unknown as FoliateView;
  const onStabilized = vi.fn();
  const onRendererRelocate = vi.fn();
  const { unmount } = renderHook(() =>
    useFoliateEvents(view, { onStabilized, onRendererRelocate }),
  );
  renderer.dispatchEvent(new Event('stabilized'));
  renderer.dispatchEvent(new Event('relocate'));

  Object.assign(view, { renderer: null });
  unmount();
  renderer.dispatchEvent(new Event('stabilized'));
  renderer.dispatchEvent(new Event('relocate'));
  expect(onStabilized).toHaveBeenCalledOnce();
  expect(onRendererRelocate).toHaveBeenCalledOnce();
});
