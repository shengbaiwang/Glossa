import { FoliateView } from '@/types/view';
import { findAdjacentTocItem } from '@/services/nav/lookup';

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
  const target = findAdjacentTocItem(view.book?.toc ?? [], cfi ?? '', dir);
  if (target?.href) {
    await view.goTo(target.href);
    return;
  }
  return dir === -1 ? view.renderer.prevSection?.() : view.renderer.nextSection?.();
};
