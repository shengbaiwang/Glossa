import { describe, expect, test } from 'vitest';

import {
  deserializeSourceAnchor,
  parseSourceAnchor,
  serializeSourceAnchor,
  type SourceAnchor,
} from '@/glossa';

const anchor: SourceAnchor = {
  version: 1,
  documentId: 'glossa-reading-sample',
  format: 'epub',
  sectionId: 'chapter-1.xhtml',
  cfi: 'epubcfi(/6/2!/4/1:0)',
  quote: { exact: 'The Aster Index', prefix: 'Before ', suffix: ' records' },
};

describe('SourceAnchor V1', () => {
  test('serializes and deserializes an EPUB anchor without losing fields', () => {
    const serialized = serializeSourceAnchor(anchor);

    expect(deserializeSourceAnchor(serialized)).toEqual(anchor);
  });

  test.each([
    ['invalid JSON', '{not-json'],
    ['unknown version', JSON.stringify({ ...anchor, version: 2 })],
    ['empty documentId', JSON.stringify({ ...anchor, documentId: '' })],
    ['empty quote exact', JSON.stringify({ ...anchor, quote: { exact: '' } })],
    ['wrong format', JSON.stringify({ ...anchor, format: 'pdf' })],
    ['missing EPUB locator', JSON.stringify({ ...anchor, sectionId: undefined, cfi: undefined })],
    ['wrong field type', JSON.stringify({ ...anchor, cfi: 4 })],
  ])('rejects %s', (_description, serialized) => {
    expect(() => deserializeSourceAnchor(serialized)).toThrow();
  });

  test('rejects unknown fields and overlong Unicode TextQuote context', () => {
    expect(() => parseSourceAnchor({ ...anchor, unexpected: true })).toThrow();
    expect(() =>
      parseSourceAnchor({
        ...anchor,
        quote: { exact: anchor.quote.exact, prefix: '星'.repeat(49) },
      }),
    ).toThrow();
  });
});
