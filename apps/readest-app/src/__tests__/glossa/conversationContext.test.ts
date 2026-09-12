import * as CFI from 'foliate-js/epubcfi.js';
import { describe, expect, it } from 'vitest';
import type { BookDoc } from '@/libs/document';
import { collectRangeBlocks } from '@/glossa/context/text';
import { resolveSource } from '@/glossa/citations/sources';

function fixture() {
  const doc = new DOMParser().parseFromString(
    '<html><head></head><body><p>Before. Selected words. UNREAD_END</p><p hidden>HIDDEN_SECRET</p><p>FUTURE_PARAGRAPH</p></body></html>',
    'text/html',
  );
  const range = doc.createRange();
  range.setStart(doc.querySelector('p')!.firstChild!, 8);
  range.setEnd(doc.querySelector('p')!.firstChild!, 22);
  const cfi = CFI.joinIndir(CFI.fake.fromIndex(0), CFI.fromRange(range));
  const book = {
    sections: [{ createDocument: async () => doc }],
    resolveCFI: (value: string) => {
      const parts = CFI.parse(value);
      (parts.parent ?? parts).shift();
      return { index: 0, anchor: (document: Document) => CFI.toRange(document, parts) };
    },
  } as unknown as BookDoc;
  const source = {
    sourceId: 'chat-legacy',
    text: 'Selected words',
    kind: 'paragraph' as const,
    anchor: { sectionIndex: 0, cfi, quote: { exact: 'Selected words', prefix: '', suffix: '' } },
  };
  return { doc, range, cfi, book, source };
}
describe('local partial source compatibility', () => {
  it('clips partial paragraphs exactly and does not include hidden or later text', async () => {
    const { doc, range } = fixture();
    expect(collectRangeBlocks(doc, range).map((b) => b.text)).toEqual(['Selected words']);
  });
  it('can verify and jump to a partial-text source', async () => {
    const { book, source } = fixture();
    expect(await resolveSource(book, source!)).toMatchObject({
      text: 'Selected words',
      recovered: false,
    });
  });
  it('recovers a unique partial quotation if the CFI no longer matches, and rejects ambiguity', async () => {
    const { book, doc, source } = fixture();
    source!.anchor.cfi = 'invalid';
    expect(await resolveSource(book, source!)).toMatchObject({
      text: 'Selected words',
      recovered: true,
    });
    const duplicate = doc.createElement('p');
    duplicate.textContent = 'Selected words';
    doc.body.append(duplicate);
    // One full matching block plus a partial match must not be guessed when structural evidence is lost.
    expect(await resolveSource(book, source!)).toBeNull();
  });
});
