import { describe, expect, it } from 'vitest';
import type { BookMetadata } from '@/libs/document';
import { repairImportedMetadata, resolveImportedMetadata } from '@/utils/importMetadata';
import type { Book } from '@/types/book';

function metadata(overrides: Partial<BookMetadata> = {}): BookMetadata {
  return { title: 'Book', author: 'Writer', language: 'en', ...overrides };
}

describe('imported metadata field quality', () => {
  it.each([
    '',
    '   ',
    '\u0000',
    'ssreader',
  ])('falls back to filenames without guessing bibliographic fields: %j', (title) => {
    const raw = metadata({ title, author: 'Unknown' });
    expect(
      resolveImportedMetadata(raw, '/Library/03. 马基雅维里主义（修订版）.PDF', 'PDF'),
    ).toMatchObject({ title: '03. 马基雅维里主义（修订版）', author: '' });
    expect(raw.title).toBe(title);
  });

  it.each([
    'The ssreader Handbook',
    'Unknown',
    'Documentary',
    'A PowerPoint Presentation',
  ])('keeps raw bibliographic titles while displaying the original filename: %s', (title) => {
    const raw = metadata({ title });
    expect(resolveImportedMetadata(raw, 'different.pdf', 'PDF').title).toBe('different');
    expect(raw.title).toBe(title);
  });

  it('preserves an EPUB literary title Untitled and anonymous authors', () => {
    expect(
      resolveImportedMetadata(
        metadata({ title: 'Untitled', author: 'Anonymous' }),
        'different.epub',
        'EPUB',
      ),
    ).toMatchObject({ title: 'different', author: 'Anonymous' });
  });

  it('preserves language maps and contributor objects while removing only software contributors', () => {
    const raw: BookMetadata = {
      title: { en: 'Real Title' },
      author: [{ name: { en: 'A. Writer' } }, { name: { en: 'ssreader' } }, 'B. Writer'],
      language: 'en',
    } as unknown as BookMetadata;
    const before = structuredClone(raw);
    const result = resolveImportedMetadata(raw, 'file.epub', 'EPUB');
    expect(result.title).toBe('file');
    expect(result.author).toBe('A. Writer and B. Writer');
    expect(raw).toEqual(before);
  });

  it('removes the extension when embedded title is the original filename', () => {
    expect(resolveImportedMetadata(metadata({ title: '原书.pdf' }), '原书.pdf', 'PDF').title).toBe(
      '原书',
    );
  });

  it.each([
    'PDF',
    'EPUB',
    'MOBI',
    'AZW3',
    'TXT',
    'MD',
  ] as const)('retains edition, punctuation and numbering in original %s filenames', (format) => {
    expect(
      resolveImportedMetadata(metadata(), `03. 原书？[修订版] #2.${format}`, format).title,
    ).toBe('03. 原书？[修订版] #2');
    expect(resolveImportedMetadata(metadata(), `Why? A study.${format}`, format).title).toBe(
      'Why? A study',
    );
  });

  it('uses metadata when there is no reliable original filename', () => {
    expect(resolveImportedMetadata(metadata(), '', 'EPUB').title).toBe('Book');
  });

  it('restores a known original name without renaming the managed file or personal edits', () => {
    const book = {
      title: 'Book',
      sourceTitle: 'Book',
      originalFilename: '原书（第二版）.epub',
      format: 'EPUB',
      metadata: metadata(),
    } as Book;
    repairImportedMetadata(book);
    expect(book.title).toBe('原书（第二版）');
    expect(book.sourceTitle).toBe('Book');
    book.title = '我的书名';
    repairImportedMetadata(book);
    expect(book.title).toBe('我的书名');
  });
});
