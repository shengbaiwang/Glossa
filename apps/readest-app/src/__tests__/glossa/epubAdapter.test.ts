import { describe, expect, test } from 'vitest';

import { createEpubDocumentAdapter, parseSourceAnchor } from '@/glossa';
import type { EpubRuntime } from '@/glossa/context/epub';

const chapter = `
  <section id="chapter-1">
    <h1>The Aster Index / 星标索引</h1>
    <p id="c1-p1">The Aster Index records every amber mark before the reader turns the page.</p>
    <p id="c1-p2" lang="zh">星标索引在读者翻页前记录每一个琥珀色标记。</p>
    <p id="c1-p3">Its first rule is stable: an amber mark points to a passage, not to an answer.</p>
  </section>`;

const makeDocument = () => {
  const doc = document.implementation.createHTMLDocument('fixture chapter');
  doc.body.innerHTML = chapter;
  return doc;
};

const selectText = (doc: Document, elementId: string, start: number, end: number): Range => {
  const node = doc.getElementById(elementId)?.firstChild;
  if (!node) throw new Error(`Missing fixture text node: ${elementId}`);
  const range = doc.createRange();
  range.setStart(node, start);
  range.setEnd(node, end);
  Object.defineProperty(doc, 'getSelection', {
    configurable: true,
    value: () => ({ rangeCount: 1, getRangeAt: () => range }),
  });
  return range;
};

const makeRuntime = (
  doc: Document,
  options: { cfiFails?: boolean; index?: number; href?: string } = {},
): EpubRuntime => {
  const visibleRange = doc.createRange();
  visibleRange.selectNodeContents(doc.body);
  const index = options.index ?? 0;
  return {
    view: {
      renderer: { getContents: () => [{ doc, index }] },
      getCFI: (sectionIndex, range) => {
        if (options.cfiFails) throw new Error('CFI unavailable during reflow');
        return `epubcfi(/6/${sectionIndex + 2}!/${range.toString().length})`;
      },
      lastLocation: {
        cfi: 'epubcfi(/6/2!/4/1:0)',
        range: visibleRange,
        section: { current: index, total: 3 },
        location: { current: 2, total: 9 },
        fraction: 0.25,
      },
    },
    progress: {
      location: 'epubcfi(/6/2!/4/1:0)',
      sectionHref: options.href ?? 'chapter-1.xhtml',
      section: { current: index, total: 3 },
      pageinfo: { current: 2, total: 9 },
      fraction: 0.25,
      index,
    },
  };
};

describe('EpubDocumentAdapter', () => {
  test('creates selection TextQuote and CFI anchors from the loaded document', async () => {
    const doc = makeDocument();
    const source = 'The Aster Index records every amber mark before the reader turns the page.';
    selectText(doc, 'c1-p1', 4, 37);
    const adapter = createEpubDocumentAdapter({
      documentId: 'fixture-book',
      getRuntime: () => makeRuntime(doc),
    });

    const result = await adapter.getSelection();
    expect(result).toMatchObject({
      text: source.slice(4, 37),
      anchor: {
        version: 1,
        documentId: 'fixture-book',
        format: 'epub',
        sectionId: 'chapter-1.xhtml',
        cfi: 'epubcfi(/6/2!/33)',
        quote: { exact: source.slice(4, 37) },
      },
    });
    expect(result?.anchor.quote.prefix).toMatch(/The $/u);
    expect(result?.anchor.quote.suffix).toBe(
      'ark before the reader turns the page.\n    星标索引在读',
    );
    expect(Array.from(result?.anchor.quote.prefix ?? '').length).toBeLessThanOrEqual(48);
    expect(Array.from(result?.anchor.quote.suffix ?? '').length).toBeLessThanOrEqual(48);
  });

  test('anchors visible text and selected context in document order with one documentId', async () => {
    const doc = makeDocument();
    const source = '星标索引在读者翻页前记录每一个琥珀色标记。';
    selectText(doc, 'c1-p2', 0, source.length);
    const adapter = createEpubDocumentAdapter({
      documentId: 'fixture-book',
      getRuntime: () => makeRuntime(doc),
    });

    const visible = await adapter.getVisibleText();
    const context = await adapter.getSelectionContext({ adjacentParagraphs: 1 });
    expect(visible.map((segment) => segment.text)).toEqual([
      'The Aster Index / 星标索引',
      'The Aster Index records every amber mark before the reader turns the page.',
      source,
      'Its first rule is stable: an amber mark points to a passage, not to an answer.',
    ]);
    expect(context.map((segment) => segment.text)).toEqual([
      'The Aster Index records every amber mark before the reader turns the page.',
      source,
      'Its first rule is stable: an amber mark points to a passage, not to an answer.',
    ]);
    for (const segment of [...visible, ...context]) {
      expect(segment.anchor.documentId).toBe('fixture-book');
      expect(segment.anchor.quote.exact).toBe(segment.text);
      expect(segment.anchor.sectionId || segment.anchor.cfi).toBeTruthy();
      expect(parseSourceAnchor(segment.anchor)).toEqual(segment.anchor);
    }
    expect(JSON.parse(JSON.stringify({ visible, context }))).toEqual({ visible, context });
    expect(JSON.stringify({ visible, context })).not.toContain('startContainer');
  });

  test('falls back to the spine section id when CFI cannot be created', async () => {
    const doc = makeDocument();
    selectText(doc, 'c1-p1', 0, 3);
    const adapter = createEpubDocumentAdapter({
      documentId: 'fixture-book',
      getRuntime: () => makeRuntime(doc, { cfiFails: true, href: '' }),
    });

    const result = await adapter.getSelection();
    expect(result?.anchor).toMatchObject({ sectionId: 'spine:0', quote: { exact: 'The' } });
    expect(result?.anchor.cfi).toBeUndefined();
  });

  test('safely handles an uninitialized reader and reads the latest runtime each time', async () => {
    let runtime: EpubRuntime | null = null;
    const adapter = createEpubDocumentAdapter({
      documentId: 'fixture-book',
      getRuntime: () => runtime,
    });

    expect(await adapter.getSelection()).toBeNull();
    expect(await adapter.getCurrentLocation()).toBeNull();
    expect(await adapter.getVisibleText()).toEqual([]);
    expect(await adapter.getSelectionContext()).toEqual([]);

    const doc = makeDocument();
    selectText(doc, 'c1-p3', 0, 3);
    runtime = makeRuntime(doc);
    expect((await adapter.getSelection())?.text).toBe('Its');
    expect((await adapter.getCurrentLocation())?.documentId).toBe('fixture-book');
  });

  test('cleans a semantic chapter structure and snapshots only text before the selection', async () => {
    const doc = document.implementation.createHTMLDocument('structured chapter');
    doc.body.innerHTML = `
      <h1>标题 / Heading</h1><nav>skip navigation</nav><p>第一段  with   spaces</p>
      <ul><li>列表 <em>项目</em> <p>nested duplicate</p></li></ul>
      <blockquote>引用文本</blockquote><pre>const x = 1;\n  keep newline</pre>
      <table><tr><th>字段</th><td>值</td></tr></table><figure><figcaption>图注</figcaption></figure>
      <p hidden>hidden</p><p style="display:none">display none</p><p aria-hidden="true">aria hidden</p>
      <p id="selected">前文 中文 Unicode — selection 后文不得进入</p><p>下一章节外的后文</p>`;
    const selectedText = doc.getElementById('selected')!.textContent!;
    const selectionStart = selectedText.indexOf('selection');
    selectText(doc, 'selected', selectionStart, selectionStart + 'selection'.length);
    const adapter = createEpubDocumentAdapter({
      documentId: 'fixture-book',
      getRuntime: () => makeRuntime(doc),
    });

    const section = await adapter.getCurrentSectionText();
    expect(section?.blocks.map(({ kind, text }) => [kind, text])).toEqual([
      ['heading', '标题 / Heading'],
      ['paragraph', '第一段 with spaces'],
      ['list-item', '列表 项目 nested duplicate'],
      ['quote', '引用文本'],
      ['code', 'const x = 1;\n  keep newline'],
      ['table', '字段'],
      ['table', '值'],
      ['caption', '图注'],
      ['paragraph', selectedText],
      ['paragraph', '下一章节外的后文'],
    ]);
    expect(section?.blocks.map((block) => block.order)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    for (const block of section?.blocks ?? []) {
      expect(parseSourceAnchor(block.anchor)).toEqual(block.anchor);
    }

    const bounded = await adapter.getSelectionChapterContext();
    expect(bounded?.section.blocks.map((block) => block.text)).toEqual([
      '标题 / Heading',
      '第一段 with spaces',
      '列表 项目 nested duplicate',
      '引用文本',
      'const x = 1;\n  keep newline',
      '字段',
      '值',
      '图注',
      '前文 中文 Unicode —',
    ]);
    expect(JSON.stringify(bounded)).not.toContain('selection 后文不得进入');
    expect(JSON.stringify(bounded)).not.toContain('下一章节外的后文');
  });
});
