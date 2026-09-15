import { expect, it, vi } from 'vitest';
import type { FoliateView } from '@/types/view';
import type { TOCItem } from '@/libs/document';
import { goToAdjacentSection } from '@/app/reader/utils/sectionNav';

const toc: TOCItem[] = [1, 2, 3, 4].map((n) => ({
  id: n,
  index: n,
  label: `Chapter ${n}`,
  href: `book.xhtml#ch${n}`,
  cfi: `epubcfi(/6/2!/4/${n * 4})`,
}));

it('continues past the landed chapter even when the page starts before its heading', async () => {
  const location = { cfi: 'epubcfi(/6/2!/4/5:0)', tocItem: toc[0] };
  const goTo = vi.fn(async (href: string) => {
    const current = toc.find((item) => item.href === href)!;
    location.tocItem = current;
    // Pagination reports the visible page start, which precedes the heading.
    location.cfi = `epubcfi(/6/2!/4/${current.id * 4 - 1}:0)`;
  });
  const view = { book: { toc }, lastLocation: location, goTo } as unknown as FoliateView;
  await goToAdjacentSection(view, location.cfi, 1);
  await goToAdjacentSection(view, location.cfi, 1);
  await goToAdjacentSection(view, location.cfi, 1);
  expect(goTo.mock.calls.map(([href]) => href)).toEqual(toc.slice(1).map((item) => item.href));
  await goToAdjacentSection(view, location.cfi, -1);
  await goToAdjacentSection(view, location.cfi, -1);
  expect(goTo.mock.calls.slice(3).map(([href]) => href)).toEqual([toc[2]!.href, toc[1]!.href]);
});

it('uses the current renderer position when the caller has stale progress', async () => {
  const goTo = vi.fn();
  const view = {
    book: { toc },
    lastLocation: { cfi: toc[2]!.cfi },
    goTo,
  } as unknown as FoliateView;
  await goToAdjacentSection(view, toc[0]!.cfi, 1);
  expect(goTo).toHaveBeenCalledWith(toc[3]!.href);
});

it('distinguishes a nested entry from its parent sharing the same heading', async () => {
  const child = { ...toc[0]!, id: 10 };
  const parent = { ...toc[0]!, subitems: [child] };
  const goTo = vi.fn();
  const view = {
    book: { toc: [parent, toc[1]!] },
    lastLocation: { tocItem: child },
    goTo,
  } as unknown as FoliateView;
  await goToAdjacentSection(view, undefined, 1);
  expect(goTo).toHaveBeenCalledWith(toc[1]!.href);
});

it('retains CFI navigation and the spine fallback without a usable TOC', async () => {
  const goTo = vi.fn();
  const nextSection = vi.fn();
  const view = { book: { toc }, goTo, renderer: { nextSection } } as unknown as FoliateView;
  await goToAdjacentSection(view, toc[0]!.cfi, 1);
  expect(goTo).toHaveBeenCalledWith(toc[1]!.href);
  await goToAdjacentSection(view, toc[3]!.cfi, 1);
  expect(nextSection).toHaveBeenCalledOnce();
  await goToAdjacentSection(null, undefined, 1);
});
