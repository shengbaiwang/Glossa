import type { FoliateView } from '@/types/view';
import { getChapterIndex, locatorForCFI } from '@/services/nav/lookup';

export const goToAdjacentSection = async (
  view: FoliateView | null,
  cfi: string | undefined,
  dir: 1 | -1,
): Promise<void> => {
  if (!view) return;
  const index = getChapterIndex(view.book);
  const location = view.lastLocation;
  const current =
    (location?.chapterId && index.node(location.chapterId)) ||
    index.byItem(location?.tocItem) ||
    index.locate(locatorForCFI(view.book, location?.cfi ?? cfi)).node;
  const target = current ? index.adjacent(current.id, dir) : null;
  if (target) {
    if (view.navigate) await view.navigate(target.item.href, { nodeId: target.id });
    else await view.goTo(target.item.href);
  } else if (!index.usable || !current) {
    await (view.stepResource
      ? view.stepResource(dir)
      : dir === -1
        ? view.renderer.prevSection?.()
        : view.renderer.nextSection?.());
  }
};
