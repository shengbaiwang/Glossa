import type { BookMetadata } from '@/libs/document';
import type { Book, BookFormat } from '@/types/book';
import { formatAuthors, formatTitle, getPrimaryLanguage } from './book';
import { getBaseFilename, getFilename } from './path';
import { isContentURI, isValidURL } from './misc';

// Exact markers only: a real title mentioning one of these products is valid.
const SOFTWARE_MARKER =
  /^(?:ss[\s_-]*reader(?:\s*v?\d+(?:\.\d+)*)?|adobe acrobat|acrobat pdfmaker|microsoft word|microsoft powerpoint)$/i;
const PDF_PLACEHOLDER =
  /^(?:untitled(?: document| presentation)?|powerpoint presentation|document\d+)$/i;
const UNKNOWN_AUTHOR = /^(?:unknown|n\/a|none)$/i;

function marker(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, '').trim();
}

function invalidTitle(value: string, format: BookFormat): boolean {
  const text = marker(value);
  return !text || SOFTWARE_MARKER.test(text) || (format === 'PDF' && PDF_PLACEHOLDER.test(text));
}

export function resolveImportedMetadata(
  metadata: BookMetadata,
  filename: string,
  format: BookFormat,
) {
  const parsedTitle = formatTitle(metadata.title);
  // Display identity comes from the supplied file. Bibliographic metadata
  // still controls metadata deduplication and remains available for editing.
  const usesFilename = invalidTitle(parsedTitle, format) || parsedTitle === getFilename(filename);
  const title = getBaseFilename(getFilename(filename)).trim() || parsedTitle;
  const language = getPrimaryLanguage(metadata.language);
  // foliate also returns contributor arrays at runtime. Keep the same formatter
  // and language rules, removing only individually verified placeholder values.
  const contributors = Array.isArray(metadata.author) ? metadata.author : [metadata.author];
  const authors = contributors.filter((contributor) => {
    const text = marker(formatAuthors(contributor, language));
    return text && !SOFTWARE_MARKER.test(text) && !UNKNOWN_AUTHOR.test(text);
  });
  return { title, author: formatAuthors(authors, language), usesFilename };
}

/** Correct only untouched imported fields. Raw metadata and file identity stay intact. */
export function repairImportedMetadata(book: Book, filename?: string): void {
  if (book.deletedAt || book.metadataUpdatedAt || !book.metadata) return;
  const source = filename ?? book.originalFilename ?? book.filePath;
  // Content URIs may contain opaque IDs, not the original filename.
  const sourceFilename = source && !isContentURI(source) && !isValidURL(source) ? source : '';
  const resolved = resolveImportedMetadata(book.metadata, sourceFilename, book.format);
  const rawTitle = formatTitle(book.metadata.title);
  if (
    sourceFilename &&
    book.title &&
    book.title.trim() === rawTitle.trim() &&
    resolved.title &&
    !invalidTitle(resolved.title, book.format)
  ) {
    // sourceTitle locates the managed copy and remote files. Never rename it.
    book.sourceTitle ||= book.title;
    book.title = resolved.title;
  }
  if (filename && sourceFilename) book.originalFilename ||= getFilename(sourceFilename);
  const rawAuthor = formatAuthors(book.metadata.author, getPrimaryLanguage(book.metadata.language));
  if (book.author === rawAuthor) book.author = resolved.author;
}
