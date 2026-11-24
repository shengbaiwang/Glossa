import { afterEach, describe, expect, it } from 'vitest';
import { commands, page } from 'vitest/browser';
import { DocumentLoader, CFI } from '@/libs/document';
import type { BookDoc } from '@/libs/document';
import type { FoliateView } from '@/types/view';
import { DEFAULT_BOOK_SEARCH_CONFIG } from '@/services/constants';
import type { BookNote, BookSearchResult } from '@/types/book';
import { getTextFromRange } from '@/utils/sel';
import {
  createBookmark,
  extractBookmarkExcerpt,
  findBookmarksAtLocation,
} from '@/app/reader/utils/bookmark';
import { findParentPath, findTocItemBS } from '@/services/nav/lookup';
import { filterBooknotes, summarizeAnnotations } from '@/app/reader/utils/annotatorUtil';
import { Overlayer } from 'foliate-js/overlayer.js';
import 'foliate-js/view.js';

let view: FoliateView | null = null;
let book: BookDoc | null = null;
const open = async (scrolled = false) => {
  const bytes = await fetch(
    new URL('../fixtures/data/glossa-reading-sample.pdf', import.meta.url),
  ).then((r) => r.arrayBuffer());
  book = (
    await new DocumentLoader(new File([bytes], 'original.pdf', { type: 'application/pdf' })).open()
  ).book;
  view = document.createElement('foliate-view') as FoliateView;
  view.style.cssText = 'display:block;width:600px;height:400px';
  document.body.append(view);
  view.addEventListener('draw-annotation', ((event: CustomEvent) => {
    event.detail.draw(Overlayer.highlight, { color: '#d6c9a8' });
  }) as EventListener);
  await view.open(book);
  view.renderer.setAttribute('spread', 'none');
  view.renderer.setAttribute('zoom', 'fit-width');
  if (scrolled) view.renderer.setAttribute('flow', 'scrolled');
  await view.goTo(0);
  return view;
};
afterEach(async () => {
  view?.close();
  view?.remove();
  await book?.destroy?.();
  view = null;
  book = null;
});

describe('original PDF with the real text and annotation layers', () => {
  it('pairs original pages, clips their inner edges and rotates the whole atlas spread', async () => {
    const v = await open();
    const renderer = v.renderer;
    renderer.setAttribute('atlas-trim', '5%');
    renderer.setAttribute('spread', 'atlas');
    await v.goTo(1);
    const visible = () => renderer.getContents().filter((c) => c.doc?.defaultView?.frameElement);
    const rects = () =>
      visible().map((c) => c.doc.defaultView!.frameElement!.getBoundingClientRect());
    await expect.poll(() => visible().map((c) => c.index)).toEqual([0, 1]);
    const [left, right] = rects();
    expect(left!.right - right!.left).toBeCloseTo((left!.width + right!.width) * 0.05, 0);
    renderer.setAttribute('atlas-rotation', '90');
    const [upper, lower] = rects();
    expect(upper!.top).toBeLessThan(lower!.top);
    expect(upper!.left).toBeCloseTo(lower!.left, 0);
    renderer.setAttribute('atlas-rotation', '270');
    const [bottom, top] = rects();
    expect(bottom!.top).toBeGreaterThan(top!.top);
    renderer.setAttribute('atlas-rotation', '0');
    renderer.setAttribute('atlas-trim', '12px');
    renderer.setZoom!('original-size', 100);
    const [a, b] = rects();
    expect(a!.right - b!.left).toBeCloseTo(24, 0);
    renderer.setAttribute('atlas-trim', '0px');
    const [c, d] = rects();
    expect(c!.right).toBeCloseTo(d!.left, 1);
    renderer.setAttribute('spread', 'atlas-cover');
    renderer.setAttribute('spread', 'atlas');
    renderer.setAttribute('spread', 'atlas-cover');
    await expect.poll(() => visible().map((c) => c.index)).toEqual([1, 2]);
    await v.goTo(0);
    expect(visible().map((c) => c.index)).toEqual([0]);
  });

  for (const scrolled of [false, true]) {
    it(`follows a PDF link from a real pointer click (${scrolled ? 'scroll' : 'pages'})`, async () => {
      const v = await open(scrolled);
      const doc = v.renderer.getContents().find((item) => item.index === 0)!.doc;
      const clickLink = async (end: boolean) => {
        const current = v.renderer.getContents().find((item) => item.index === 0)!.doc;
        const rect = current
          .querySelector<HTMLAnchorElement>('.annotationLayer a')!
          .getBoundingClientRect();
        const iframe = current.defaultView!.frameElement!.getBoundingClientRect();
        const scale = iframe.width / current.documentElement.clientWidth;
        const y = rect.top + rect.height / 2;
        const x = end ? rect.right - 2 : rect.left + 4;
        expect(current.elementFromPoint(x, y)?.closest('.annotationLayer a')).toBeTruthy();
        await commands.clickPDFText({ x: iframe.left + x * scale, y: iframe.top + y * scale });
        await expect.poll(() => v.lastLocation!.tocItem?.label).toBe('Chapter two: notes');
      };
      // Trigger the same transient hit testing state as a scroll/trackpad tick.
      if (scrolled) v.renderer.dispatchEvent(new Event('scroll'));
      expect(getComputedStyle(doc.defaultView!.frameElement!).pointerEvents).toBe('auto');
      await clickLink(false);
      await v.goTo(0);
      await clickLink(true);
    });
  }

  it('loads the embedded PDF note icon from the bundled viewer assets', async () => {
    const v = await open();
    await v.goTo(2);
    await expect
      .poll(() => {
        const doc = v.renderer.getContents().find((c) => c.index === 2)?.doc;
        return doc?.querySelector<HTMLImageElement>('.textAnnotation img')?.naturalWidth ?? 0;
      })
      .toBeGreaterThan(0);
  });

  it('retains a distant scroll destination while the page cache is full', async () => {
    const bytes = await fetch(new URL('../fixtures/data/sample-alice.pdf', import.meta.url)).then(
      (response) => response.arrayBuffer(),
    );
    book = (await new DocumentLoader(new File([bytes], 'alice.pdf')).open()).book;
    view = document.createElement('foliate-view') as FoliateView;
    view.style.cssText = 'display:block;width:600px;height:500px';
    document.body.append(view);
    await view.open(book);
    view.renderer.setAttribute('flow', 'scrolled');
    view.renderer.setAttribute('zoom', 'fit-width');
    for (let index = 0; index < 15; index++) {
      expect((await view.navigate!(index)).status).toBe('arrived');
    }
    const destination = book.sections.length - 2;
    expect(destination).toBeGreaterThan(25);
    expect(view.renderer.getContents().some((content) => content.index === destination)).toBe(
      false,
    );
    expect((await view.navigate!(destination)).status).toBe('arrived');
    expect(view.renderer.index).toBe(destination);
  }, 30000);

  it('navigates nested chapters and both directions of an embedded note link', async () => {
    const v = await open();
    const detail = book!.toc![0]!.subitems![0]!;
    await v.goTo(detail.href);
    expect(v.lastLocation!.tocItem!.label).toBe(detail.label);
    expect(findParentPath(book!.toc!, detail.href).map((item) => item.label)).toEqual([
      'Chapter one',
      'Chapter one: details',
    ]);
    await v.goTo(0);
    const origin = v.lastLocation!.cfi!;
    let doc = v.renderer.getContents().find((item) => item.index === 0)!.doc;
    doc.querySelector<HTMLAnchorElement>('.annotationLayer a')!.click();
    await expect.poll(() => v.lastLocation!.tocItem?.label).toBe('Chapter two: notes');
    v.history.back();
    await expect
      .poll(() => CFI.fake.toIndex(CFI.parse(CFI.collapse(v.lastLocation!.cfi))[0]))
      .toBe(0);
    await v.goTo(2);
    doc = v.renderer.getContents().find((item) => item.index === 2)!.doc;
    doc.querySelector<HTMLAnchorElement>('.annotationLayer a')!.click();
    await expect
      .poll(() => CFI.fake.toIndex(CFI.parse(CFI.collapse(v.lastLocation!.cfi))[0]))
      .toBe(0);
    await v.goTo(origin);
    expect(book!.pageList!.map((item) => item.label)).toEqual(['i', 'ii', '1', '2']);
  }, 15000);

  for (const scrolled of [false, true]) {
    it(`searches every page, copies a multiline selection and restores notes/highlights (${scrolled ? 'scroll' : 'pages'})`, async () => {
      const v = await open(scrolled);
      const results: BookSearchResult[] = [];
      for await (const result of v.search({
        ...DEFAULT_BOOK_SEARCH_CONFIG,
        query: 'Copper marker',
      })) {
        if (typeof result !== 'string' && 'subitems' in result) results.push(result);
      }
      expect(results).toHaveLength(4);
      const cfi = results[1]!.subitems[0]!.cfi;
      await v.goTo(cfi);
      expect(v.renderer.scrollTop).toBeGreaterThan(0);
      let doc = v.renderer.getContents().find((item) => item.index === 1)!.doc;
      let range = v.resolveCFI(cfi).anchor(doc);
      expect(range.toString()).toBe('Copper marker');
      const frame = doc.defaultView!.frameElement!.getBoundingClientRect();
      const host = v.renderer.getBoundingClientRect();
      const scale = frame.width / doc.documentElement.clientWidth;
      expect(frame.top + range.getBoundingClientRect().top * scale).toBeGreaterThanOrEqual(
        host.top - 1,
      );
      expect(frame.top + range.getBoundingClientRect().bottom * scale).toBeLessThan(host.bottom);
      const nextLine = Array.from(doc.querySelectorAll('.textLayer span')).find((span) =>
        span.textContent!.startsWith('A second line'),
      )!;
      range.setEnd(nextLine.firstChild!, nextLine.textContent!.length);
      doc.getSelection()!.removeAllRanges();
      doc.getSelection()!.addRange(range);
      const text = getTextFromRange(range);
      expect(text).toContain('Copper marker 2 is the searchable line.');
      expect(text).toContain('\nA second line keeps selection and copying verifiable.');
      const noteCfi = v.getCFI(1, range);
      const note: BookNote = {
        id: 'original-note',
        type: 'annotation',
        cfi: noteCfi,
        text,
        note: 'My original reading note',
        color: 'yellow',
        style: 'highlight',
        page: 2,
        createdAt: 1,
        updatedAt: 1,
      };
      const records = JSON.parse(JSON.stringify([note])) as BookNote[];
      expect(summarizeAnnotations(records)).toEqual({ highlights: 0, notes: 1 });
      expect(
        filterBooknotes(records, {
          kind: 'notes',
          query: 'original reading',
          excludedColors: [],
          excludedStyles: [],
        }),
      ).toHaveLength(1);
      expect(findTocItemBS(book!.toc!, noteCfi)?.label).toBe('Chapter one: details');
      const bookmark = createBookmark({
        cfi: v.lastLocation!.cfi!,
        text: extractBookmarkExcerpt(v.lastLocation!.range),
        page: 2,
        now: 1,
      });
      expect(bookmark.text).toContain('Copper marker');
      expect(findBookmarksAtLocation([bookmark], CFI.fake.fromIndex(1), true)).toHaveLength(1);
      v.clearSearch();
      v.addEventListener('create-overlay', (() => {
        void v.addAnnotation({ ...records[0]!, value: noteCfi });
      }) as EventListener);
      await v.addAnnotation({ ...records[0]!, value: noteCfi });
      let overlayer = v.renderer.getContents().find((item) => item.index === 1)!
        .overlayer as Overlayer;
      expect(
        overlayer.element.querySelectorAll('g[fill="#d6c9a8"] > path, g[fill="#d6c9a8"] > rect')
          .length,
      ).toBeGreaterThan(0);
      const previousOverlayer = overlayer;
      v.renderer.setAttribute('scale-factor', '125');
      await expect
        .poll(() => {
          overlayer = v.renderer.getContents().find((item) => item.index === 1)
            ?.overlayer as Overlayer;
          if (overlayer === previousOverlayer) return 0;
          return (
            overlayer?.element.querySelectorAll(
              'g[fill="#d6c9a8"] > path, g[fill="#d6c9a8"] > rect',
            ).length ?? 0
          );
        })
        .toBeGreaterThan(0);
      const resume = v.lastLocation!.cfi!;
      await v.goTo(3);
      await v.goTo(resume);
      doc = v.renderer.getContents().find((item) => item.index === 1)!.doc;
      range = v.resolveCFI(records[0]!.cfi).anchor(doc);
      expect(getTextFromRange(range)).toBe(text);
      await page.screenshot({
        element: v,
        path: `/Users/nidao./Documents/ChatGPT/Glossa/.glossa-dev/qa/pdf-${scrolled ? 'scroll' : 'pages'}.png`,
      });
      // Reparse in a new reading view, using only the saved personal records.
      v.close();
      v.remove();
      await book!.destroy?.();
      view = null;
      book = null;
      const reopened = await open(scrolled);
      reopened.addEventListener('create-overlay', (() => {
        void reopened.addAnnotation({ ...records[0]!, value: noteCfi });
      }) as EventListener);
      await reopened.goTo(resume);
      doc = reopened.renderer.getContents().find((item) => item.index === 1)!.doc;
      expect(reopened.lastLocation!.range!.toString()).toContain('Copper marker');
      expect(getTextFromRange(reopened.resolveCFI(noteCfi).anchor(doc))).toBe(text);
      expect(findBookmarksAtLocation([bookmark], reopened.lastLocation!.cfi!, true)).toHaveLength(
        1,
      );
      await expect
        .poll(
          () =>
            (
              reopened.renderer.getContents().find((item) => item.index === 1)
                ?.overlayer as Overlayer
            )?.element.querySelectorAll('g[fill="#d6c9a8"] > path, g[fill="#d6c9a8"] > rect')
              .length ?? 0,
        )
        .toBeGreaterThan(0);
    }, 20000);
  }
});
