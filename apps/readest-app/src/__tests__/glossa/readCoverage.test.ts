import { describe, expect, test } from 'vitest';

import {
  addEpubReadRange,
  isEpubRangeInReadCoverage,
  isEpubSourceInReadCoverage,
  parseEpubReadCoverage,
  shouldRecordEpubReadingEvent,
  type EpubReadRange,
} from '@/glossa/context/readCoverage';
import { captureEpubReadRangeFromRelocate } from '@/glossa/context/epub';
import { CFI } from '@/libs/document';

const range = (startCfi: string, endCfi: string, sectionIndex = 0): EpubReadRange => ({
  version: 1,
  sectionIndex,
  startCfi,
  endCfi,
});

const compareCfi = (left: string, right: string): number => left.localeCompare(right);

describe('Epub read coverage', () => {
  test('only accepts page and continuous-scroll relocation as reading evidence', () => {
    expect(shouldRecordEpubReadingEvent('page')).toBe(true);
    expect(shouldRecordEpubReadingEvent('scroll')).toBe(true);
    expect(shouldRecordEpubReadingEvent('navigation')).toBe(false);
    expect(shouldRecordEpubReadingEvent('anchor')).toBe(false);
    expect(shouldRecordEpubReadingEvent(undefined)).toBe(false);
  });

  test('normalizes, merges overlapping ranges, and leaves separated reads distinct', () => {
    const coverage = addEpubReadRange(
      [range('cfi:10', 'cfi:20'), range('cfi:30', 'cfi:40')],
      range('cfi:18', 'cfi:32'),
      compareCfi,
    );

    expect(coverage).toEqual([range('cfi:10', 'cfi:40')]);
    expect(addEpubReadRange(coverage, range('cfi:50', 'cfi:60'), compareCfi)).toEqual([
      range('cfi:10', 'cfi:40'),
      range('cfi:50', 'cfi:60'),
    ]);
  });

  test('filters a source to explicit coverage rather than treating a later jump as read', () => {
    const coverage = [range('cfi:10', 'cfi:20'), range('cfi:60', 'cfi:70')];

    expect(isEpubSourceInReadCoverage('cfi:15', 0, coverage, compareCfi)).toBe(true);
    expect(isEpubSourceInReadCoverage('cfi:50', 0, coverage, compareCfi)).toBe(false);
    expect(isEpubSourceInReadCoverage('cfi:65', 0, coverage, compareCfi)).toBe(true);
    expect(isEpubSourceInReadCoverage('cfi:15', 1, coverage, compareCfi)).toBe(false);
  });

  test('requires a complete chapter block to fit within one read interval', () => {
    const coverage = [range('cfi:10', 'cfi:20'), range('cfi:30', 'cfi:40')];
    expect(isEpubRangeInReadCoverage('cfi:12', 'cfi:18', 0, coverage, compareCfi)).toBe(true);
    expect(isEpubRangeInReadCoverage('cfi:12', 'cfi:32', 0, coverage, compareCfi)).toBe(false);
    expect(isEpubRangeInReadCoverage('cfi:12', 'cfi:22', 0, coverage, compareCfi)).toBe(false);
  });

  test('uses native EPUB CFI ordering for complete, partial, and unread blocks', () => {
    const coverage = [range('epubcfi(/6/2!/4/1:0)', 'epubcfi(/6/2!/4/3:5)')];

    expect(
      isEpubRangeInReadCoverage(
        'epubcfi(/6/2!/4/1:0)',
        'epubcfi(/6/2!/4/1:20)',
        0,
        coverage,
        CFI.compare,
      ),
    ).toBe(true);
    expect(
      isEpubRangeInReadCoverage(
        'epubcfi(/6/2!/4/3:0)',
        'epubcfi(/6/2!/4/3:10)',
        0,
        coverage,
        CFI.compare,
      ),
    ).toBe(false);
    expect(
      isEpubRangeInReadCoverage(
        'epubcfi(/6/2!/4/5:0)',
        'epubcfi(/6/2!/4/5:10)',
        0,
        coverage,
        CFI.compare,
      ),
    ).toBe(false);
  });

  test('rejects malformed persisted coverage safely', () => {
    expect(parseEpubReadCoverage(null)).toEqual([]);
    expect(
      parseEpubReadCoverage([{ version: 1, sectionIndex: -1, startCfi: 'a', endCfi: 'b' }]),
    ).toEqual([]);
    expect(parseEpubReadCoverage([range('cfi:1', 'cfi:2')])).toEqual([range('cfi:1', 'cfi:2')]);
  });

  test('captures only the visible range from a user reading relocation', () => {
    const doc = document.implementation.createHTMLDocument('coverage');
    doc.body.innerHTML = '<p>first</p><p>second</p>';
    const visible = doc.createRange();
    visible.selectNodeContents(doc.body);
    const getCFI = (_index: number, source: Range) =>
      source.collapsed && source.startOffset === 0 ? 'cfi:start' : 'cfi:end';
    const view = { getCFI };

    expect(
      captureEpubReadRangeFromRelocate(view, {
        reason: 'navigation',
        index: 0,
        range: visible,
      }),
    ).toBeNull();
    expect(
      captureEpubReadRangeFromRelocate(view, {
        reason: 'page',
        index: 0,
        range: visible,
      }),
    ).toEqual(range('cfi:start', 'cfi:end'));
  });
});
