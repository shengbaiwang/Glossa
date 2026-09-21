import { describe, expect, it, vi } from 'vitest';
import * as CFI from 'foliate-js/epubcfi.js';
import type { BookDoc } from '@/libs/document';
import { listChapters } from '@/glossa/context/chapters';
import { resolveSource } from '@/glossa/citations/sources';
import {
  captureReadingScope,
  prepareChapterPassages,
  scopeForPassage,
  type ReadingCaptureView,
} from '@/glossa/harness/epub';

const html =
  '<p>Before visible text after.</p><h2 id="next">Next chapter</h2><p>Never share this.</p>';
const documentFor = (text = html) => new DOMParser().parseFromString(text, 'text/html');
const book = (): BookDoc => ({
  metadata: { title: 'Synthetic fixture', author: 'Test', language: 'en' },
  rendition: {},
  dir: 'ltr',
  toc: [
    { id: 0, index: 0, label: 'First chapter', href: 'chapter.xhtml#first' },
    { id: 1, index: 1, label: 'Next chapter', href: 'chapter.xhtml#next' },
  ],
  sections: [
    {
      id: 'chapter.xhtml',
      cfi: CFI.fake.fromIndex(0),
      size: html.length,
      linear: 'yes',
      createDocument: async () => documentFor(),
    },
  ],
  splitTOCHref: (href) => href.split('#'),
  getCover: async () => null,
});

const viewFor = (doc = documentFor()): ReadingCaptureView => {
  const range = doc.createRange();
  const text = doc.querySelector('p')!.firstChild!;
  range.setStart(text, 7);
  range.setEnd(text, 19);
  return {
    isFixedLayout: false,
    renderer: { getContents: () => [{ doc, index: 0 }] },
    lastLocation: { range },
    getCFI: (index, selected) => CFI.joinIndir(CFI.fake.fromIndex(index), CFI.fromRange(selected)),
    resolveCFI: (cfi) => {
      const parts = CFI.parse(cfi);
      parts.parent?.shift();
      return { index: 0, anchor: (original) => CFI.toRange(original, parts) };
    },
  };
};

describe('EPUB reading scope capture', () => {
  it('captures only visible text, retains original anchors, and never includes paragraph tails', async () => {
    const bookDoc = book();
    const result = await captureReadingScope({
      bookDoc,
      view: viewFor(),
      documentHash: 'book-a',
      kind: 'page',
    });
    expect(result.sources.map((source) => source.text)).toEqual(['visible text']);
    expect(result.sources[0]!.anchor.quote).toEqual({
      exact: 'visible text',
      prefix: '',
      suffix: '',
    });
    expect(await resolveSource(bookDoc, result.sources[0]!)).toMatchObject({
      text: 'visible text',
    });
    expect(JSON.stringify(result)).not.toContain('Never share this');
  });

  it('captures an explicit selection even when it differs from the visible page range', async () => {
    const doc = documentFor();
    const range = doc.createRange();
    range.selectNodeContents(doc.querySelector('h2')!);
    vi.spyOn(doc, 'getSelection').mockReturnValue({
      isCollapsed: false,
      rangeCount: 1,
      getRangeAt: () => range,
    } as unknown as Selection);
    const result = await captureReadingScope({
      bookDoc: book(),
      view: viewFor(doc),
      documentHash: 'book-a',
      kind: 'selection',
    });
    expect(result.sources.map((source) => source.text)).toEqual(['Next chapter']);
  });

  it('fails closed on missing selection/page, fixed layout or transformed text that no longer matches', async () => {
    const view = viewFor();
    for (const invalid of [
      { ...view, lastLocation: undefined },
      { ...view, isFixedLayout: true },
      viewFor(documentFor(html.replace('visible text', 'altered text'))),
    ]) {
      await expect(
        captureReadingScope({
          bookDoc: book(),
          view: invalid,
          documentHash: 'book-a',
          kind: 'page',
        }),
      ).rejects.toThrow();
    }
    await expect(
      captureReadingScope({ bookDoc: book(), view, documentHash: 'book-a', kind: 'selection' }),
    ).rejects.toThrow();
  });

  it('honors cancellation before and during local document loading', async () => {
    const controller = new AbortController();
    const bookDoc = book();
    bookDoc.sections[0]!.createDocument = vi.fn(async () => {
      controller.abort();
      return documentFor();
    });
    await expect(
      captureReadingScope({
        bookDoc,
        view: viewFor(),
        documentHash: 'book-a',
        kind: 'page',
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    const beforeLoad = vi.fn();
    bookDoc.sections[0]!.createDocument = beforeLoad;
    await expect(
      captureReadingScope({
        bookDoc,
        view: viewFor(),
        documentHash: 'book-a',
        kind: 'page',
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(beforeLoad).not.toHaveBeenCalled();
  });

  it('prepares explicit chapter passages clipped before the next chapter and rejects forged selections', async () => {
    const bookDoc = book();
    bookDoc.sections[0]!.createDocument = async () =>
      documentFor(html.replace('<p>', '<p id="first">'));
    const chapter = listChapters(bookDoc)[0]!;
    const passages = await prepareChapterPassages({ bookDoc, chapter });
    const scope = scopeForPassage('book-a', chapter, passages[0]!);
    expect(scope.sources.map((source) => source.text)).toEqual(['Before visible text after.']);
    expect(() =>
      scopeForPassage('book-a', chapter, { ...passages[0]!, unavailable: true }),
    ).toThrow();
    await expect(
      prepareChapterPassages({ bookDoc, chapter: { ...chapter, id: 'made-up' } }),
    ).rejects.toThrow();
  });
});
