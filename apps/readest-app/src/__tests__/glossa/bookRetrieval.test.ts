import { expect, it } from 'vitest';
import type { ChapterSource } from '@/glossa/context/types';
import { buildSourceIndex } from '@/glossa/harness/retrieval';

const source = (sourceId: string, text: string): ChapterSource => ({
  sourceId,
  text,
  kind: 'paragraph',
  anchor: {
    sectionIndex: 0,
    cfi: 'epubcfi(/6/2!/4/2)',
    quote: { exact: text, prefix: '', suffix: '' },
  },
});

it('ranks Chinese concepts and rare English terms above repetitive long noise', async () => {
  const index = await buildSourceIndex(
    [
      source('noise', '制度 '.repeat(800)),
      source('cn', '中央集权削弱地方政治，地方制度需要调整。'),
      source('en', 'An institutional constraint explains the change.'),
    ],
    new AbortController().signal,
  );
  expect(index.search('为什么中央集权削弱地方政治？')[0]?.sourceId).toBe('cn');
  expect(index.search('institutional constraints')[0]?.sourceId).toBe('en');
  expect(index.search('completely absent term')).toEqual([]);
});

it('cancels indexing between blocks instead of blocking the reader until the end', async () => {
  const controller = new AbortController();
  const building = buildSourceIndex(
    Array.from({ length: 300 }, (_, i) => source(`s${i}`, '制度变化。')),
    controller.signal,
  );
  controller.abort();
  await expect(building).rejects.toMatchObject({ name: 'AbortError' });
});

it('removes book identification noise while keeping topical concepts', async () => {
  const { seedSearchQuery } = await import('@/glossa/harness/retrieval');
  const query = seedSearchQuery('林某这本《原创制度史》是在什么历史背景下写作的？', {
    bookTitle: '原创制度史',
    author: '林某',
  });
  expect(query).not.toMatch(/林某|原创制度史/);
  const index = await buildSourceIndex(
    [
      source('credit', '林某 著'),
      source('title', '原创制度史'),
      source('preface', '历史背景与写作缘由：当时社会动荡，作者试图回应普遍误解。'),
    ],
    new AbortController().signal,
  );
  expect(index.search(query)[0]?.sourceId).toBe('preface');
});
