import { expect, it, vi } from 'vitest';
import * as CFI from 'foliate-js/epubcfi.js';
import type { BookDoc } from '@/libs/document';
import { createEpubBookAccess } from '@/glossa/harness/epub';
import { resolveSource } from '@/glossa/citations/sources';

function fixture() {
  const texts = [
    '<p>目录前的序言观点。</p>',
    '<h1 id="a">总论</h1><p>一、中央集权的条件。</p><h2 id="b">补充</h2><p>四、制度应随时代变化。</p>',
    '<p>附注：另一处必要的限制。</p>',
  ];
  const reads = texts.map((html) =>
    vi.fn(async () => new DOMParser().parseFromString(html, 'text/html')),
  );
  const book: BookDoc = {
    metadata: { title: 'Original fixture', author: 'Glossa', language: 'zh' },
    rendition: {},
    dir: 'ltr',
    getCover: async () => null,
    sections: texts.map((text, index) => ({
      id: `${index}.xhtml`,
      cfi: CFI.fake.fromIndex(index),
      size: text.length,
      linear: index === 2 ? 'no' : 'yes',
      createDocument: reads[index]!,
    })),
    toc: [
      { id: 0, index: 0, label: '总论', href: '1.xhtml#a' },
      { id: 1, index: 1, label: '补充', href: '1.xhtml#b' },
    ],
    splitTOCHref: (href) => href.split('#'),
  };
  return { book, reads };
}

it('creates no eager reads and covers front matter, fragments and nonlinear notes exactly once', async () => {
  const { book, reads } = fixture();
  const access = createEpubBookAccess(book, 'book');
  expect(reads.every((read) => read.mock.calls.length === 0)).toBe(true);
  const all = await access.readAll(new AbortController().signal);
  expect(all.map((source) => source.text)).toEqual([
    '目录前的序言观点。',
    '总论',
    '一、中央集权的条件。',
    '补充',
    '四、制度应随时代变化。',
    '附注：另一处必要的限制。',
  ]);
  expect(new Set(all.map((source) => source.sourceId)).size).toBe(all.length);
  for (const source of all)
    expect(await resolveSource(book, source)).toMatchObject({ text: source.text });
  const chapter = await access.readChapter(access.chapters[0]!.id, new AbortController().signal);
  expect(chapter.map((source) => source.text)).toEqual(['总论', '一、中央集权的条件。']);
  await expect(access.readChapter('forged', new AbortController().signal)).rejects.toThrow();
});

it('finds late-book evidence with Chinese questions and includes nearby qualifications', async () => {
  const { book } = fixture();
  const access = createEpubBookAccess(book, 'book');
  const result = await access.search(['为什么制度应随时代变化？'], new AbortController().signal);
  expect(result.some((source) => source.text === '四、制度应随时代变化。')).toBe(true);
  expect(result.some((source) => source.text === '补充')).toBe(true);
});

it('stops between spine reads without touching later files', async () => {
  const { book, reads } = fixture();
  const controller = new AbortController();
  reads[0]!.mockImplementation(async () => {
    controller.abort();
    return new DOMParser().parseFromString('<p>first</p>', 'text/html');
  });
  await expect(createEpubBookAccess(book, 'book').readAll(controller.signal)).rejects.toMatchObject(
    { name: 'AbortError' },
  );
  expect(reads[1]).not.toHaveBeenCalled();
});

it('reuses local parsing across requests, invalidates by document hash, and protects cached originals', async () => {
  const { book, reads } = fixture();
  const signal = new AbortController().signal;
  const first = createEpubBookAccess(book, 'v1');
  const original = await first.readAll(signal);
  original[0]!.text = 'changed by caller';
  const second = createEpubBookAccess(book, 'v1');
  await second.search(['制度变化'], signal);
  await second.search(['中央集权'], signal);
  expect(reads.every((read) => read.mock.calls.length === 1)).toBe(true);
  expect((await second.readAll(signal))[0]?.text).toBe('目录前的序言观点。');
  await createEpubBookAccess(book, 'v2').readAll(signal);
  expect(reads.every((read) => read.mock.calls.length === 2)).toBe(true);
});

it('samples across the book for a few interesting points when there is no topical keyword', async () => {
  const { book } = fixture();
  const result = await createEpubBookAccess(book, 'book').search(
    ['举出三个钱穆先生最为精彩的观点'],
    new AbortController().signal,
  );
  expect(new Set(result.map((source) => source.anchor.sectionIndex))).toEqual(new Set([0, 1, 2]));
});

it('does not publish a cancelled partial parse as a complete book cache', async () => {
  const { book, reads } = fixture();
  const access = createEpubBookAccess(book, 'book');
  const controller = new AbortController();
  reads[0]!.mockImplementationOnce(async () => {
    controller.abort();
    return new DOMParser().parseFromString('<p>first</p>', 'text/html');
  });
  await expect(access.readAll(controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  const all = await access.readAll(new AbortController().signal);
  expect(all.at(-1)?.text).toBe('附注：另一处必要的限制。');
  expect(reads[1]).toHaveBeenCalledOnce();
});

it('carries section and heading context without treating a shared spine as an exact chapter', async () => {
  const { book } = fixture();
  const access = createEpubBookAccess(book, 'context');
  const all = await access.readAll(new AbortController().signal);
  const source = all.find((s) => s.text === '四、制度应随时代变化。')!;
  expect(access.sourceContext?.(source)).toEqual({
    sectionTitles: ['总论', '补充'],
    heading: '补充',
  });
  const { sourceWire } = await import('@/glossa/harness/book');
  expect(JSON.stringify(sourceWire(source, access))).not.toMatch(
    /epubcfi|sectionIndex|prefix|suffix/,
  );
});

it('lets the model read front matter absent from the table of contents', async () => {
  const { book } = fixture();
  const access = createEpubBookAccess(book, 'front');
  const front = access.chapters.find((c) => c.id === 'spine-0');
  expect(front).toBeDefined();
  const sources = await access.readChapter(front!.id, new AbortController().signal);
  expect(sources.map((s) => s.text)).toEqual(['目录前的序言观点。']);
});
