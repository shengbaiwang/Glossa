import * as CFI from 'foliate-js/epubcfi.js';
import type { FoliateView } from '@/types/view';
import { checkAborted } from '../context/text';

type NavigationView = Pick<FoliateView, 'goTo' | 'lastLocation'>;

const navigationQueues = new WeakMap<NavigationView, Promise<void>>();

const isTargetVisible = (location: string, visibleLocation?: string): boolean => {
  if (!visibleLocation || !CFI.isCFI.test(location) || !CFI.isCFI.test(visibleLocation))
    return false;
  try {
    const targetStart = CFI.collapse(location);
    return (
      CFI.compare(targetStart, CFI.collapse(visibleLocation)) >= 0 &&
      CFI.compare(targetStart, CFI.collapse(visibleLocation, true)) <= 0
    );
  } catch {
    return false;
  }
};

/** Keep an uncancellable renderer jump ahead of any newer source or return jump. */
export const navigateGuideSource = (
  view: NavigationView,
  location: string,
  signal: AbortSignal,
): Promise<void> => {
  const navigation = (navigationQueues.get(view) ?? Promise.resolve()).then(async () => {
    checkAborted(signal);
    // Foliate's public type says void, but its implementation returns a promise.
    await view.goTo(location);
    checkAborted(signal);
    // Lightweight test views may omit location reporting. Real views must confirm arrival,
    // because the renderer can silently ignore a jump or swallow a loading error.
    if ('lastLocation' in view && !isTargetVisible(location, view.lastLocation?.cfi))
      throw new Error('The reading position was not reached.');
  });

  // A failed or cancelled jump must not poison later navigation on this view.
  const settled = navigation.then(
    () => undefined,
    () => undefined,
  );
  navigationQueues.set(view, settled);
  void settled.then(() => {
    if (navigationQueues.get(view) === settled) navigationQueues.delete(view);
  });
  return navigation;
};
