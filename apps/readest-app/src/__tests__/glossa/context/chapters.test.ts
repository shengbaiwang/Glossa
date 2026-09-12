import { describe, expect, it } from 'vitest';
import * as CFI from 'foliate-js/epubcfi.js';
import type { BookDoc, TOCItem } from '@/libs/document';
import { extractChapter, listChapters, chapterPathForHref } from '@/glossa/context/chapters';
import { resolveSource, validateSourceIds } from '@/glossa/citations/sources';

const item = (label: string, href: string, subitems?: TOCItem[]): TOCItem => ({
  id: 0,
  index: 0,
  label,
  href,
  subitems,
});

const book = (html: string[], toc?: TOCItem[]): BookDoc => ({
  metadata: { title: 'Synthetic test book', author: 'Test', language: 'zh' },
  rendition: {},
  dir: 'ltr',
  toc,
  sections: html.map((body, index) => ({
    id: `chapter${index}.xhtml`,
    cfi: CFI.fake.fromIndex(index),
    size: body.length,
    linear: 'yes',
    createDocument: async () => new DOMParser().parseFromString(body, 'text/html'),
  })),
  splitTOCHref: (href) => href.split('#'),
  getCover: async () => null,
});

describe('chapter sources', () => {
  it('respects same-file fragment boundaries, including targets inside paragraphs', async () => {
    const doc = book(
      [
        '<p>Before <span id="a">中国<span>制度</span></span>分析</p><p>证据一</p><h2 id="b">后章</h2><p>后文</p>',
      ],
      [item('A', 'chapter0.xhtml#a'), item('B', 'chapter0.xhtml#b')],
    );
    const result = await extractChapter(doc, listChapters(doc)[0]!);
    expect(result.sources.map((source) => source.text)).toEqual(['中国制度分析', '证据一']);
    expect(result.characterCount).toBe(9);
    const resolved = await resolveSource(doc, result.sources[0]!);
    expect(resolved?.text).toBe('中国制度分析');
    expect(resolved?.recovered).toBe(false);
  });

  it('includes a nested chapter introduction and all children, stops before its sibling', async () => {
    const doc = book(
      [
        '<h1 id="a">第一章</h1><p>引言</p><h2 id="one">一节</h2><p>甲</p><h2 id="two">二节</h2><p>乙</p><h1 id="b">第二章</h1><p>丙</p>',
      ],
      [
        item('第一章', 'chapter0.xhtml#a', [
          item('一节', 'chapter0.xhtml#one'),
          item('二节', 'chapter0.xhtml#two'),
        ]),
        item('第二章', 'chapter0.xhtml#b'),
      ],
    );
    const chapters = listChapters(doc);
    expect(chapters.map((chapter) => chapter.depth)).toEqual([0, 1, 1, 0]);
    expect(chapters[1]!.parentId).toBe(chapters[0]!.id);
    expect((await extractChapter(doc, chapters[0]!)).sources.map((source) => source.text)).toEqual([
      '第一章',
      '引言',
      '一节',
      '甲',
      '二节',
      '乙',
    ]);
    expect((await extractChapter(doc, chapters[1]!)).sources.map((source) => source.text)).toEqual([
      '一节',
      '甲',
    ]);
  });

  it('recovers the supplied EPUB style of flat file / numbered section / subsection outline', async () => {
    const doc = book(
      [
        '<h1>第一讲</h1><p>引言</p><p id="a">一、制度</p><p id="b">（一）组织</p><p>细节</p><p id="c">二、经济</p><p>结尾</p>',
        '<h1>第二讲</h1>',
      ],
      [
        item('第一讲', 'chapter0.xhtml'),
        item('一、制度', 'chapter0.xhtml#a'),
        item('（一）组织', 'chapter0.xhtml#b'),
        item('二、经济', 'chapter0.xhtml#c'),
        item('第二讲', 'chapter1.xhtml'),
      ],
    );
    const chapters = listChapters(doc);
    expect(chapters.map((chapter) => chapter.depth)).toEqual([0, 1, 2, 1, 0]);
    expect((await extractChapter(doc, chapters[0]!)).sources).toHaveLength(7);
    expect((await extractChapter(doc, chapters[1]!)).sources.map((source) => source.text)).toEqual([
      '一、制度',
      '（一）组织',
      '细节',
    ]);
  });

  it('resolves the full outline path for a reading position', () => {
    const doc = book(
      [
        '<h1>第一讲</h1><p>引言</p><p id="a">一、制度</p><p id="b">（一）组织</p><p>细节</p>',
        '<h1>第二讲</h1>',
      ],
      [
        item('第一讲', 'chapter0.xhtml'),
        item('一、制度', 'chapter0.xhtml#a'),
        item('（一）组织', 'chapter0.xhtml#b'),
        item('第二讲', 'chapter1.xhtml'),
      ],
    );
    expect(chapterPathForHref(doc, 'chapter0.xhtml#b')).toBe('第一讲 › 一、制度 › （一）组织');
    expect(chapterPathForHref(doc, 'chapter0.xhtml')).toBe('第一讲');
    expect(chapterPathForHref(doc, 'chapter0.xhtml#missing')).toBe('');
    expect(chapterPathForHref(doc, undefined)).toBe('');
    expect(chapterPathForHref({} as BookDoc, 'chapter0.xhtml')).toBe('');
  });

  it('collects a chapter spanning spine files and clips the final file before next fragment', async () => {
    const doc = book(
      ['<p>甲</p>', '<p>乙</p>', '<p>丙</p><h1 id="next">后章</h1><p>禁止泄漏</p>'],
      [item('一章', 'chapter0.xhtml'), item('二章', 'chapter2.xhtml#next')],
    );
    const result = await extractChapter(doc, listChapters(doc)[0]!);
    expect(result.sources.map((source) => source.text)).toEqual(['甲', '乙', '丙']);
    expect(result.sources.map((source) => source.anchor.sectionIndex)).toEqual([0, 1, 2]);
  });

  it('keeps original DOM anchors while filtering hidden and executable content without duplicate blocks', async () => {
    const doc = book([
      '<nav>目录</nav><p id="a">甲<script>bad()</script><span hidden>秘密</span><span style="display:none">隐藏</span>乙</p><div><p>单独段落</p></div><ul><li>第一条 <b>重点</b></li><li>第二条</li></ul><table><tr><th>税</th><th>率</th></tr><tr><td>地税</td><td>十分一</td></tr></table>',
      '<p>下一章</p>',
    ]);
    const result = await extractChapter(doc, listChapters(doc)[0]!);
    expect(result.sources.map((source) => source.text)).toEqual([
      '甲乙',
      '单独段落',
      '第一条 重点',
      '第二条',
      '税 率 地税 十分一',
    ]);
    expect(result.sources.at(-1)?.kind).toBe('table');
    expect((await resolveSource(doc, result.sources[0]!))?.text).toBe('甲乙');
    expect(result.sources.map((source) => source.sourceId)).toEqual(
      (await extractChapter(doc, listChapters(doc)[0]!)).sources.map((source) => source.sourceId),
    );
  });

  it('does not silently expand missing or reversed fragment ranges', async () => {
    const missing = book(
      ['<p>秘密</p>', '<p>下一章</p>'],
      [item('Missing', 'chapter0.xhtml#missing'), item('Next', 'chapter1.xhtml')],
    );
    await expect(extractChapter(missing, listChapters(missing)[0]!)).rejects.toThrow(
      'Chapter location',
    );
    const reversed = book(
      ['<p id="b">乙</p><p id="a">甲</p>'],
      [item('A', 'chapter0.xhtml#a'), item('B', 'chapter0.xhtml#b')],
    );
    await expect(extractChapter(reversed, listChapters(reversed)[0]!)).rejects.toThrow(
      'Chapter location',
    );
  });

  it('omits a synthetic whole-book TOC root and falls back to individual linear spine files', () => {
    const nested = book(
      ['<p>甲</p>', '<p>乙</p>'],
      [
        item('Whole book', 'chapter0.xhtml', [
          item('A', 'chapter0.xhtml'),
          item('B', 'chapter1.xhtml'),
        ]),
      ],
    );
    expect(listChapters(nested).map((chapter) => chapter.title)).toEqual(['A', 'B']);
    const noToc = book(['<p>封面</p>', '<p>甲</p>', '<p>乙</p>']);
    noToc.sections[0]!.linear = 'no';
    expect(listChapters(noToc).map((chapter) => chapter.sectionIndex)).toEqual([1, 2]);
  });

  it('does not offer an indistinguishable whole book as a chapter', () => {
    expect(listChapters(book(['<p>全书</p>']))).toEqual([]);
    const withCover = book(['<p>封面</p>', '<p>全书</p>']);
    withCover.sections[0]!.linear = 'no';
    expect(listChapters(withCover)).toEqual([]);
    expect(
      listChapters(book(['<p>第一部分</p>', '<p>第二部分</p>'], [item('全书', 'chapter0.xhtml')])),
    ).toEqual([]);
    expect(
      listChapters(book(['<p id="all">全书</p>'], [item('全书', 'chapter0.xhtml#all')])),
    ).toEqual([]);
    const flatRoot = book(
      ['<p id="a">第一节</p><p id="b">第二节</p>'],
      [
        item('全书', 'chapter0.xhtml'),
        item('A', 'chapter0.xhtml#a'),
        item('B', 'chapter0.xhtml#b'),
      ],
    );
    expect(listChapters(flatRoot).map((chapter) => [chapter.title, chapter.depth])).toEqual([
      ['A', 0],
      ['B', 0],
    ]);
  });

  it('returns empty sources for image-only chapters and honors cancellation during loading', async () => {
    const doc = book(['<img alt="diagram" src="cover.jpg">', '<p>下一章</p>']);
    expect((await extractChapter(doc, listChapters(doc)[0]!)).sources).toEqual([]);
    const controller = new AbortController();
    doc.sections[0]!.createDocument = async () => {
      controller.abort();
      return document;
    };
    await expect(
      extractChapter(doc, listChapters(doc)[0]!, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('validates citation IDs, recovers moved text, and refuses stale or ambiguous sources', async () => {
    const doc = book(['<p>原始唯一文本</p>', '<p>下一章</p>']);
    const [source] = (await extractChapter(doc, listChapters(doc)[0]!)).sources;
    expect(validateSourceIds([source!.sourceId], [source!])).toEqual([source]);
    expect(() => validateSourceIds(['model-invented'], [source!])).toThrow();
    doc.sections[0]!.createDocument = async () =>
      new DOMParser().parseFromString('<p>插入的内容</p><p>原始唯一文本</p>', 'text/html');
    const resolved = await resolveSource(doc, source!);
    expect(resolved).toMatchObject({ text: '原始唯一文本', recovered: true });
    expect(resolved?.cfi).not.toBe(source!.anchor.cfi);
    doc.sections[0]!.createDocument = async () =>
      new DOMParser().parseFromString('<p>修改后不再匹配</p>', 'text/html');
    expect(await resolveSource(doc, source!)).toBeNull();
    doc.sections[0]!.createDocument = async () =>
      new DOMParser().parseFromString(
        '<p>插入</p><p>原始唯一文本</p><p>原始唯一文本</p>',
        'text/html',
      );
    expect(await resolveSource(doc, source!)).toBeNull();
  });
});
