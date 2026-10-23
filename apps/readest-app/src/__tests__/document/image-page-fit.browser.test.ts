import { afterEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import 'foliate-js/paginator.js';
import 'foliate-js/view.js';
import { strToU8, zipSync } from 'fflate';
import { DocumentLoader, type BookDoc } from '@/libs/document';
import type { FoliateView, Renderer } from '@/types/view';
import type { ViewSettings } from '@/types/book';
import { applyImageStyle, getStyles } from '@/utils/style';
import {
  DEFAULT_BOOK_FONT,
  DEFAULT_BOOK_LAYOUT,
  DEFAULT_BOOK_STYLE,
  DEFAULT_BOOK_LANGUAGE,
  DEFAULT_VIEW_CONFIG,
  DEFAULT_TTS_CONFIG,
  DEFAULT_TRANSLATOR_CONFIG,
  DEFAULT_ANNOTATOR_CONFIG,
  DEFAULT_SCREEN_CONFIG,
} from '@/services/constants';

let renderer: Renderer | undefined;
let sourceURL: string | undefined;
let view: FoliateView | undefined;
let loadedBook: BookDoc | undefined;

afterEach(() => {
  renderer?.destroy();
  renderer?.remove();
  renderer = undefined;
  if (sourceURL) URL.revokeObjectURL(sourceURL);
  sourceURL = undefined;
  view?.close();
  view?.remove();
  view = undefined;
  loadedBook?.destroy?.();
  loadedBook = undefined;
});

const settings = {
  ...DEFAULT_BOOK_FONT,
  ...DEFAULT_BOOK_LAYOUT,
  ...DEFAULT_BOOK_STYLE,
  ...DEFAULT_BOOK_LANGUAGE,
  ...DEFAULT_VIEW_CONFIG,
  ...DEFAULT_TTS_CONFIG,
  ...DEFAULT_TRANSLATOR_CONFIG,
  ...DEFAULT_ANNOTATOR_CONFIG,
  ...DEFAULT_SCREEN_CONFIG,
} as ViewSettings;

function imageURL() {
  const canvas = document.createElement('canvas');
  canvas.width = 360;
  canvas.height = 540;
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#557d88';
  context.fillRect(0, 0, 360, 540);
  context.fillStyle = '#ffffff';
  context.beginPath();
  context.arc(180, 270, 90, 0, Math.PI * 2);
  context.fill();
  return canvas.toDataURL();
}

async function mount(markup: string, flow: string) {
  const data = `<!doctype html><html><head><style>body {text-align:center;margin:0}</style></head><body>${markup}</body></html>`;
  sourceURL = URL.createObjectURL(new Blob([data], { type: 'text/html' }));
  const book = {
    sections: [{ id: 'cover', load: async () => sourceURL!, size: data.length }],
  } as unknown as BookDoc;
  renderer = document.createElement('foliate-paginator') as Renderer;
  renderer.style.cssText = 'display:block;width:1200px;height:700px';
  renderer.setAttribute('flow', flow);
  renderer.addEventListener('load', ((event: CustomEvent<{ doc: Document }>) => {
    applyImageStyle(event.detail.doc);
  }) as EventListener);
  document.body.append(renderer);
  renderer.open(book);
  renderer.setStyles?.(getStyles(settings));
  await renderer.goTo({ index: 0 });
  await expect.poll(() => renderer!.getContents().length).toBe(1);
  return renderer.getContents()[0]!.doc;
}

function checkFit(doc: Document, width: number, height: number) {
  const image = doc.querySelector<SVGSVGElement | HTMLImageElement>('svg, img')!;
  const rect = image.getBoundingClientRect();
  expect(rect.width).toBeGreaterThan(100);
  expect(rect.height).toBeGreaterThan(100);
  expect(rect.width / rect.height).toBeCloseTo(2 / 3, 2);
  expect(rect.width).toBeLessThanOrEqual(width + 1);
  expect(rect.height).toBeLessThanOrEqual(height + 1);
  if (image.localName === 'svg') {
    const matrix = doc.querySelector('image')!.getScreenCTM()!;
    expect(matrix.a).toBeCloseTo(matrix.d, 4);
  }
}

describe('image pages fit the reading area', () => {
  it('binds viewport-unit image attributes to the reading page in long documents', async () => {
    const doc = await mount(
      `<p>Illustration <img src="${imageURL()}" width="50vw" height="50vh"/></p>${'<p>Original layout text.</p>'.repeat(80)}`,
      'scrolled',
    );
    const img = doc.querySelector('img')!;
    const matchesPage = () => {
      const height = Number(doc.documentElement.style.getPropertyValue('--available-height'));
      return Math.abs(img.getBoundingClientRect().height - height / 2) < 1;
    };
    await expect.poll(matchesPage).toBe(true);
    renderer!.style.height = '450px';
    await expect.poll(() => img.getBoundingClientRect().height).toBeLessThan(225);
    await expect.poll(matchesPage).toBe(true);
    expect(img.classList.contains('glossa-image-page')).toBe(false);
  });

  for (const kind of ['svg', 'percent-img', 'fixed-img']) {
    it(`${kind} preserves proportions across resize and flow changes`, async () => {
      await page.viewport(1500, 1000);
      const src = imageURL();
      const markup =
        kind === 'svg'
          ? `<div><svg width="100%" height="100%" viewBox="0 0 360 540" preserveAspectRatio="none"><image width="360" height="540" href="${src}"/></svg></div>`
          : `<div><img src="${src}" ${kind === 'percent-img' ? 'width="100%" height="100%"' : 'width="360" height="540"'}/></div>`;
      const doc = await mount(markup, 'scrolled');
      checkFit(doc, 1200, 700);
      for (const flow of ['paginated', 'scrolled']) {
        renderer!.setAttribute('flow', flow);
        for (const [width, height] of [
          [460, 780],
          [1100, 500],
        ]) {
          renderer!.style.width = `${width}px`;
          renderer!.style.height = `${height}px`;
          await expect
            .poll(() => {
              const rect = doc.querySelector('svg, img')!.getBoundingClientRect();
              return rect.width <= width! + 1 && rect.height <= height! + 1;
            })
            .toBe(true);
          checkFit(doc, width!, height!);
        }
      }
      renderer!.setAttribute('flow', 'scrolled');
      await expect
        .poll(() => {
          const image = doc.querySelector('svg, img')!.getBoundingClientRect();
          const body = doc.body.getBoundingClientRect();
          return Math.abs(image.left + image.width / 2 - (body.left + body.width / 2));
        })
        .toBeLessThan(1);
    });
  }
});

const archiveBytes = (entries: Record<string, Uint8Array>) =>
  new Uint8Array(zipSync(entries)).buffer;

function epub(src: string, fixed = false) {
  const artwork = fixed
    ? `<img src="${src}" width="100%" height="100%"/>`
    : `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 360 540" preserveAspectRatio="none"><image width="360" height="540" href="${src}"/></svg>`;
  const page = `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Original cover fixture</title>${fixed ? '<meta name="viewport" content="width=360,height=540"/>' : ''}</head><body style="margin:0">${artwork}</body></html>`;
  return new File(
    [
      archiveBytes({
        mimetype: strToU8('application/epub+zip'),
        'META-INF/container.xml': strToU8(
          '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
        ),
        'book.opf': strToU8(
          `<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">original-image-page</dc:identifier><dc:title>Original cover fixture</dc:title><dc:language>en</dc:language>${fixed ? '<meta property="rendition:layout">pre-paginated</meta>' : ''}</metadata><manifest><item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="cover"/></spine></package>`,
        ),
        'cover.xhtml': strToU8(page),
      }),
    ],
    'original.epub',
    { type: 'application/epub+zip' },
  );
}

function fb2(src: string) {
  return `<?xml version="1.0"?><FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink"><description><title-info><book-title>Original image page</book-title><lang>en</lang></title-info></description><body><section><image l:href="#cover"/></section></body><binary id="cover" content-type="image/png">${src.split(',')[1]}</binary></FictionBook>`;
}

describe('real format loaders', () => {
  for (const format of ['EPUB', 'FB2', 'FBZ', 'MD', 'CBZ', 'fixed EPUB']) {
    it(`${format} keeps an original image page proportional`, async () => {
      const src = imageURL();
      const file =
        format === 'EPUB' || format === 'fixed EPUB'
          ? epub(src, format === 'fixed EPUB')
          : format === 'FB2'
            ? new File([fb2(src)], 'original.fb2')
            : format === 'FBZ'
              ? new File([archiveBytes({ 'original.fb2': strToU8(fb2(src)) })], 'original.fbz')
              : format === 'MD'
                ? new File([`![Original cover](${src})`], 'original.md', { type: 'text/markdown' })
                : new File(
                    [
                      archiveBytes({
                        'cover.png': Uint8Array.from(atob(src.split(',')[1]!), (char) =>
                          char.charCodeAt(0),
                        ),
                      }),
                    ],
                    'original.cbz',
                  );
      loadedBook = (await new DocumentLoader(file).open()).book;
      const fixed = loadedBook.rendition?.layout === 'pre-paginated';
      view = document.createElement('foliate-view') as FoliateView;
      view.style.cssText = 'display:block;width:900px;height:600px';
      view.addEventListener('load', ((event: CustomEvent<{ doc: Document }>) => {
        applyImageStyle(event.detail.doc, fixed);
      }) as EventListener);
      document.body.append(view);
      await view.open(loadedBook);
      view.renderer.setAttribute('flow', 'scrolled');
      view.renderer.setAttribute('spread', 'none');
      view.renderer.setAttribute('zoom', 'fit-page');
      if (!fixed) view.renderer.setStyles?.(getStyles(settings));
      await view.goTo(0);
      await expect.poll(() => view!.renderer.getContents().length).toBeGreaterThan(0);
      const doc = view.renderer.getContents()[0]!.doc;
      if (!fixed) checkFit(doc, 900, 600);
      else {
        expect(doc.querySelector('.glossa-image-page')).toBeNull();
        const artwork = doc.querySelector('img')!.getBoundingClientRect();
        expect(artwork.width / artwork.height).toBeCloseTo(2 / 3, 2);
        const frame = view.renderer.shadowRoot!.querySelector('iframe')!;
        const rect = frame.getBoundingClientRect();
        expect(rect.width / rect.height).toBeCloseTo(2 / 3, 2);
        expect(rect.height).toBeLessThanOrEqual(600 + 1);
      }
    });
  }
});
