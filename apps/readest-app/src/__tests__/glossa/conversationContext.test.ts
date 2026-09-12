import * as CFI from 'foliate-js/epubcfi.js';
import { describe, expect, it } from 'vitest';
import type { BookDoc } from '@/libs/document';
import { createConversationReader } from '@/glossa/context/conversation';
import { collectRangeBlocks } from '@/glossa/context/text';
import { resolveSource } from '@/glossa/citations/sources';
import { selectScopeEvidence } from '@/glossa/context/conversationScope';

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
  return { doc, range, cfi, book };
}
describe('conversation reading adapter', () => {
  it('clips partial paragraphs exactly and does not include hidden or later text', async () => {
    const { doc, range, book, cfi } = fixture();
    expect(collectRangeBlocks(doc, range).map((b) => b.text)).toEqual(['Selected words']);
    const sources = await createConversationReader(book, () => null).readLocation(
      cfi,
      new AbortController().signal,
    );
    expect(sources.map((s) => s.text)).toEqual(['Selected words']);
    expect(JSON.stringify(sources)).not.toContain('UNREAD_END');
    expect(JSON.stringify(sources)).not.toContain('HIDDEN_SECRET');
  });
  it('can verify and jump to a partial-text source', async () => {
    const { book, cfi } = fixture();
    const [source] = await createConversationReader(book, () => null).readLocation(
      cfi,
      new AbortController().signal,
    );
    expect(await resolveSource(book, source!)).toMatchObject({
      text: 'Selected words',
      recovered: false,
    });
  });
  it('expands to the whole paragraph only after the reader explicitly chooses paragraph scope', async () => {
    const { book, cfi } = fixture();
    const sources = await createConversationReader(book, () => null).readLocation(
      cfi,
      new AbortController().signal,
      true,
    );
    expect(sources.map((s) => s.text)).toEqual(['Before. Selected words. UNREAD_END']);
    expect(JSON.stringify(sources)).not.toContain('FUTURE_PARAGRAPH');
  });
  it('recovers a unique partial quotation if the CFI no longer matches, and rejects ambiguity', async () => {
    const { book, cfi, doc } = fixture();
    const [source] = await createConversationReader(book, () => null).readLocation(
      cfi,
      new AbortController().signal,
    );
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
  it('rejects cancelled captures and unavailable locations', async () => {
    const { book, cfi } = fixture();
    const controller = new AbortController();
    controller.abort();
    await expect(
      createConversationReader(book, () => null).readLocation(cfi, controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
    await expect(
      createConversationReader(book, () => null).readLocation('bad', new AbortController().signal),
    ).rejects.toThrow();
  });
  it('searches explicit large scopes locally, with a bounded evidence set and no whole-book upload', async () => {
    const { book, cfi } = fixture();
    const [original] = await createConversationReader(book, () => null).readLocation(
      cfi,
      new AbortController().signal,
    );
    const sources = Array.from({ length: 100 }, (_, i) => ({
      ...original!,
      sourceId: `s${i}`,
      text: `${i === 77 ? '目标术语' : '普通段落'}${'正文'.repeat(300)}`,
    }));
    const selected = selectScopeEvidence(sources, '目标术语的解释', true);
    expect(selected.some((s) => s.sourceId === 's77')).toBe(true);
    expect(selected.length).toBeLessThanOrEqual(8);
    expect(selected.reduce((n, s) => n + s.text.length, 0)).toBeLessThanOrEqual(6000);
    expect(selectScopeEvidence(sources.slice(0, 2), '', true).length).toBeLessThan(2);
  });
});
