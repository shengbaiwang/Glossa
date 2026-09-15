import { FoliateView } from '@/types/view';
import { findAdjacentTocItem } from '@/services/nav/lookup';
import { collectAllTocItems } from '@/services/nav/grouping';

// Chapter jumps navigate by TOC entry so the landing page is the target
// chapter's first page: view.goTo resolves the chapter heading and also pushes
// history (renderer.prevSection/nextSection did neither). Falls back to raw
// spine navigation for books without a usable TOC or at either end.
export const goToAdjacentSection = async (
  view: FoliateView | null,
  cfi: string | undefined,
  dir: 1 | -1,
): Promise<void> => {
  if (!view) return;
  const toc = view.book?.toc ?? [];
  const flat = collectAllTocItems(toc);
  const location = view.lastLocation;
  // A paginated page can begin before the heading we just jumped to. Use the
  // renderer's TOC progress (which considers the visible range), not just its
  // start CFI, or the next jump can keep targeting the same chapter.
  const currentIndex = location?.tocItem ? flat.indexOf(location.tocItem) : -1;
  const target =
    currentIndex >= 0
      ? flat[currentIndex + dir]
      : findAdjacentTocItem(toc, location?.cfi ?? cfi ?? '', dir);
  if (target?.href) {
    await view.goTo(target.href);
    return;
  }
  return dir === -1 ? view.renderer.prevSection?.() : view.renderer.nextSection?.();
};
