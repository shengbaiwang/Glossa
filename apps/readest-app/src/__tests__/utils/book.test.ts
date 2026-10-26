import { describe, expect, it } from 'vitest';

import { formatSeries, getVisibleBooks } from '@/utils/book';
import type { Book } from '@/types/book';

describe('formatSeries', () => {
  it('returns an empty string when there is no series name', () => {
    expect(formatSeries(undefined)).toBe('');
    expect(formatSeries('')).toBe('');
    expect(formatSeries('   ')).toBe('');
  });

  it('returns an empty string when only an index is present', () => {
    expect(formatSeries(undefined, 3)).toBe('');
  });

  it('returns the trimmed series name when no index is present', () => {
    expect(formatSeries('Harry Potter')).toBe('Harry Potter');
    expect(formatSeries('  The Expanse  ')).toBe('The Expanse');
  });

  it('appends the series number when a positive index is present', () => {
    expect(formatSeries('Harry Potter', 3)).toBe('Harry Potter #3');
    expect(formatSeries('  The Expanse  ', 2)).toBe('The Expanse #2');
  });

  it('supports fractional series indices', () => {
    expect(formatSeries('The Expanse', 1.5)).toBe('The Expanse #1.5');
  });

  it('omits the number when the index is zero or not a finite number', () => {
    expect(formatSeries('Harry Potter', 0)).toBe('Harry Potter');
    expect(formatSeries('Harry Potter', Number.NaN)).toBe('Harry Potter');
  });
});

describe('duplicate visibility', () => {
  const books = (links: Record<string, string | undefined>): Book[] =>
    Object.entries(links).map(([hash, duplicateOf]) => ({
      hash,
      duplicateOf,
      title: hash,
      author: '',
      format: 'EPUB',
      createdAt: 1,
      updatedAt: 1,
    }));
  it('shows the keeper and an orphan whose keeper has not synced yet', () => {
    expect(
      getVisibleBooks(books({ a: undefined, b: 'a', c: 'missing' })).map((b) => b.hash),
    ).toEqual(['a', 'c']);
  });
  it('resolves conflicting sync choices to one visible cycle member', () => {
    expect(getVisibleBooks(books({ a: 'b', b: 'c', c: 'b', d: 'a' })).map((b) => b.hash)).toEqual([
      'b',
    ]);
  });
});
