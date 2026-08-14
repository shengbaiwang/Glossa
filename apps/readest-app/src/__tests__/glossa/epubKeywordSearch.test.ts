import { describe, expect, test } from 'vitest';

import {
  extractEpubKeywordQueries,
  searchReadEpubText,
} from '@/glossa/retrieval/epubKeywordSearch';

const makeDocument = (body: string): Document => {
  const doc = document.implementation.createHTMLDocument('search section');
  doc.body.innerHTML = body;
  return doc;
};

describe('Epub keyword search', () => {
  test('turns common English and Chinese questions into bounded literal keyword queries', () => {
    expect(extractEpubKeywordQueries('What is an amber mark?')).toEqual(['amber mark']);
    expect(extractEpubKeywordQueries('什么是琥珀标记？')).toEqual(['琥珀标记']);
    expect(extractEpubKeywordQueries('Explain “shared margin” in this passage.')).toContain(
      'shared margin',
    );
  });

  test('returns only keyword matches proven by CFI read coverage and never touches the live view search', async () => {
    const first = makeDocument('<p>amber mark in read text</p><p>amber mark in unread text</p>');
    const second = makeDocument('<p>amber mark after a chapter jump</p>');
    const searched: string[] = [];
    const view = {
      book: {
        sections: [{ createDocument: async () => first }, { createDocument: async () => second }],
      },
      getCFI: (index: number, range: Range) => {
        const text = range.toString();
        searched.push(`${index}:${text}`);
        const paragraph = range.startContainer.parentElement?.textContent ?? '';
        return `cfi:${index}:${paragraph.includes('unread') ? '50' : '10'}`;
      },
    };

    const results = await searchReadEpubText({
      documentId: 'fixture-book',
      view,
      query: 'amber mark',
      coverage: [
        { version: 1, sectionIndex: 0, startCfi: 'cfi:0:00', endCfi: 'cfi:0:20' },
        { version: 1, sectionIndex: 1, startCfi: 'cfi:1:60', endCfi: 'cfi:1:70' },
      ],
      compareCfi: (left, right) => left.localeCompare(right),
    });

    expect(results.map(({ text }) => text)).toEqual(['amber mark']);
    expect(results[0]?.anchor).toMatchObject({
      sectionId: 'spine:0',
      cfi: 'cfi:0:10',
      quote: { exact: 'amber mark' },
    });
    expect(searched).toHaveLength(3);
  });

  test('returns no evidence without a valid read coverage interval', async () => {
    const doc = makeDocument('<p>amber mark</p>');
    const results = await searchReadEpubText({
      documentId: 'fixture-book',
      view: {
        book: { sections: [{ createDocument: async () => doc }] },
        getCFI: () => 'cfi:0:10',
      },
      query: 'amber mark',
      coverage: [],
      compareCfi: (left, right) => left.localeCompare(right),
    });

    expect(results).toEqual([]);
  });
});
