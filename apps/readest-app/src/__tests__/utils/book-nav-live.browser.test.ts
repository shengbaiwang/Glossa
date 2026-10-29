import { zipSync, strToU8 } from 'fflate';
import { expect, it } from 'vitest';
import { DocumentLoader, type BookDoc } from '@/libs/document';
import { computeBookNav, hydrateBookNav } from '@/services/nav';
import type { FoliateView } from '@/types/view';
import 'foliate-js/view.js';

const fixture = () => {
  const xhtml = (body: string) =>
    `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Original river observations</title></head><body>${body}</body></html>`;
  const entries: Record<string, Uint8Array> = {
    mimetype: strToU8('application/epub+zip'),
    'META-INF/container.xml': strToU8(
      '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    ),
    'book.opf': strToU8(
      '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">original-live-navigation</dc:identifier><dc:title>River observations</dc:title><dc:language>en</dc:language></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="a" href="a.xhtml" media-type="application/xhtml+xml"/><item id="b" href="b.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="a"/><itemref idref="b"/></spine></package>',
    ),
    'nav.xhtml': strToU8(
      xhtml(
        '<nav epub:type="toc"><ol><li><a href="a.xhtml#start">First reach</a></li><li><a href="b.xhtml#start">Second reach</a></li></ol></nav>',
      ),
    ),
  };
  for (const name of ['a', 'b'])
    entries[`${name}.xhtml`] = strToU8(
      xhtml(
        `<h1 id="start">Reach ${name}</h1>` +
          '<p>An original river observation records its location, measured level, and uncertainty.</p>'.repeat(
            80,
          ),
      ),
    );
  return new File([new Uint8Array(zipSync(entries))], 'original-live-navigation.epub', {
    type: 'application/epub+zip',
  });
};
const paint = () =>
  new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );

it.each([
  'paginated',
  'scrolled',
])('publishes background navigation in %s flow without moving the reader', async (flow) => {
  let book: BookDoc | undefined;
  const view = document.createElement('foliate-view') as FoliateView;
  view.style.cssText = 'display:block;width:800px;height:650px';
  document.body.append(view);
  try {
    book = (await new DocumentLoader(fixture()).open()).book;
    const completeToc = structuredClone(book.toc!);
    book.toc = book.toc!.slice(0, 1);
    await view.open(book);
    view.renderer.setAttribute('flow', flow);
    await view.goTo(1);
    await view.renderer.goTo({ index: 1, anchor: 0.4 });
    await paint();
    const renderer = view.renderer;
    const documents = renderer.getContents().map(({ doc }) => doc);
    const cfi = view.lastLocation?.cfi;
    const scroll = renderer.containerPosition;
    const sections = book.sections;
    const navFields = JSON.stringify(
      sections.map(({ fragments, location }) => ({ fragments, location })),
    );
    expect(cfi).toBeTruthy();
    expect(scroll).toBeGreaterThan(10);
    expect(view.lastLocation?.tocItem?.label).toBe('First reach');
    const nav = await computeBookNav(
      { ...book, toc: completeToc, splitTOCHref: book.splitTOCHref.bind(book) },
      { background: true },
    );
    expect(book.sections).toBe(sections);
    expect(
      JSON.stringify(sections.map(({ fragments, location }) => ({ fragments, location }))),
    ).toBe(navFields);
    const staged = {
      ...book,
      sections: sections.map((section) => ({ ...section })),
      splitTOCHref: book.splitTOCHref.bind(book),
    };
    hydrateBookNav(staged, nav);
    book.toc = staged.toc;
    book.sections.forEach((section, index) => {
      section.fragments = staged.sections[index]?.fragments;
      section.location = staged.sections[index]?.location;
    });
    let publishedDuringRelocate = false;
    view.addEventListener(
      'relocate',
      () => {
        publishedDuringRelocate = book!.sections.every(
          (section, index) =>
            section.fragments === staged.sections[index]?.fragments &&
            section.location === staged.sections[index]?.location,
        );
      },
      { once: true },
    );
    await view.updateTOC!(staged.toc!);
    expect(publishedDuringRelocate).toBe(true);
    expect(view.lastLocation?.tocItem?.label).toBe('Second reach');
    expect(view.renderer).toBe(renderer);
    expect(view.lastLocation?.cfi).toBe(cfi);
    expect(renderer.containerPosition).toBe(scroll);
    expect(renderer.getContents().map(({ doc }) => doc)).toEqual(documents);
  } finally {
    view.close();
    view.remove();
    await book?.destroy?.();
  }
});
